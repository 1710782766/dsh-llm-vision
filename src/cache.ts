/**
 * Persistent answer cache ported from llm_vision (MIT): content-addressed,
 * so re-viewing the same image + model + prompt costs nothing — across
 * sessions, not just within one process.
 *
 * - key: SHA-256 over (image bytes digest, model, prompt, maxEdge,
 *   compressEnabled, apiStyle) — file path, URL, and attachment inputs all
 *   share one uniform key space
 * - storage: $XDG_CACHE_HOME/dsh-llm-vision/responses.json (or ~/.cache/
 *   dsh-llm-vision/), one file per user, TTL 30 days, at most 500 entries
 *   (oldest evicted), lazy pruning on read and write
 * - only the model's text answer is stored — never image bytes
 * - atomic writes (tmp + rename), directory 0700 / file 0600
 * - every failure silently degrades to miss / no-op; the cache never breaks
 *   the call chain
 * @module dsh-llm-vision/cache
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { chmod, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_TTL_DAYS = 30
export const DEFAULT_MAX_ENTRIES = 500
const DAY_SECONDS = 86400

/** Resolve the default cache directory: $XDG_CACHE_HOME/dsh-llm-vision or ~/.cache/dsh-llm-vision. */
export function defaultCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME
  return join(base ?? join(homedir(), '.cache'), 'dsh-llm-vision')
}

/** One cached entry: the answer text plus its write timestamp (epoch seconds). */
interface CacheEntry {
  text: string
  ts: number
}

type EntryMap = Record<string, CacheEntry>

/**
 * Build the content-addressed cache key for one request. A single digest keeps
 * the v1 key layout (digest strings carry no colon, so the join is unchanged
 * and previously cached answers still hit); multi-image reads key on the
 * digest list instead.
 */
export function semanticCacheKey(parts: {
  imageDigest: string | string[]
  model: string
  prompt: string
  maxEdge: number
  compressEnabled: boolean
  apiStyle: string
}): string {
  const digestField = Array.isArray(parts.imageDigest) ? parts.imageDigest.join(',') : parts.imageDigest
  const joined = [
    digestField,
    parts.model,
    parts.prompt,
    parts.maxEdge,
    parts.compressEnabled,
    parts.apiStyle,
  ].join(':')
  return createHash('sha256').update(joined).digest('hex')
}

/** SHA-256 digest of the raw image bytes. */
export function imageDigest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Persistent, content-addressed answer cache. enabled=false turns every
 * operation into a no-op. cacheDir names the directory holding responses.json;
 * TTL and entry cap are configurable and lazily enforced.
 */
export class PersistentAnswerCache {
  private readonly enabled: boolean
  private readonly maxEntries: number
  private readonly ttlSeconds: number
  private readonly file: string

  constructor(options: { cacheDir?: string; enabled?: boolean; ttlDays?: number; maxEntries?: number } = {}) {
    this.enabled = options.enabled ?? true
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.ttlSeconds = (options.ttlDays ?? DEFAULT_TTL_DAYS) * DAY_SECONDS
    this.file = join(options.cacheDir ?? defaultCacheDir(), 'responses.json')
  }

  /** Cache hit or undefined; any failure silently returns undefined. */
  get(key: string): string | undefined {
    if (!this.enabled) return undefined
    try {
      const entries = this.load()
      const entry = entries[key]
      if (entry === undefined) return undefined
      if (Date.now() / 1000 - (entry.ts ?? 0) >= this.ttlSeconds) return undefined
      return entry.text
    } catch {
      return undefined
    }
  }

  /** Store one answer; any failure silently ignored (never breaks the call chain). */
  put(key: string, text: string): void {
    if (!this.enabled) return
    try {
      const entries = this.load()
      this.prune(entries)
      entries[key] = { text, ts: Date.now() / 1000 }
      if (Object.keys(entries).length > this.maxEntries) this.prune(entries)
      this.save(entries)
    } catch {
      // silent no-op
    }
  }

  private load(): EntryMap {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
      return parsed as EntryMap
    } catch {
      return {}
    }
  }

  private save(entries: EntryMap): void {
    const dir = dirname(this.file)
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    } catch {
      return
    }
    const tmp = join(dir, `.responses.${randomBytes(6).toString('hex')}.tmp`)
    try {
      writeFileSync(tmp, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 })
      renameSync(tmp, this.file)
      // best-effort hardening; failures are non-fatal
      chmod(dir, 0o700).catch(() => {})
      chmod(this.file, 0o600).catch(() => {})
    } catch {
      rm(tmp, { force: true }).catch(() => {})
    }
  }

  private prune(entries: EntryMap): void {
    const now = Date.now() / 1000
    for (const key of Object.keys(entries)) {
      if (now - (entries[key]?.ts ?? 0) >= this.ttlSeconds) delete entries[key]
    }
    const keys = Object.keys(entries)
    if (keys.length > this.maxEntries) {
      for (const key of keys
        .sort((a, b) => (entries[a]?.ts ?? 0) - (entries[b]?.ts ?? 0))
        .slice(0, keys.length - this.maxEntries)) {
        delete entries[key]
      }
    }
  }
}
