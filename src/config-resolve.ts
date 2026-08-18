/**
 * Config and credential facts for the llm-vision tools. Holds the validated
 * ResolvedConfig snapshot (defaults, bounds, and endpoint facts), the API-key
 * resolution seams, and the schemastery section that doubles as the plugin's
 * settings card schema. Kept separate from tool registration and the vision
 * HTTP client so single purpose stays single file.
 * @module dsh-llm-vision/config
 */

import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { DEFAULT_MAX_BYTES } from './media.ts'
import { DEFAULT_MAX_EDGE } from './preprocess.ts'
import { DEFAULT_MAX_ENTRIES, DEFAULT_TTL_DAYS } from './cache.ts'
import { DEFAULT_CRITICAL_DESCRIBE_PROMPT, DEFAULT_NORMAL_DESCRIBE_PROMPT, DEFAULT_OCR_PROMPT } from './prompts.ts'

/** Environment-variable name the API key resolves through when no inline key is configured. */
export const DEFAULT_API_KEY_ENV = 'VISION_API_KEY'
/** Per-call output-token cap sent to the vision model. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024
/** Thinking-level suffixes accepted after the model id: :off disables thinking, the rest enable it. */
export const THINKING_SUFFIXES = ['off', 'low', 'medium', 'high'] as const
/** One parsed thinking level from a model-id suffix, or undefined when the model id carries none. */
export type ThinkingMode = typeof THINKING_SUFFIXES[number]
/** Per-call vision request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 60_000
/** Retries for transient failures (timeout, network, HTTP 5xx/429). */
export const DEFAULT_MAX_RETRIES = 2
/** Protocol styles the tool can speak to the configured endpoint. */
export const API_STYLES = ['chat-completions', 'responses'] as const
export type ApiStyle = typeof API_STYLES[number]
/** Protocol style used unless the configuration overrides it. */
export const DEFAULT_API_STYLE: ApiStyle = 'chat-completions'
/** Whether conversation image references upgrade into inline thumbnails unless configured otherwise. */
export const DEFAULT_RENDER_IMAGE_PREVIEW = true
/** Whether image-bearing sends are rewritten into attach references at submit. */
export const DEFAULT_INTERCEPT_IMAGE_SEND = true
/** Whether oversize images are auto-scaled/re-encoded before the call. */
export const DEFAULT_COMPRESS_ENABLED = true
/** Whether successful answers are stored in the persistent cache. */
export const DEFAULT_CACHE_ENABLED = true

/** The default vision model (llm_vision parity: qwen3-vl-plus). */
export const DEFAULT_VISION_MODEL = 'qwen3-vl-plus'
/** The default OCR model (llm_vision parity: qwen3.5-ocr). */
export const DEFAULT_OCR_MODEL = 'qwen3.5-ocr'

/** The `provider` switch values: 'custom' means every endpoint field is explicit. */
export const PROVIDER_IDS = ['custom', 'dashscope', 'zhipu', 'gemini'] as const
export type ProviderId = typeof PROVIDER_IDS[number]
/** The provider used when the configuration names none. */
export const DEFAULT_PROVIDER: ProviderId = 'custom'

/** One built-in endpoint preset: a provider switch fills baseURL / model / ocrModel / apiKeyEnv. */
export interface ProviderPreset {
  /** Root of the OpenAI-compatible endpoint. */
  baseURL: string
  /** Vision model id for describe_image. */
  model: string
  /** OCR model id for extract_text; free presets reuse the vision model (prompt-driven OCR). */
  ocrModel: string
  /** Environment-variable name this provider's key is conventionally stored under. */
  apiKeyEnv: string
}

/**
 * The shipped provider presets. Free-tier facts verified 2026-08 against the
 * community provider registry and the Google AI docs; policies change, so the
 * model ids live here — one edit re-targets every preset user.
 */
export const PROVIDER_PRESETS: Record<Exclude<ProviderId, 'custom'>, ProviderPreset> = {
  dashscope: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: DEFAULT_VISION_MODEL,
    ocrModel: DEFAULT_OCR_MODEL,
    apiKeyEnv: 'DASHSCOPE_API_KEY',
  },
  zhipu: {
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.6v-flash',
    ocrModel: 'glm-4.6v-flash',
    apiKeyEnv: 'ZHIPU_API_KEY',
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-3.7-flash',
    ocrModel: 'gemini-3.7-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
}

