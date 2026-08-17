/**
 * Persistent answer cache tests (llm_vision parity): content-addressed keys,
 * cross-instance persistence, TTL expiry, capacity eviction, the disabled
 * no-op mode, and silent degradation when the cache directory is unusable.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersistentAnswerCache, imageDigest, semanticCacheKey, defaultCacheDir } from '../src/cache.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-vision-cache-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function keyParts(overrides: Record<string, string | number | boolean> = {}) {
  return {
    imageDigest: 'a'.repeat(64),
    model: 'vision-1',
    prompt: 'p',
    maxEdge: 1568,
    compressEnabled: true,
    apiStyle: 'chat-completions',
    ...overrides,
  }
}

describe('semanticCacheKey / imageDigest', () => {
  it('keys on the image digest, model, prompt, and preprocess parameters', () => {
    const a = semanticCacheKey(keyParts())
    expect(a).toBe(semanticCacheKey(keyParts()))
    expect(a).not.toBe(semanticCacheKey(keyParts({ prompt: 'q' })))
    expect(a).not.toBe(semanticCacheKey(keyParts({ model: 'other' })))
    expect(a).not.toBe(semanticCacheKey(keyParts({ maxEdge: 0 })))
    expect(a).not.toBe(semanticCacheKey(keyParts({ compressEnabled: false })))
    expect(a).not.toBe(semanticCacheKey(keyParts({ apiStyle: 'responses' })))
  })

  it('digests image bytes stably', () => {
    expect(imageDigest(Buffer.from('abc'))).toBe(imageDigest(Buffer.from('abc')))
    expect(imageDigest(Buffer.from('abc'))).not.toBe(imageDigest(Buffer.from('abd')))
  })

  it('defaults the cache dir under the platform cache root', () => {
    expect(defaultCacheDir()).toContain('dsh-llm-vision')
  })
})

describe('PersistentAnswerCache', () => {
  it('round-trips an answer and persists across instances', async () => {
    const dir = await tempDir()
    const key = semanticCacheKey(keyParts())
    const first = new PersistentAnswerCache({ cacheDir: dir })
    expect(first.get(key)).toBeUndefined()
    first.put(key, 'answer text')
    // A fresh instance over the same directory sees the entry.
    const second = new PersistentAnswerCache({ cacheDir: dir })
    expect(second.get(key)).toBe('answer text')
  })

  it('stores only the text answer, never image bytes', async () => {
    const dir = await tempDir()
    const key = semanticCacheKey(keyParts())
    new PersistentAnswerCache({ cacheDir: dir }).put(key, 'answer')
    const raw = await import('node:fs/promises').then(m => m.readFile(join(dir, 'responses.json'), 'utf8'))
    expect(raw).toContain('answer')
    expect(raw).not.toContain('PNG')
  })

  it('expires entries past the TTL', async () => {
    const dir = await tempDir()
    const key = semanticCacheKey(keyParts())
    new PersistentAnswerCache({ cacheDir: dir, ttlDays: 30 }).put(key, 'answer')
    // A TTL of 0 seconds expires immediately.
    expect(new PersistentAnswerCache({ cacheDir: dir, ttlDays: 0 }).get(key)).toBeUndefined()
  })

  it('evicts the oldest entries beyond the cap', async () => {
    const dir = await tempDir()
    const cache = new PersistentAnswerCache({ cacheDir: dir, maxEntries: 2 })
    cache.put(semanticCacheKey(keyParts({ prompt: 'p1' })), '1')
    cache.put(semanticCacheKey(keyParts({ prompt: 'p2' })), '2')
    cache.put(semanticCacheKey(keyParts({ prompt: 'p3' })), '3')
    expect(cache.get(semanticCacheKey(keyParts({ prompt: 'p1' })))).toBeUndefined()
    expect(cache.get(semanticCacheKey(keyParts({ prompt: 'p2' })))).toBe('2')
    expect(cache.get(semanticCacheKey(keyParts({ prompt: 'p3' })))).toBe('3')
  })

  it('is a silent no-op when disabled', async () => {
    const dir = await tempDir()
    const cache = new PersistentAnswerCache({ cacheDir: dir, enabled: false })
    cache.put('k', 'v')
    expect(cache.get('k')).toBeUndefined()
    const exists = await import('node:fs/promises').then(m => m.stat(join(dir, 'responses.json')).then(() => true).catch(() => false))
    expect(exists).toBe(false)
  })

  it('degrades silently when the cache directory is unusable', async () => {
    const dir = await tempDir()
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'file')
    // cacheDir points at a FILE: every write/read path must fail silently.
    const cache = new PersistentAnswerCache({ cacheDir: blocker })
    cache.put('k', 'v')
    expect(cache.get('k')).toBeUndefined()
  })
})
