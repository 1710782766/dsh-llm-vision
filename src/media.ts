/**
 * Shared image-media facts for the describe-image plugin: the accepted media
 * types, the magic-byte gate, and the byte bound both the tool and the attach
 * route enforce. Kept in its own module so the attach route can import it
 * without a cycle through the plugin entry.
 * @module @linxin666/dsh-tool-describe-image/media
 */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Image media types the magic-byte gate accepts. */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/heic' | 'image/heif'

/** The accepted image media types, in stable order. */
export const IMAGE_MEDIA_TYPES: readonly ImageMimeType[] = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
]

/**
 * Media types the attachment/upload channel accepts. The official attachment
 * store's ImageMediaType covers only these four, so HEIF-family uploads are
 * rejected here; the tools still read local HEIC/HEIF paths and URLs directly
 * (preprocessing re-encodes them to JPEG before the endpoint call).
 */
export const ATTACH_MEDIA_TYPES: readonly ImageMimeType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Upper bound on image bytes (local files and downloaded URLs alike). */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

/** Whether the declared media type is one the plugin accepts. */
export function isImageMimeType(value: unknown): value is ImageMimeType {
  return typeof value === 'string' && (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}

/** Whether the declared media type is one the attachment channel accepts (no HEIF). */
export function isAttachMediaType(value: unknown): value is ImageMediaType {
  return typeof value === 'string' && (ATTACH_MEDIA_TYPES as readonly string[]).includes(value)
}

/**
 * Detect the image media type from magic bytes.
 * @param bytes - the leading bytes of the input.
 * @returns the accepted media type, or `undefined` for unknown or truncated inputs.
 */
export function sniffMimeType(bytes: Buffer): ImageMimeType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  // HEIF-family: an ISO BMFF `ftyp` box whose major brand is a HEIC/HEIF brand.
  // (mif1/avif brands are deliberately not accepted — HEIC/HEIF only.)
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii')
    if (brand === 'heic' || brand === 'heix' || brand === 'heim' || brand === 'heis') return 'image/heic'
    if (brand === 'heif') return 'image/heif'
  }
  return undefined
}

/**
 * Strictly decode a base64 payload: the standard alphabet, correct padding,
 * and a length that is a multiple of four. Rejects anything `Buffer.from`
 * would silently tolerate.
 * @param encoded - the base64 text.
 * @returns the decoded bytes, or `undefined` when the text is not valid base64.
 */
export function decodeBase64(encoded: string): Buffer | undefined {
  if (encoded.length === 0 || encoded.length % 4 !== 0) return undefined
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return undefined
  if (/=/.test(encoded) && !/={1,2}$/.test(encoded)) return undefined
  const bytes = Buffer.from(encoded, 'base64')
  // Buffer.from is lenient; re-encoding must reproduce the input exactly.
  if (bytes.toString('base64') !== encoded) return undefined
  return bytes
}