/**
 * Split a model id into the id the endpoint receives and its thinking-level suffix. A trailing
 * :off / :low / :medium / :high is the plugin's shorthand for the thinking control:
 * the suffix never reaches the endpoint, and a model id without one (or with any other suffix) is
 * forwarded verbatim with no thinking control.
 * @param model - the raw configured model id.
 * @returns the cleaned id and the parsed level, if any.
 */
export function splitModelSuffix(model: string): { model: string; thinking: ThinkingMode | undefined } {
  const trimmed = model.trim()
  const match = /:(off|low|medium|high)$/.exec(trimmed)
  if (match === null) return { model: trimmed, thinking: undefined }
  return { model: trimmed.slice(0, -match[0].length), thinking: match[1] as ThinkingMode }
}

/**
 * Deployment configuration for the llm-vision tools. The interface keeps every field optional so
 * programmatic construction is re-judged by resolveConfig; the schema requires baseURL for
 * composition entries and provides defaults for everything else.
 */
export interface Config {
  /**
   * Endpoint preset to fill baseURL / model / ocrModel / apiKeyEnv from;
   * defaults to 'custom' (every field explicit). Explicit config fields
   * always win over the preset.
   */
  provider?: ProviderId
  /** Root of the OpenAI-compatible endpoint, e.g. https://dashscope.aliyuncs.com/compatible-mode/v1; trailing slashes are stripped. */
  baseURL?: string
  /** Vision model id for describe_image, optionally with a thinking suffix (:off/:low/:medium/:high). */
  model?: string
  /** OCR model id for extract_text, optionally with a thinking suffix. */
  ocrModel?: string
  /** Inline API key; prefer apiKeyEnv with the credential seam. Feed from the environment via !!js process.env.VISION_API_KEY. */
  apiKey?: string
  /** Credential reference (environment-variable name) for the API key; defaults to VISION_API_KEY. */
  apiKeyEnv?: string
  /** Instruction used by describe_image in the critical perspective when the model omits its prompt. */
  criticalPrompt?: string
  /** Instruction used by describe_image in the normal perspective when the model omits its prompt. */
  normalPrompt?: string
  /** Instruction used by extract_text when the model omits its prompt. */
  ocrPrompt?: string
  /** Image byte bound; defaults to 10 MiB. */
  maxBytes?: number
  /** Output-token cap sent to the vision model; defaults to 1024. */
  maxOutputTokens?: number
  /** Per-call request timeout; defaults to 60000 ms. */
  timeoutMs?: number
  /** Retries for transient errors with a shrinking per-attempt budget; defaults to 2, 0 disables. */
  maxRetries?: number
  /** Protocol style of the endpoint; defaults to chat-completions. */
  apiStyle?: ApiStyle
  /** Max image edge before auto-scaling; defaults to 1568 px, 0 disables preprocessing. */
  maxEdge?: number
  /** Whether oversize images are auto-scaled/re-encoded; defaults to true. */
  compressEnabled?: boolean
  /** Whether successful answers are stored in the persistent cache; defaults to true. */
  cacheEnabled?: boolean
  /** Persistent cache directory; defaults to $XDG_CACHE_HOME/dsh-llm-vision or ~/.cache/dsh-llm-vision. */
  cacheDir?: string
  /** Cache entry lifetime in days; defaults to 30. */
  cacheTtlDays?: number
  /** Max cached answers; defaults to 500. */
  cacheMaxEntries?: number
  /**
   * Whether attach references in the conversation upgrade in place into inline
   * thumbnails; defaults to true. Display-only: the message text, the session
   * log, and the model side are untouched.
   */
  renderImagePreview?: boolean
  /**
   * Whether image-bearing sends are rewritten at submit into attach
   * references; defaults to true. Turn off to hand the raw image blocks to
   * other vision plugins sharing the session.
   */
  interceptImageSend?: boolean
}

