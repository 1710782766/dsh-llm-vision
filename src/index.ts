/**
 * Model-facing vision + OCR for text-only models — the TypeScript-native port
 * of llm_vision (MIT). Two tools: describe_image (normal / critical
 * inspection perspectives) and extract_text (OCR & document parsing). Each
 * call loads one image — a local file path or an http(s) URL — preprocesses
 * oversize inputs, and asks a vision-language model at an OpenAI-compatible
 * endpoint; only the returned text crosses into the conversation, so the
 * image never enters the session log. Reliability engineering: retries with
 * shrinking budgets, a persistent content-addressed answer cache, bounded
 * reads and redirect-refusing fetches. The API key resolves per call (inline
 * config value, then the credential seam, then the launch environment).
 * @module dsh-llm-vision
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { registerAttachRoute } from './attach-routes.ts'
import { DEFAULT_MAX_BYTES } from './media.ts'
import { Config, LLM_VISION_SETTINGS_NAMESPACE, resolveApiKey, resolveConfig, type ResolvedConfig } from './config-resolve.ts'
import { loadImage, callVision, type LoadedImage } from './vision-client.ts'
import type { ImageMimeType } from './media.ts'
import { preprocessImage } from './preprocess.ts'
import { PersistentAnswerCache, semanticCacheKey, imageDigest } from './cache.ts'
import { mountOnce } from './mount-once.ts'

export const name = 'llm-vision'
export const inject = ['tools', 'webServer']

// Public surface re-exported unchanged from the split modules.
export { DEFAULT_MAX_BYTES, sniffMimeType } from './media.ts'
export type { ImageMimeType } from './media.ts'
export {
  API_STYLES,
  Config,
  DEFAULT_API_KEY_ENV,
  DEFAULT_API_STYLE,
  DEFAULT_CACHE_ENABLED,
  DEFAULT_COMPRESS_ENABLED,
  DEFAULT_INTERCEPT_IMAGE_SEND,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_OCR_MODEL,
  DEFAULT_RENDER_IMAGE_PREVIEW,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VISION_MODEL,
  LLM_VISION_SETTINGS_NAMESPACE,
  THINKING_SUFFIXES,
  resolveApiKey,
  resolveConfig,
  splitModelSuffix,
} from './config-resolve.ts'
export type { ApiStyle, ResolvedConfig, ThinkingMode } from './config-resolve.ts'
export {
  callVision,
  createVisionCache,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  extractChatCompletionsContent,
  extractResponsesContent,
  loadImage,
  parseImageAttachmentRef,
  readAttachment,
  readBoundedBody,
  readBoundedText,
  semanticRequestKey,
  attemptTimeouts,
} from './vision-client.ts'
export type { LoadedImage, VisionCache, AnswerCache } from './vision-client.ts'
export { preprocessImage, DEFAULT_MAX_EDGE } from './preprocess.ts'
export { PersistentAnswerCache, defaultCacheDir, semanticCacheKey, imageDigest, DEFAULT_MAX_ENTRIES, DEFAULT_TTL_DAYS } from './cache.ts'
export { DEFAULT_CRITICAL_DESCRIBE_PROMPT, DEFAULT_NORMAL_DESCRIBE_PROMPT, DEFAULT_OCR_PROMPT } from './prompts.ts'

/** Accepted describe_image perspectives. */
export const PERSPECTIVES = ['normal', 'critical'] as const
export type Perspective = typeof PERSPECTIVES[number]

const DESCRIBE_HEAD =
  'Inspect one image — a local absolute path, an http(s) URL, or the JSON of an image attachment '
  + 'note — and return the text the user needs. Use when the user references an image file or URL, '
  + 'or when a task needs OCR, chart or diagram reading, screenshot or UI analysis, translation of '
  + 'image text, or photo understanding. '
  + 'Always pass an explicit prompt with a precise instruction — e.g. "transcribe all text", '
  + '"extract the table as CSV", "diagnose the UI layout problems", "translate the text into '
  + 'Chinese" — instead of leaving it to the default description: a targeted instruction produces '
  + 'a much more useful answer. '

/** The describe_image call's validated arguments. */
export interface DescribeImageArgs {
  image: string
  prompt?: string
  perspective?: Perspective
}

