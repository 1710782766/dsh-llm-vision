/**
 * Vision HTTP client for the llm-vision tools: loads one image (local path,
 * http(s) URL, or a stored attachment reference), builds the endpoint request
 * that matches the configured protocol style (chat-completions or responses),
 * and reads back the single text answer — with llm_vision's reliability
 * engineering: transient failures (timeout, network, HTTP 5xx/429) retry up
 * to maxRetries times with exponential backoff under a shrinking per-attempt
 * budget (total ≤ 2× timeout). A short-lifetime, capacity-capped semantic
 * cache avoids a second round trip for repeat calls in quick succession; the
 * persistent cross-session cache lives in cache.ts. Response bodies and error
 * excerpts are capped before any bytes are trusted.
 * @module dsh-llm-vision/vision
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { attachmentRefById } from './attach-routes.ts'
import { DEFAULT_MAX_BYTES, isAttachMediaType, sniffMimeType, type ImageMimeType } from './media.ts'
import type { ApiStyle, ResolvedConfig } from './config-resolve.ts'

/** One loaded image: its bytes and the sniffed media type. */
export interface LoadedImage {
  bytes: Buffer
  mimeType: ImageMimeType
}

/** Error text shown when a model-supplied attachment reference does not validate. */
const ATTACHMENT_REF_GUIDANCE =
  'llm-vision: image is not a valid attachment reference; copy the exact JSON from the [image attachment …] note'

/** Promise rejection helper shared by both response-shape extractors. */
function unexpectedShape(): never {
  throw new Error('llm-vision: vision endpoint returned an unexpected response shape')
}

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Whether a record field holds a positive safe integer. */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** A non-empty string from a record under `key`, else undefined. */
function nonEmptyString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Whether `error` carries the attachment store not-found marker. */
function isAttachmentNotFound(error: unknown): boolean {
  return asRecord(error)?.['code'] === 'ATTACHMENT_NOT_FOUND'
}

/**
 * Validate and narrow a model-supplied attachment reference into its typed storage
 * form. Every field is re-checked (the schema is authoritative, not a cast), and a
 * misshaped value fails with the copy-verbatim guidance.
 * @param raw - the JSON the model copied from an `[image attachment …]` note.
 * @returns the narrowed, typed reference.
 */
export function parseImageAttachmentRef(raw: string): ImageAttachmentRef {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(ATTACHMENT_REF_GUIDANCE)
  }
  const record = asRecord(parsed)
  if (record === undefined) throw new Error(ATTACHMENT_REF_GUIDANCE)
  const attachmentId = nonEmptyString(record, 'attachmentId')
  const mediaType = record['mediaType']
  const bytes = record['bytes']
  const width = record['width']
  const height = record['height']
  const name = record['name']
  if (attachmentId === undefined
    || !isAttachMediaType(mediaType)
    || !isPositiveSafeInteger(bytes)
    || !isPositiveSafeInteger(width)
    || !isPositiveSafeInteger(height)
    || (name !== undefined && typeof name !== 'string')) {
    throw new Error(ATTACHMENT_REF_GUIDANCE)
  }
  const ref: ImageAttachmentRef = {
    attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType,
    bytes,
    width,
    height,
    ...name === undefined ? {} : { name },
  }
  return ref
}

/**
 * Validate a model-supplied attachment reference and read its verified bytes.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param raw - the raw JSON the model copied from an `[image attachment …]` note.
 * @param signal - caller cancellation.
 * @returns the verified stored bytes.
 */
export async function readAttachment(ctx: Context, raw: string, signal: AbortSignal): Promise<Buffer> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('llm-vision: no attachment service is mounted; pass a file path or URL instead')
  }
  const ref = parseImageAttachmentRef(raw)
  try {
    const stored = await attachments.readImage(ref, signal)
    return Buffer.from(stored.data)
  } catch (error) {
    if (isAttachmentNotFound(error)) {
      throw new Error(`llm-vision: attachment ${JSON.stringify(ref.attachmentId)} is no longer available`)
    }
    throw error
  }
}

