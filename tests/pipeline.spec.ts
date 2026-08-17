/**
 * Tool-level pipeline tests for the llm_vision-port features: the critical /
 * normal perspectives, extract_text with the OCR model and prompt, prompt
 * contract stability, config-default sync, and preprocess behavior.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'
import { preprocessImage, DEFAULT_MAX_EDGE } from '../src/preprocess.ts'
import { chatReply, FakeWebServer, jsonReply, PNG_BYTES, responsesReply, sentContent, startMockServer } from './mock-server.ts'
import type { MockServer } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => Promise.resolve(ctx.fiber.dispose())))
  await Promise.all(cleanup.splice(0).map(close => close()))
})

async function tempPng(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-vision-pipeline-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'pixel.png')
  await writeFile(path, PNG_BYTES)
  return path
}

async function boot(ctx: Context, server: MockServer): Promise<void> {
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, {
    baseURL: server.url,
    model: 'vision-1',
    ocrModel: 'ocr-1',
    apiKey: 'sk-inline',
    cacheEnabled: false,
  })
}

function callTool(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('pipeline-call'),
    name,
    arguments: args,
  })
}

describe('describe_image perspectives', () => {
  it('sends the critical inspection prompt for perspective=critical', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('Inspected.')) })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server)
    const result = await callTool(ctx, 'describe_image', { image: await tempPng(), perspective: 'critical' })
    expect(result.isError).toBe(false)
    const [textPart] = sentContent(server.request(0)) as Array<{ type: string; text?: string }>
    expect(textPart).toEqual({ type: 'text', text: tool.DEFAULT_CRITICAL_DESCRIBE_PROMPT })
  })

  it('sends the normal prompt when perspective is omitted', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('Described.')) })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server)
    await callTool(ctx, 'describe_image', { image: await tempPng() })
    const [textPart] = sentContent(server.request(0)) as Array<{ type: string; text?: string }>
    expect(textPart).toEqual({ type: 'text', text: tool.DEFAULT_NORMAL_DESCRIBE_PROMPT })
  })

  it('lets an explicit prompt override the perspective default', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server)
    await callTool(ctx, 'describe_image', { image: await tempPng(), perspective: 'critical', prompt: '只看颜色' })
    const [textPart] = sentContent(server.request(0)) as Array<{ type: string; text?: string }>
    expect(textPart).toEqual({ type: 'text', text: '只看颜色' })
  })

  it('rejects an unknown perspective before any vision request (schema enum)', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server)
    const result = await callTool(ctx, 'describe_image', { image: await tempPng(), perspective: 'weird' })
    expect(result.isError).toBe(true)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('perspective')
    expect(text).toContain('normal')
    expect(text).toContain('critical')
    expect(server.requests).toHaveLength(0)
  })
})

describe('extract_text', () => {
  it('routes to the OCR model with the OCR prompt by default', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('OCR text.')) })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server)
    const result = await callTool(ctx, 'extract_text', { image: await tempPng() })
    expect(result.isError).toBe(false)
    if (!result.isError) {
      expect(result.value).toMatchObject({ text: 'OCR text.', model: 'ocr-1', mimeType: 'image/png' })
    }
    const body = server.request(0).body as { model?: string }
    expect(body.model).toBe('ocr-1')
    const [textPart] = sentContent(server.request(0)) as Array<{ type: string; text?: string }>
    expect(textPart).toEqual({ type: 'text', text: tool.DEFAULT_OCR_PROMPT })
  })

  it('lets an explicit prompt ask for structured output', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('{"name":"x"}')) })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server)
    const result = await callTool(ctx, 'extract_text', { image: await tempPng(), prompt: 'extract the name and ID number as JSON' })
    expect(result.isError).toBe(false)
    const [textPart] = sentContent(server.request(0)) as Array<{ type: string; text?: string }>
    expect(textPart).toEqual({ type: 'text', text: 'extract the name and ID number as JSON' })
  })
})

describe('prompt contract stability', () => {
  it('keeps the critical prompt an objective inspection instruction', () => {
    expect(tool.DEFAULT_CRITICAL_DESCRIBE_PROMPT).toContain('审视')
    expect(tool.DEFAULT_CRITICAL_DESCRIBE_PROMPT).toContain('异常')
    expect(tool.DEFAULT_CRITICAL_DESCRIBE_PROMPT).toContain('事实')
    expect(tool.DEFAULT_CRITICAL_DESCRIBE_PROMPT).toContain('推测')
    expect(tool.DEFAULT_CRITICAL_DESCRIBE_PROMPT).toContain('绝不编造')
  })

  it('keeps the normal prompt a natural description instruction', () => {
    expect(tool.DEFAULT_NORMAL_DESCRIBE_PROMPT).toContain('自然描述')
    expect(tool.DEFAULT_NORMAL_DESCRIBE_PROMPT).toContain('不要编造')
  })

  it('keeps the OCR prompt a verbatim extraction instruction', () => {
    expect(tool.DEFAULT_OCR_PROMPT).toContain('不补全')
    expect(tool.DEFAULT_OCR_PROMPT).toContain('不猜测')
  })
})

describe('config default sync', () => {
  it('resolves every DEFAULT_* constant when only baseURL is set', () => {
    const spec = tool.resolveConfig({ baseURL: 'https://api.example.com/v1' })
    expect(spec.model).toBe(tool.DEFAULT_VISION_MODEL)
    expect(spec.ocrModel).toBe(tool.DEFAULT_OCR_MODEL)
    expect(spec.apiKeyEnv).toBeDefined()
    expect(spec.criticalPrompt).toBe(tool.DEFAULT_CRITICAL_DESCRIBE_PROMPT)
    expect(spec.normalPrompt).toBe(tool.DEFAULT_NORMAL_DESCRIBE_PROMPT)
    expect(spec.ocrPrompt).toBe(tool.DEFAULT_OCR_PROMPT)
    expect(spec.maxBytes).toBe(tool.DEFAULT_MAX_BYTES)
    expect(spec.maxOutputTokens).toBe(tool.DEFAULT_MAX_OUTPUT_TOKENS)
    expect(spec.timeoutMs).toBe(tool.DEFAULT_TIMEOUT_MS)
    expect(spec.maxRetries).toBe(tool.DEFAULT_MAX_RETRIES)
    expect(spec.apiStyle).toBe(tool.DEFAULT_API_STYLE)
    expect(spec.maxEdge).toBe(DEFAULT_MAX_EDGE)
    expect(spec.compressEnabled).toBe(tool.DEFAULT_COMPRESS_ENABLED)
    expect(spec.cacheEnabled).toBe(tool.DEFAULT_CACHE_ENABLED)
    expect(spec.renderImagePreview).toBe(tool.DEFAULT_RENDER_IMAGE_PREVIEW)
    expect(spec.interceptImageSend).toBe(tool.DEFAULT_INTERCEPT_IMAGE_SEND)
  })
})

describe('preprocessImage', () => {
  it('returns the original bytes when preprocessing is disabled', async () => {
    const out = await preprocessImage(PNG_BYTES, 'image/png', 0)
    expect(out.data).toBe(PNG_BYTES)
    expect(out.mime).toBe('image/png')
  })

  it('returns small in-bounds images untouched', async () => {
    const out = await preprocessImage(PNG_BYTES, 'image/png', DEFAULT_MAX_EDGE)
    expect(out.data).toBe(PNG_BYTES)
    expect(out.mime).toBe('image/png')
  })

  it('never returns bytes larger than the input', async () => {
    // A tiny image re-encoded at high quality could grow; the guard keeps the original.
    const out = await preprocessImage(PNG_BYTES, 'image/png', 8)
    expect(out.data.length).toBeLessThanOrEqual(PNG_BYTES.length)
  })
})