/** Schemastery configuration for the llm-vision tools; doubles as the llm-vision settings-section schema. */
export const Config: z<Config> = z.object({
  provider: z.union(PROVIDER_IDS).default(DEFAULT_PROVIDER),
  baseURL: z.string(),
  model: z.string().default(DEFAULT_VISION_MODEL),
  ocrModel: z.string().default(DEFAULT_OCR_MODEL),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  criticalPrompt: z.string().default(DEFAULT_CRITICAL_DESCRIBE_PROMPT),
  normalPrompt: z.string().default(DEFAULT_NORMAL_DESCRIBE_PROMPT),
  ocrPrompt: z.string().default(DEFAULT_OCR_PROMPT),
  maxBytes: z.number().step(1).min(1).default(DEFAULT_MAX_BYTES),
  maxOutputTokens: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_TOKENS),
  timeoutMs: z.number().min(1).default(DEFAULT_TIMEOUT_MS),
  maxRetries: z.number().step(1).min(0).default(DEFAULT_MAX_RETRIES),
  apiStyle: z.union(API_STYLES).default(DEFAULT_API_STYLE),
  maxEdge: z.number().step(1).min(0).default(DEFAULT_MAX_EDGE),
  compressEnabled: z.boolean().default(DEFAULT_COMPRESS_ENABLED),
  cacheEnabled: z.boolean().default(DEFAULT_CACHE_ENABLED),
  cacheDir: z.string(),
  cacheTtlDays: z.number().min(1).default(DEFAULT_TTL_DAYS),
  cacheMaxEntries: z.number().step(1).min(1).default(DEFAULT_MAX_ENTRIES),
  renderImagePreview: z.boolean().default(DEFAULT_RENDER_IMAGE_PREVIEW),
  interceptImageSend: z.boolean().default(DEFAULT_INTERCEPT_IMAGE_SEND),
})

/** Settings namespace carrying the endpoint, models, and key reference the Plugins card edits. */
export const LLM_VISION_SETTINGS_NAMESPACE = settingsNamespace('llm-vision')

/** One resolved, validated configuration snapshot; defaults and beyond-schema constraints applied. */
export interface ResolvedConfig {
  /** The configured provider switch; 'custom' when the configuration named none. */
  provider: ProviderId
  baseURL: string
  model: string
  ocrModel: string
  ocrThinking: ThinkingMode | undefined
  apiKey: string | undefined
  apiKeyEnv: CredentialRef | undefined
  criticalPrompt: string
  normalPrompt: string
  ocrPrompt: string
  maxBytes: number
  maxOutputTokens: number
  timeoutMs: number
  maxRetries: number
  apiStyle: ApiStyle
  thinking: ThinkingMode | undefined
  maxEdge: number
  compressEnabled: boolean
  cacheEnabled: boolean
  cacheDir: string | undefined
  cacheTtlDays: number
  cacheMaxEntries: number
  renderImagePreview: boolean
  interceptImageSend: boolean
}

