/**
 * Shipped endpoint presets — the single source of truth for the free-tier
 * provider facts. Zero-dependency pure data, imported by BOTH the host half
 * (config-resolve expands a chosen preset into endpoint fields) and the
 * browser half (the settings card prefills the fields when the user picks a
 * preset). Keep every preset fact here and nowhere else: a second copy
 * anywhere will drift and is a review failure.
 * @module dsh-llm-vision/presets
 */

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
 * model ids live here — one edit re-targets every preset user. Keyed by the
 * provider ids that exclude 'custom' (every endpoint field explicit).
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