/** The extract_text call's validated arguments. */
export interface ExtractTextArgs {
  image: string
  prompt?: string
}

/** Pure call view: a generic read card, with a file location for local paths. */
export function describeImageCallView(args: DescribeImageArgs): GenericCallView {
  return {
    card: 'generic',
    title: 'Describe image',
    kind: 'read',
    rawInput: args,
    .../^https?:\/\//i.test(args.image) ? {} : { locations: [{ path: args.image }] },
  }
}

/** Pure call view for extract_text. */
export function extractTextCallView(args: ExtractTextArgs): GenericCallView {
  return {
    card: 'generic',
    title: 'Extract text',
    kind: 'read',
    rawInput: args,
    .../^https?:\/\//i.test(args.image) ? {} : { locations: [{ path: args.image }] },
  }
}

/** One successful vision answer's canonical value. */
export interface VisionResult {
  text: string
  model: string
  image: string
  mimeType: ImageMimeType
  bytes: number
}

/**
 * The shared pipeline: cache lookup -> load -> preprocess (oversize images
 * scale/re-encode, silently skipping on any failure) -> vision call with
 * retries -> cache write. Any failure surfaces as a readable error; the
 * image never enters the conversation.
 */
async function runVision(
  ctx: Context,
  imagePath: string,
  prompt: string,
  model: string,
  thinking: ResolvedConfig['thinking'],
  spec: ResolvedConfig,
  signal: AbortSignal,
): Promise<VisionResult> {
  const loaded = await loadImage(ctx, imagePath, signal, spec.maxBytes)
  const processed = spec.compressEnabled
    ? await preprocessImage(loaded.bytes, loaded.mimeType, spec.maxEdge)
    : { data: loaded.bytes, mime: loaded.mimeType }
  const image: LoadedImage = { bytes: processed.data, mimeType: processed.mime as LoadedImage['mimeType'] }
  const cache = spec.cacheEnabled
    ? new PersistentAnswerCache({ cacheDir: spec.cacheDir, enabled: true, ttlDays: spec.cacheTtlDays, maxEntries: spec.cacheMaxEntries })
    : undefined
  const cacheKey = semanticCacheKey({
    imageDigest: imageDigest(image.bytes),
    model,
    prompt,
    maxEdge: spec.maxEdge,
    compressEnabled: spec.compressEnabled,
    apiStyle: spec.apiStyle,
  })
  let text: string | undefined
  if (cache !== undefined) text = cache.get(cacheKey)
  if (text === undefined) {
    const apiKey = await resolveApiKey(ctx, spec)
    text = await callVision({ ...spec, model, thinking }, apiKey, prompt, image, signal)
    if (cache !== undefined) cache.put(cacheKey, text)
  }
  return { text, model, image: imagePath, mimeType: image.mimeType, bytes: image.bytes.length }
}

/**
 * Register the describe_image + extract_text tools on ctx.tools. The image
 * never enters the conversation: the tools return only the vision model's
 * text answer. The llm-vision settings section layers over the composition
 * entry and is re-resolved per call, so the Settings -> Plugins card's
 * changes reach the very next invocation. Repeat calls for the same image and
 * prompt reuse the persistent content-addressed cache across sessions.
 */
export const apply = mountOnce('dsh-llm-vision', applyImpl)