/** Sniff the media type and reject empty or unsupported inputs. */
function toImage(bytes: Buffer, source: string): LoadedImage {
  if (bytes.length === 0) throw new Error(`llm-vision: image is empty: ${source}`)
  const mimeType = sniffMimeType(bytes)
  if (mimeType === undefined) {
    throw new Error(`llm-vision: unsupported image type (expected PNG, JPEG, GIF, WebP, HEIC, or HEIF): ${source}`)
  }
  return { bytes, mimeType }
}

/** Bound-check then sniff one loaded buffer — the shared tail of every input branch. */
function finishLoad(bytes: Buffer, source: string, maxBytes: number): LoadedImage {
  if (bytes.length > maxBytes) {
    throw new Error(`llm-vision: image is ${bytes.length} bytes, above the ${maxBytes}-byte bound`)
  }
  return toImage(bytes, source)
}

/**
 * Load one image from a local absolute path, an http(s) URL, or a durable attachment reference
 * (the JSON an `[image attachment …]` note carries), enforcing the byte bound before any bytes
 * reach the vision model. Non-http(s) URL schemes are rejected.
 * @param ctx - registrant context; supplies the optional attachment service.
 * @param input - the model-supplied image reference.
 * @param signal - caller cancellation.
 * @param maxBytes - image byte bound.
 * @returns the loaded bytes and sniffed media type.
 */
export async function loadImage(ctx: Context, input: string, signal: AbortSignal, maxBytes: number): Promise<LoadedImage> {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new Error('llm-vision: image must be a non-empty path, URL, or attachment reference')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('llm-vision: only http(s) URLs, local file paths, and attachment references are supported')
  }
  if (trimmed.startsWith('{')) {
    const bytes = await readAttachment(ctx, trimmed, signal)
    return finishLoad(bytes, trimmed.slice(0, 96), maxBytes)
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed, { signal, redirect: 'error' })
    if (!response.ok) {
      throw new Error(`llm-vision: image fetch returned HTTP ${response.status}`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isSafeInteger(declared) && declared > maxBytes) {
      throw new Error(`llm-vision: image is ${declared} bytes, above the ${maxBytes}-byte bound`)
    }
    const bytes = await readBoundedBody(response, maxBytes)
    return finishLoad(bytes, trimmed, maxBytes)
  }
  // A bare attachment id — the `sha256:…` string text models tend to copy out of
  // an `[image attachment …]` note instead of the whole JSON. Resolve it through
  // the attach-route registry (the store's digest verification still runs).
  const registered = attachmentRefById(trimmed)
  if (registered !== undefined) {
    const bytes = await readAttachment(ctx, JSON.stringify(registered), signal)
    return finishLoad(bytes, trimmed, maxBytes)
  }
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(trimmed, { bigint: false })
  } catch (error) {
    // Errors here carry no llm-vision prefix by nature (ENOENT etc.); wrap so
    // every surfaced error honors the "llm-vision: " contract.
    throw new Error(`llm-vision: cannot read image file: ${(error as Error).message}`)
  }
  if (!info.isFile()) throw new Error(`llm-vision: image path is not a file: ${trimmed}`)
  if (info.size > maxBytes) {
    throw new Error(`llm-vision: image is ${info.size} bytes, above the ${maxBytes}-byte bound`)
  }
  let bytes: Buffer
  try {
    bytes = await readFile(trimmed, { signal })
  } catch (error) {
    throw new Error(`llm-vision: cannot read image file: ${(error as Error).message}`)
  }
  return finishLoad(bytes, trimmed, maxBytes)
}

/**
 * Read a response body up to a byte cap, rejecting the whole response beyond it.
 * @param response - the response to drain.
 * @param cap - the byte bound.
 * @returns the accumulated body bytes.
 */
