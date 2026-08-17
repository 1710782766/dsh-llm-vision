/**
 * Built-in image preprocessing ported from llm_vision (MIT): downscale / re-encode
 * oversize images before they reach the vision endpoint, avoiding the classic
 * "big screenshot times out" failure. Based on the macOS system sips binary
 * (zero runtime dependencies); on platforms without sips — or on any failure —
 * the original image is returned silently and the caller relies on timeout +
 * retry instead. Only oversize images are touched.
 * @module dsh-llm-vision/preprocess
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Max image edge (px) before auto-scaling; DashScope's recommended ceiling. */
export const DEFAULT_MAX_EDGE = 1568
/** Files larger than this are candidates for re-encoding. */
export const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024
/** JPEG quality for re-encoded images. */
export const JPEG_QUALITY = 85
/** sips timeout per invocation. */
export const SIPS_TIMEOUT_MS = 30_000
/** Guard against decompression bombs: discard sips output beyond this. */
export const MAX_OUTPUT_BYTES = 50 * 1024 * 1024

/** Formats that keep transparency: sips composites transparency onto white when re-encoding to JPEG. */
const TRANSPARENT_MIMES = new Set(['image/png', 'image/webp', 'image/gif'])

/** File extension per MIME type for the temp source file. */
const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/** Promise wrapper for execFile with timeout; rejects on non-zero exit or timeout. */
function runSips(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('sips', args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolve(stdout)
    })
  })
}

/** Read pixel dimensions via sips; null on any failure. */
async function sipsSize(sips: string, path: string): Promise<{ width: number; height: number } | null> {
  try {
    const stdout = await runSips(['-g', 'pixelWidth', '-g', 'pixelHeight', path], SIPS_TIMEOUT_MS)
    let width: number | undefined
    let height: number | undefined
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('pixelWidth:')) width = Number(trimmed.slice('pixelWidth:'.length).trim())
      else if (trimmed.startsWith('pixelHeight:')) height = Number(trimmed.slice('pixelHeight:'.length).trim())
    }
    if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) return null
    return { width, height }
  } catch {
    return null
  }
}

/**
 * Scale / re-encode an oversize image in place, returning the possibly smaller
 * (bytes, mimeType). Unchanged inputs and every failure return the original
 * pair — preprocessing never breaks the call chain.
 * @param data - loaded image bytes.
 * @param mime - media type of the input.
 * @param maxEdge - edge threshold; values <= 0 disable processing.
 */
export async function preprocessImage(data: Buffer, mime: string, maxEdge: number = DEFAULT_MAX_EDGE): Promise<{ data: Buffer; mime: string }> {
  if (maxEdge <= 0) return { data, mime }

  // Small files: probe dimensions first, only oversize edges need work.
  if (data.length <= COMPRESS_THRESHOLD_BYTES) {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-vision-'))
    try {
      const src = join(dir, 'src' + (EXT_FOR_MIME[mime] ?? '.jpg'))
      await writeFile(src, data)
      const size = await sipsSize('sips', src)
      if (size === null || Math.max(size.width, size.height) <= maxEdge) return { data, mime }
    } catch {
      return { data, mime }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // Needs processing: -Z scales down oversized edges (no-op for smaller),
  // and the re-encode to jpeg q85 / png (transparent formats) shrinks bytes.
  let newBytes: Buffer
  let format: 'jpeg' | 'png'
  try {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-vision-'))
    try {
      const src = join(dir, 'src' + (EXT_FOR_MIME[mime] ?? '.jpg'))
      await writeFile(src, data)
      const out = join(dir, 'out')
      format = TRANSPARENT_MIMES.has(mime) ? 'png' : 'jpeg'
      const args = ['-Z', String(maxEdge), '-s', 'format', format]
      if (format === 'jpeg') args.push('-s', 'formatOptions', String(JPEG_QUALITY))
      args.push(src, '--out', out)
      await runSips(args, SIPS_TIMEOUT_MS)
      const stat = await import('node:fs/promises').then(m => m.stat(out)).catch(() => null)
      if (stat === null || stat.size >= MAX_OUTPUT_BYTES) return { data, mime }
      newBytes = await readFile(out)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  } catch {
    return { data, mime }
  }
  const newMime = format === 'png' ? 'image/png' : 'image/jpeg'
  // Never return something larger than the input (sips cannot always win).
  return newBytes.length <= data.length ? { data: newBytes, mime: newMime } : { data, mime }
}
