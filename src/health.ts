/**
 * Health check for the llm-vision tools: verifies the configuration resolves,
 * an API key is obtainable, and the endpoint answers a keyed probe — plus an
 * optional end-to-end test call on a 64×64 image. The report is the domain
 * result (plain JSON, never thrown; infrastructure failures in the plumbing
 * still throw per the error contract). Keys never appear in the report.
 * @module dsh-llm-vision/health
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveApiKey, type ProviderId, type ResolvedConfig } from './config-resolve.ts'
import { callVision } from './vision-client.ts'

/** One check's verdict; `unreachable` and `fail` both count as failing. */
export type HealthStatus = 'ok' | 'fail' | 'skipped' | 'unsupported' | 'unreachable'

/** One named check in the report. */
export interface HealthCheck {
  name: string
  status: HealthStatus
  detail: string
}

/** The full health report returned to the caller (and rendered to the model). */
export interface HealthReport {
  ok: boolean
  checks: HealthCheck[]
  config: {
    provider: ProviderId
    baseURL: string
    model: string
    ocrModel: string
    apiKeyEnv: string | undefined
    apiKeySet: boolean
  }
}

/** Endpoint-probe timeout in milliseconds (short: a health check should answer fast). */
export const HEALTH_PROBE_TIMEOUT_MS = 10_000

/**
 * The probe image for end-to-end test calls: a 64×64 white PNG. Not 1×1 —
 * several endpoints reject sub-minimum sizes (qwen3-vl-plus: "image length
 * and width do not meet the model restrictions"), which made the original
 * 1×1 probe fail where the real pipeline was healthy.
 */
export const HEALTH_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3PMQ0AMAzAsPInvYLYYVWKESTzjhsd8KsBrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BbQHKU9LC7/CP1AAAAABJRU5ErkJggg==',
  'base64',
)

/** Cap on endpoint-error excerpts in the report (the error contract's bound). */
const HEALTH_DETAIL_CAP = 200

/** Shorten a detail string to the report cap. */
function capDetail(detail: string): string {
  return detail.length > HEALTH_DETAIL_CAP ? `${detail.slice(0, HEALTH_DETAIL_CAP)}…` : detail
}

/** Probe the endpoint's /models listing with the keyed authorization header. */
async function probeEndpoint(
  baseURL: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<HealthCheck> {
  try {
    const response = await fetch(`${baseURL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS)]),
    })
    if (response.ok) {
      return { name: 'endpoint', status: 'ok', detail: `GET ${baseURL}/models answered HTTP ${response.status}` }
    }
    if (response.status === 401 || response.status === 403) {
      return { name: 'endpoint', status: 'fail', detail: `endpoint rejected the API key (HTTP ${response.status})` }
    }
    if (response.status === 404) {
      return { name: 'endpoint', status: 'unsupported', detail: 'endpoint exposes no /models listing (not required)' }
    }
    return { name: 'endpoint', status: 'fail', detail: `endpoint answered HTTP ${response.status}` }
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { name: 'endpoint', status: 'unreachable', detail: `endpoint probe timed out (${HEALTH_PROBE_TIMEOUT_MS / 1000}s)` }
    }
    if (error instanceof TypeError) {
      return { name: 'endpoint', status: 'unreachable', detail: capDetail(`endpoint unreachable: ${error.message}`) }
    }
    throw error
  }
}

/** One end-to-end test call on the 64×64 image through the real vision pipeline. */
async function probeTestCall(
  spec: ResolvedConfig,
  apiKey: string,
  signal: AbortSignal,
): Promise<HealthCheck> {
  try {
    await callVision(
      spec,
      apiKey,
      'Reply with the single word OK.',
      { bytes: HEALTH_PNG_BYTES, mimeType: 'image/png' },
      signal,
    )
    return { name: 'testCall', status: 'ok', detail: 'end-to-end vision call on a 64×64 image succeeded' }
  } catch (error) {
    if (signal.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    return { name: 'testCall', status: 'fail', detail: capDetail(message) }
  }
}

/**
 * Run the full health check and return the report. Never throws for a failing
 * configuration — every finding lands in the report; only caller cancellation
 * or plumbing failures propagate.
 * @param ctx - registrant context (credential seam resolution).
 * @param spec - validated configuration.
 * @param options - `testCall: true` adds an end-to-end vision call (spends quota).
 * @param signal - caller cancellation.
 */
export async function runHealthCheck(
  ctx: Context,
  spec: ResolvedConfig,
  options: { testCall?: boolean } = {},
  signal: AbortSignal,
): Promise<HealthReport> {
  let apiKey: string | undefined
  let keyCheck: HealthCheck
  try {
    apiKey = await resolveApiKey(ctx, spec)
    keyCheck = { name: 'apiKey', status: 'ok', detail: `API key resolves through ${spec.apiKeyEnv ?? 'the inline config'}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    keyCheck = { name: 'apiKey', status: 'fail', detail: capDetail(message) }
  }

  const checks: HealthCheck[] = [keyCheck]
  if (apiKey === undefined) {
    checks.push({ name: 'endpoint', status: 'skipped', detail: 'endpoint probe skipped: no API key' })
  } else {
    checks.push(await probeEndpoint(spec.baseURL, apiKey, signal))
    if (options.testCall === true) {
      checks.push(await probeTestCall(spec, apiKey, signal))
    }
  }

  return {
    ok: checks.every(check => check.status !== 'fail' && check.status !== 'unreachable'),
    checks,
    config: {
      provider: spec.provider,
      baseURL: spec.baseURL,
      model: spec.model,
      ocrModel: spec.ocrModel,
      apiKeyEnv: spec.apiKeyEnv,
      apiKeySet: apiKey !== undefined,
    },
  }
}