function applyImpl(ctx: Context, config: Config = {}): void {
  // The loader fills schema defaults before apply, so an unconfigured entry
  // still arrives with default fields set. Only a config that actually names
  // the endpoint is validated eagerly — an unconfigured mount loads silently
  // and the first call fails with a clear "unconfigured" message.
  if (config.baseURL !== undefined) {
    resolveConfig(config)
  }
  let current: () => Config = () => config
  installSettingsSection(ctx, LLM_VISION_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
    validate: (value) => {
      if (value.baseURL !== undefined) resolveConfig(value)
    },
  })
  const spec = (): ResolvedConfig => resolveConfig(current())
  registerAttachRoute(ctx, () => current().maxBytes ?? DEFAULT_MAX_BYTES)

  ctx.tools.register(defineTool({
    name: 'describe_image',
    description: DESCRIBE_HEAD
      + 'The image may be a local path, an http(s) URL, the JSON object from an [image attachment …] '
      + 'note, or a short markdown image reference like ![图片](/llm-vision/raw/sha256:abc…) pasted '
      + 'into the conversation. In the markdown form, take the attachment id from the URL and pass that id '
      + 'as the image value (never the whole markdown, and never a made-up path); the tool resolves '
      + 'the id to the stored image. The image itself never enters the conversation — only the '
      + 'returned text is shown to you. '
      + 'perspective selects the viewing lens: "normal" (default) gives a natural description for '
      + 'everyday look-at-this-image questions; "critical" is an objective inspection that actively '
      + 'reports text misalignment, overlap, occlusion, wrapping anomalies, missing elements and '
      + 'display errors, and separates fact from guess. '
      + '【MUST use perspective="critical"】 when the user reports page/UI problems (e.g. "页面有问题", '
      + '"不好看", "感觉哪里不对", "检查一下这个页面", "找 bug", "排查渲染问题") or asks to compare a '
      + 'screenshot against a design/expectation — vision models rationalize rendering bugs, and the '
      + 'critical prompt is what makes screenshot QA reliable.',
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: 'Absolute path to a local image file, an http(s) URL of the image, the JSON object from an [image attachment …] note, or the bare attachment id (e.g. sha256:abc…) taken from the markdown image reference ![图片](/llm-vision/raw/<id>) that the plugin\'s input-box image button pasted into the conversation.',
      },
      prompt: {
        type: 'string',
        description: 'Your precise instruction for the vision model about this image (e.g. "transcribe all text", "extract the table as CSV", "diagnose the UI problems", "translate the text"). Prefer a targeted prompt over the default description.',
      },
      perspective: {
        type: 'string',
        enum: [...PERSPECTIVES],
        description: 'Viewing lens: "normal" (default, natural description) or "critical" (objective inspection that actively reports anomalies). Use "critical" for page/UI problem reports and screenshot-vs-design comparisons.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          model: { type: 'string', required: true },
          image: { type: 'string', required: true },
          mimeType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const perspective: Perspective = (args.perspective ?? 'normal') as Perspective
      if (!PERSPECTIVES.includes(perspective)) {
        throw new Error(
          `llm-vision: perspective 必须是 ${PERSPECTIVES.join(' 或 ')}，当前值: ${String(args.perspective)}`,
        )
      }
      const active = spec()
      const prompt = args.prompt ?? (perspective === 'critical' ? active.criticalPrompt : active.normalPrompt)
      return runVision(ctx, args.image, prompt, active.model, active.thinking, active, exec.signal)
    },
    presentCall: describeImageCallView,
  }))

  ctx.tools.register(defineTool({
    name: 'extract_text',
    description:
      'Extract text from one image — a local absolute path, an http(s) URL, or the JSON of an image '
      + 'attachment note — through a dedicated OCR model. Use for documents, ID cards, invoices, '
      + 'receipts, and any task that needs the verbatim text of an image. '
      + 'Pass an explicit prompt to ask for structured output, e.g. "extract the name and ID number '
      + 'as JSON" or "transcribe the table as CSV". The OCR pipeline only extracts what is actually '
      + 'visible and never guesses missing text. The image itself never enters the conversation — '
      + 'only the returned text is shown to you. '
      + 'The image may be a local path, an http(s) URL, the JSON object from an [image attachment …] '
      + 'note, or a short markdown image reference like ![图片](/llm-vision/raw/sha256:abc…). In the '
      + 'markdown form, pass the bare attachment id from the URL as the image value.',
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: 'Absolute path to a local image file, an http(s) URL of the image, the JSON object from an [image attachment …] note, or the bare attachment id (e.g. sha256:abc…) from a markdown image reference ![图片](/llm-vision/raw/<id>).',
      },
      prompt: {
        type: 'string',
        description: 'Optional extraction instruction (e.g. "extract the name and ID number as JSON", "transcribe the table as CSV"). Defaults to verbatim full-text extraction.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          model: { type: 'string', required: true },
          image: { type: 'string', required: true },
          mimeType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const active = spec()
      const prompt = args.prompt ?? active.ocrPrompt
      return runVision(ctx, args.image, prompt, active.ocrModel, active.ocrThinking, active, exec.signal)
    },
    presentCall: extractTextCallView,
  }))
}