/** Drain a response body chunk by chunk, always releasing the reader lock. */
async function drainResponse(response: Response, onChunk: (value: Uint8Array) => 'stop' | undefined): Promise<void> {
  if (response.body === null) return
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (onChunk(value) === 'stop') return
    }
  } finally {
    reader.releaseLock()
  }
}

export async function readBoundedBody(response: Response, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  await drainResponse(response, (value) => {
    const chunk = Buffer.from(value)
    total += chunk.length
    if (total > cap) throw new Error(`llm-vision: response exceeds the ${cap}-byte bound`)
    chunks.push(chunk)
    return undefined
  })
  return Buffer.concat(chunks)
}

/**
 * Read a response body as text, truncated to a character cap (error excerpts only).
 * @param response - the response to drain.
 * @param cap - the character cap.
 * @returns the decoded text, never longer than `cap` characters.
 */
export async function readBoundedText(response: Response, cap: number): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  let stopped = false
  await drainResponse(response, (value) => {
    text += decoder.decode(value, { stream: true })
    if (text.length > cap) {
      stopped = true
      return 'stop'
    }
    return undefined
  })
  // The final flush decode matters only for a fully-read stream; a truncated
  // read cuts mid-sequence anyway.
  if (!stopped) text += decoder.decode()
  return text.length > cap ? text.slice(0, cap) : text
}

/** Extract the single text answer from an OpenAI-compatible chat-completions payload. */
export function extractChatCompletionsContent(payload: unknown): string {
  const root = asRecord(payload)
  const choices = root?.choices
  if (root === undefined || !Array.isArray(choices) || choices.length === 0) unexpectedShape()
  const message = asRecord(asRecord(choices[0])?.message)
  const content = message?.['content']
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('llm-vision: vision endpoint returned no text content')
  }
  return content
}

/** Extract the text answer from an OpenAI Responses payload: every `output_text` part of assistant messages. */
export function extractResponsesContent(payload: unknown): string {
  const root = asRecord(payload)
  const output = root?.output
  if (root === undefined || !Array.isArray(output)) unexpectedShape()
  const parts: string[] = []
  for (const item of output) {
    const itemRecord = asRecord(item)
    if (itemRecord === undefined) continue
    const { type, role, content } = itemRecord
    if (type !== 'message' || role !== 'assistant' || !Array.isArray(content)) continue
    for (const part of content) {
      const block = asRecord(part)
      if (block === undefined) continue
      if (block.type === 'output_text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        parts.push(block.text)
      }
    }
  }
  const text = parts.join('\n')
  if (text.trim().length === 0) {
    throw new Error('llm-vision: vision endpoint returned no text content')
  }
  return text
}

/**
 * Build the request the configured style sends: its path and JSON body. When the model id carried
 * a thinking suffix, Chat Completions maps it to `thinking.type` (`off` -> `disabled`, every
 * other level -> `enabled`) and Responses forwards it as `reasoning.effort` (`off` ->
 * `none`, levels pass through); without a suffix no thinking control is sent, so the endpoint
 * keeps its own default. `more` appends additional images to the same message (multi-image
 * reads, e.g. screenshot comparisons).
 */
export function buildVisionRequest(spec: ResolvedConfig, prompt: string, image: LoadedImage, more: LoadedImage[] = []): { path: string; body: string } {
  const images = [image, ...more]
  const dataUrls = images.map(im => `data:${im.mimeType};base64,${im.bytes.toString('base64')}`)
  if (spec.apiStyle === 'responses') {
    return {
      path: `${spec.baseURL}/responses`,
      body: JSON.stringify({
        model: spec.model,
        max_output_tokens: spec.maxOutputTokens,
        ...spec.thinking === undefined ? {} : { reasoning: { effort: spec.thinking === 'off' ? 'none' : spec.thinking } },
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            ...dataUrls.map(url => ({ type: 'input_image', image_url: url })),
          ],
        }],
      }),
    }
  }
  return {
    path: `${spec.baseURL}/chat/completions`,
    body: JSON.stringify({
      model: spec.model,
      max_tokens: spec.maxOutputTokens,
      ...spec.thinking === undefined ? {} : { thinking: { type: spec.thinking === 'off' ? 'disabled' : 'enabled' } },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...dataUrls.map(url => ({ type: 'image_url', image_url: { url } })),
        ],
      }],
    }),
  }
}

