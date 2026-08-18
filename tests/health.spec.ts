/** The llm_vision_check tool: configuration, key, endpoint probe, and optional end-to-end call. */

import { mkdtemp, rm } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'
import { chatReply, FakeWebServer, jsonReply, startMockServer } from './mock-server.ts'
import type { MockServer, RecordedRequest } from './mock-server.ts'

/** The report shape the tool returns, narrowed for assertions. */
interface CheckResultValue {
  ok: boolean
  checks: Array<{ name: string; status: string; detail: string }>
  config: { provider: string; baseURL: string; model: string; ocrModel: string; apiKeyEnv?: string; apiKeySet: boolean }
}

const cleanup: Array<() => Promise<void>> = []
const contexts: Context[] = []

async function boot(
  over: Partial<tool.Config> = {},
  handler: (request: RecordedRequest, response: ServerResponse) => void
    = (_request, res) => { jsonReply(res, 200, { data: [] }) },
  options: { noKey?: boolean } = {},
): Promise<{ ctx: Context; server: MockServer }> {
  const server = await startMockServer(handler)
  cleanup.push(server.close)
  const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-llm-vision-health-cache-'))
  cleanup.push(() => rm(cacheDir, { recursive: true, force: true }))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, {
    baseURL: server.url,
    model: 'vision-1',
    ...options.noKey === true ? {} : { apiKey: 'sk-health' },
    cacheDir,
    ...over,
  })
  return { ctx, server }
}

function callCheck(ctx: Context, args: unknown = {}) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('health-call'),
    name: 'llm_vision_check',
    arguments: args,
  })
}

/** Narrow an execute result to the report shape, failing the test on tool errors. */
function valueOf(result: { isError: boolean; value?: unknown }): CheckResultValue {
  if (result.isError || result.value === null || result.value === undefined || typeof result.value !== 'object') {
    throw new Error('expected llm_vision_check success')
  }
  return result.value as CheckResultValue
}

function errorText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => Promise.resolve(ctx.fiber.dispose())))
  await Promise.all(cleanup.splice(0).map(close => close()))
})

describe('llm_vision_check', () => {
  it('reports ok when the key resolves and /models answers 200', async () => {
    const { ctx, server } = await boot()
    const result = await callCheck(ctx)
    const value = valueOf(result)
    expect(value.ok).toBe(true)
    expect(value.config).toMatchObject({
      provider: 'custom',
      baseURL: server.url,
      model: 'vision-1',
      apiKeySet: true,
    })
    expect(value.checks.find(check => check.name === 'apiKey')?.status).toBe('ok')
    expect(value.checks.find(check => check.name === 'endpoint')?.status).toBe('ok')
    expect(server.request(0).path).toBe('/models')
    expect(server.request(0).authorization).toBe('Bearer sk-health')
  })

  it('flags a rejected key on HTTP 401 without failing the whole report shape', async () => {
    const { ctx } = await boot({}, (_request, res) => { jsonReply(res, 401, { error: { message: 'bad key' } }) })
    const result = await callCheck(ctx)
    const value = valueOf(result)
    expect(value.ok).toBe(false)
    const endpoint = value.checks.find(check => check.name === 'endpoint')
    expect(endpoint?.status).toBe('fail')
    expect(endpoint?.detail).toContain('rejected the API key')
  })

  it('treats a missing /models listing as unsupported, not failing', async () => {
    const { ctx } = await boot({}, (_request, res) => { jsonReply(res, 404, {}) })
    const result = await callCheck(ctx)
    const value = valueOf(result)
    expect(value.ok).toBe(true)
    expect(value.checks.find(check => check.name === 'endpoint')?.status).toBe('unsupported')
  })

  it('reports an unreachable endpoint when the probe cannot connect', async () => {
    const { ctx } = await boot({ baseURL: 'http://127.0.0.1:9/v1' })
    const result = await callCheck(ctx)
    const value = valueOf(result)
    expect(value.ok).toBe(false)
    const endpoint = value.checks.find(check => check.name === 'endpoint')
    expect(endpoint?.status).toBe('unreachable')
    expect(endpoint?.detail).toContain('endpoint unreachable')
  })

  it('reports a missing key and skips the endpoint probe', async () => {
    const { ctx } = await boot({}, (_request, res) => { jsonReply(res, 200, { data: [] }) }, { noKey: true })
    const result = await callCheck(ctx)
    const value = valueOf(result)
    expect(value.ok).toBe(false)
    expect(value.config.apiKeySet).toBe(false)
    expect(value.checks.find(check => check.name === 'apiKey')?.status).toBe('fail')
    expect(value.checks.find(check => check.name === 'endpoint')?.status).toBe('skipped')
  })

  it('runs an end-to-end test call when testCall is set, and reports failures instead of throwing', async () => {
    const { ctx } = await boot({}, (request, res) => {
      if (request.path === '/models') jsonReply(res, 200, { data: [] })
      else jsonReply(res, 200, chatReply('OK'))
    })
    const result = await callCheck(ctx, { testCall: true })
    const value = valueOf(result)
    expect(value.ok).toBe(true)
    expect(value.checks.find(check => check.name === 'testCall')?.status).toBe('ok')
  })

  it('reports a failed test call in the report', async () => {
    const { ctx } = await boot({}, (request, res) => {
      if (request.path === '/models') jsonReply(res, 200, { data: [] })
      else jsonReply(res, 500, { error: { message: 'boom' } })
    })
    const result = await callCheck(ctx, { testCall: true })
    const value = valueOf(result)
    expect(value.ok).toBe(false)
    const testCall = value.checks.find(check => check.name === 'testCall')
    expect(testCall?.status).toBe('fail')
    expect(testCall?.detail).toContain('llm-vision:')
  })

  it('fails loudly when the configuration is invalid (unconfigured mount)', async () => {
    const { ctx } = await boot({ baseURL: undefined })
    const result = await callCheck(ctx)
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('llm-vision: baseURL must be an absolute http(s) URL')
  })

  it('never includes the API key value in the report', async () => {
    const { ctx } = await boot()
    const result = await callCheck(ctx)
    const value = valueOf(result)
    expect(JSON.stringify(value)).not.toContain('sk-health')
  })

  it('uses a probe image large enough for real endpoints (not 1×1)', () => {
    // Regression: the original 1×1 probe was rejected by qwen3-vl-plus
    // ("image length and width do not meet the model restrictions").
    const bytes = tool.HEALTH_PNG_BYTES
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    expect(width).toBeGreaterThanOrEqual(32)
    expect(height).toBeGreaterThanOrEqual(32)
  })
})