/**
 * Resolve raw config into validated connection facts. Programmatic construction may bypass
 * Schemastery normalization, so every default and bound is re-judged here; a non-empty composition
 * entry is validated at load so misconfiguration fails loud (an unconfigured mount only
 * hits it per call, inside apply).
 * @param config - raw plugin config.
 * @returns validated facts.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const provider = config.provider ?? DEFAULT_PROVIDER
  if (!PROVIDER_IDS.includes(provider)) {
    throw new Error(`llm-vision: provider must be one of ${PROVIDER_IDS.map(id => JSON.stringify(id)).join(', ')}`)
  }
  const preset = provider === 'custom' ? undefined : PROVIDER_PRESETS[provider]
  const baseURL = (config.baseURL ?? preset?.baseURL ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseURL)) {
    throw new Error('llm-vision: baseURL must be an absolute http(s) URL')
  }
  const { model, thinking } = splitModelSuffix(config.model ?? preset?.model ?? DEFAULT_VISION_MODEL)
  if (model.length === 0) throw new Error('llm-vision: model must be a non-empty model id before any :off/:low/:medium/:high suffix')
  const { model: ocrModel, thinking: ocrThinking } = splitModelSuffix(config.ocrModel ?? preset?.ocrModel ?? DEFAULT_OCR_MODEL)
  if (ocrModel.length === 0) throw new Error('llm-vision: ocrModel must be a non-empty model id before any :off/:low/:medium/:high suffix')
  const apiKey = config.apiKey
  if (apiKey !== undefined && apiKey.length === 0) {
    throw new Error('llm-vision: apiKey must be non-empty when set')
  }
  let apiKeyEnv: CredentialRef | undefined
  const rawEnv = config.apiKeyEnv ?? preset?.apiKeyEnv ?? DEFAULT_API_KEY_ENV
  if (rawEnv.length > 0) {
    try {
      apiKeyEnv = credentialRef(rawEnv)
    } catch {
      throw new Error(`llm-vision: apiKeyEnv ${JSON.stringify(rawEnv)} is not a valid environment-variable name`)
    }
  }
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
  const maxEdge = config.maxEdge ?? DEFAULT_MAX_EDGE
  const cacheTtlDays = config.cacheTtlDays ?? DEFAULT_TTL_DAYS
  const cacheMaxEntries = config.cacheMaxEntries ?? DEFAULT_MAX_ENTRIES
  const apiStyle = config.apiStyle ?? DEFAULT_API_STYLE
  for (const [field, value] of [['maxBytes', maxBytes], ['maxOutputTokens', maxOutputTokens], ['timeoutMs', timeoutMs], ['cacheTtlDays', cacheTtlDays], ['cacheMaxEntries', cacheMaxEntries]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`llm-vision: ${field} must be a positive safe integer`)
    }
  }
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error('llm-vision: maxRetries must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(maxEdge) || maxEdge < 0) {
    throw new Error('llm-vision: maxEdge must be a non-negative safe integer')
  }
  if (!API_STYLES.includes(apiStyle)) {
    throw new Error(`llm-vision: apiStyle must be one of ${API_STYLES.map(style => JSON.stringify(style)).join(', ')}`)
  }
  return {
    provider,
    baseURL,
    model,
    ocrModel,
    ocrThinking,
    apiKey,
    apiKeyEnv,
    criticalPrompt: config.criticalPrompt ?? DEFAULT_CRITICAL_DESCRIBE_PROMPT,
    normalPrompt: config.normalPrompt ?? DEFAULT_NORMAL_DESCRIBE_PROMPT,
    ocrPrompt: config.ocrPrompt ?? DEFAULT_OCR_PROMPT,
    maxBytes,
    maxOutputTokens,
    timeoutMs,
    maxRetries,
    apiStyle,
    thinking,
    maxEdge,
    compressEnabled: config.compressEnabled ?? DEFAULT_COMPRESS_ENABLED,
    cacheEnabled: config.cacheEnabled ?? DEFAULT_CACHE_ENABLED,
    cacheDir: config.cacheDir,
    cacheTtlDays,
    cacheMaxEntries,
    renderImagePreview: config.renderImagePreview ?? DEFAULT_RENDER_IMAGE_PREVIEW,
    interceptImageSend: config.interceptImageSend ?? DEFAULT_INTERCEPT_IMAGE_SEND,
  }
}

/**
 * Resolve the API key for one call: an explicit inline key wins; otherwise the credential seam (which owns
 * environment and managed-store layers) resolves the reference; without the seam the launch environment is
 * the whole credential plane.
 * @param ctx - registrant context.
 * @param spec - validated configuration.
 * @returns the resolved key.
 */
export async function resolveApiKey(ctx: Context, spec: ResolvedConfig): Promise<string> {
  if (spec.apiKey !== undefined) return spec.apiKey
  if (spec.apiKeyEnv !== undefined) {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(spec.apiKeyEnv)
      if (hit !== undefined) return hit.value
    } else {
      const ambient = launchEnvironmentOf(ctx).get(spec.apiKeyEnv)
      if (ambient !== undefined && ambient.value.length > 0) return ambient.value
    }
  }
  throw new Error(
    `llm-vision: no API key; set apiKey, store ${spec.apiKeyEnv ?? DEFAULT_API_KEY_ENV} through the credentials service,`
    + ' or export it in the launching environment',
  )
}