/** Default semantic-cache lifetime for a successful vision answer, in milliseconds. */
export const DEFAULT_CACHE_TTL_MS = 10_000
/** Default upper bound on cached vision answers. */
export const DEFAULT_CACHE_MAX_ENTRIES = 32

/** A bounded, TTL-expiring cache of successful vision answers. */
export interface VisionCache {
  /** Look up a cached answer, honoring the TTL. */
  get(key: string): string | undefined
  /** Store an answer with a fresh TTL, evicting expired and then oldest entries. */
  set(key: string, text: string): void
  /** Number of live cached answers. */
  readonly size: number
  /** Running cache hits, for observability and tests. */
  readonly hits: number
  /** Running cache misses, for observability and tests. */
  readonly misses: number
  /** Drop every entry. */
  clear(): void
}

/** Create a TTL-expiring, capacity-capped vision answer cache. */
export function createVisionCache(options?: { ttlMs?: number; maxEntries?: number }): VisionCache {
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS
  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES)
  const entries = new Map<string, { text: string; expiresAt: number }>()
  let hits = 0
  let misses = 0
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) { misses += 1; return undefined }
      if (entry.expiresAt <= Date.now()) { entries.delete(key); misses += 1; return undefined }
      hits += 1
      return entry.text
    },
    set(key, text) {
      const now = Date.now()
      for (const [k, entry] of entries) if (entry.expiresAt <= now) entries.delete(k)
      entries.set(key, { text, expiresAt: now + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    get size() { return entries.size },
    get hits() { return hits },
    get misses() { return misses },
    clear() { entries.clear() },
  }
}

/**
 * The semantic identity of one vision request: endpoint fields plus the same image bytes and prompt.
 * A single image keeps the v1 key layout so previously cached answers still hit; multi-image
 * requests key on the digest list instead.
 */
export function semanticRequestKey(spec: ResolvedConfig, prompt: string, image: LoadedImage, more: LoadedImage[] = []): string {
  // Key by a digest of the bytes, not the base64 text itself: the full
  // encoding is ~1.33x a multi-MB image and every cached entry would pin
  // that string for the TTL, while a digest is 64 chars.
  if (more.length === 0) {
    const digest = createHash('sha256').update(image.bytes).digest('hex')
    return JSON.stringify([
      spec.baseURL, spec.model, spec.maxOutputTokens, spec.apiStyle, spec.thinking,
      digest, image.mimeType, prompt,
    ])
  }
  const digests = [image, ...more].map(im => createHash('sha256').update(im.bytes).digest('hex'))
  const mimes = [image, ...more].map(im => im.mimeType)
  return JSON.stringify([
    spec.baseURL, spec.model, spec.maxOutputTokens, spec.apiStyle, spec.thinking,
    digests, mimes, prompt,
  ])
}

/** HTTP statuses retried as transient failures. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])
/** Exponential backoff cap in milliseconds (llm_vision parity). */
const MAX_BACKOFF_MS = 4000
/** Minimum per-attempt budget in milliseconds; later attempts below it are dropped. */
const MIN_ATTEMPT_MS = 10_000

/** The cache surface callVision reads/writes; both the short-lived in-memory cache and the persistent one satisfy it. */
export interface AnswerCache {
  get(key: string): string | undefined
  set(key: string, text: string): void
}

/**
 * Compute the per-attempt timeout budgets: timeout / 2^k for k = 0..maxRetries,
 * so the total budget stays below 2× timeout; attempts under the floor are
 * dropped once at least one attempt exists (llm_vision parity).
 */
export function attemptTimeouts(timeoutMs: number, maxRetries: number): number[] {
  const attempts: number[] = []
  for (let k = 0; k <= maxRetries; k += 1) {
    const t = timeoutMs / (2 ** k)
    if (t < MIN_ATTEMPT_MS && attempts.length > 0) break
    attempts.push(t)
  }
  return attempts
}

/** Backoff sleep; stubbed in tests. */
export async function backoff(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/** Extract a bounded human-readable detail from a failed endpoint response body. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const text = await readBoundedText(response, 200)
    try {
      const body = JSON.parse(text) as unknown
      const record = body as Record<string, unknown> | null
      const error = record?.['error'] as Record<string, unknown> | null
      const message = typeof error?.['message'] === 'string' ? error.message : ''
      return message.length > 0 ? message : text
    } catch {
      return text
    }
  } catch {
    return ''
  }
}

/**
 * Call the configured vision endpoint and return its text answer — with retries:
 * timeouts, network failures, and HTTP 429/5xx are transient and retried up to
 * spec.maxRetries with exponential backoff under a shrinking per-attempt budget;
 * caller cancellation aborts immediately without retry. Failures surviving
 * every retry carry a （已重试 N 次） suffix (llm_vision parity).
 */
export async function callVision(
  spec: ResolvedConfig,
  apiKey: string,
  prompt: string,
  image: LoadedImage,
  signal: AbortSignal,
  cache?: AnswerCache,
  backoffFn: (ms: number) => Promise<void> = backoff,
  more: LoadedImage[] = [],
): Promise<string> {
  const key = semanticRequestKey(spec, prompt, image, more)
  if (cache !== undefined) {
    const cached = cache.get(key)
    if (cached !== undefined) return cached
  }
  const { path, body } = buildVisionRequest(spec, prompt, image, more)
  let failedAttempt = 0
  let lastError: Error | undefined
  const budgets = attemptTimeouts(spec.timeoutMs, spec.maxRetries)
  for (let i = 0; i < budgets.length; i += 1) {
    const attemptMs = budgets[i]
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(attemptMs)]),
      })
      if (!response.ok) {
        const detail = await errorDetail(response)
        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          lastError = new Error(`llm-vision: vision endpoint returned HTTP ${response.status}: ${detail}`)
          failedAttempt = i
        } else {
          const suffix = failedAttempt > 0 ? `（已重试 ${failedAttempt} 次）` : ''
          throw new Error(`llm-vision: vision endpoint returned HTTP ${response.status}: ${detail}${suffix}`)
        }
      } else {
        const payloadBytes = await readBoundedBody(response, spec.maxOutputTokens * 8 + 64 * 1024)
        let payload: unknown
        try {
          payload = JSON.parse(payloadBytes.toString('utf8'))
        } catch {
          throw new Error('llm-vision: vision endpoint returned invalid JSON')
        }
        const text = spec.apiStyle === 'responses' ? extractResponsesContent(payload) : extractChatCompletionsContent(payload)
        if (cache !== undefined) cache.set(key, text)
        return text
      }
    } catch (error) {
      if (signal.aborted) throw error // caller cancellation: never retry
      const isTimeout = error instanceof Error && error.name === 'TimeoutError'
      const isNetwork = error instanceof TypeError
      if (isTimeout) {
        lastError = new Error(`llm-vision: request timed out (${Math.round(attemptMs / 1000)}s), try again or raise timeoutMs`)
        failedAttempt = i
      } else if (isNetwork) {
        lastError = new Error(`llm-vision: network error: ${(error as Error).message}`)
        failedAttempt = i
      } else {
        throw error // non-retryable (parse/shape/bounds) — no retry
      }
    }
    if (i < budgets.length - 1) await backoffFn(Math.min(2 ** i, MAX_BACKOFF_MS / 1000) * 1000)
  }
  if (lastError === undefined) {
    throw new Error('llm-vision: no usable request attempt (check timeoutMs / maxRetries)')
  }
  const suffix = failedAttempt > 0 ? `（已重试 ${failedAttempt} 次）` : ''
  throw new Error(`${lastError.message}${suffix}`)
}