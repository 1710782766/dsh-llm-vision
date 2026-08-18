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
    expect(spec.provider).toBe(tool.DEFAULT_PROVIDER)
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

describe('provider presets', () => {
  it('fills every endpoint field from the zhipu preset', () => {
    const spec = tool.resolveConfig({ provider: 'zhipu' })
    expect(spec.provider).toBe('zhipu')
    expect(spec.baseURL).toBe(tool.PROVIDER_PRESETS.zhipu.baseURL.replace(/\/+$/, ''))
    expect(spec.model).toBe(tool.PROVIDER_PRESETS.zhipu.model)
    expect(spec.ocrModel).toBe(tool.PROVIDER_PRESETS.zhipu.ocrModel)
    expect(spec.apiKeyEnv).toBe('ZHIPU_API_KEY')
  })

  it('fills every endpoint field from the gemini preset', () => {
    const spec = tool.resolveConfig({ provider: 'gemini' })
    expect(spec.baseURL).toBe(tool.PROVIDER_PRESETS.gemini.baseURL.replace(/\/+$/, ''))
    expect(spec.model).toBe(tool.PROVIDER_PRESETS.gemini.model)
    expect(spec.ocrModel).toBe(tool.PROVIDER_PRESETS.gemini.ocrModel)
    expect(spec.apiKeyEnv).toBe('GEMINI_API_KEY')
  })

  it('fills every endpoint field from the dashscope preset', () => {
    const spec = tool.resolveConfig({ provider: 'dashscope' })
    expect(spec.baseURL).toBe(tool.PROVIDER_PRESETS.dashscope.baseURL.replace(/\/+$/, ''))
    expect(spec.model).toBe(tool.DEFAULT_VISION_MODEL)
    expect(spec.ocrModel).toBe(tool.DEFAULT_OCR_MODEL)
    expect(spec.apiKeyEnv).toBe('DASHSCOPE_API_KEY')
  })

  it('lets explicit fields override the preset', () => {
    const spec = tool.resolveConfig({
      provider: 'zhipu',
      baseURL: 'https://example.com/v1/',
      model: 'custom-vl:high',
      ocrModel: 'custom-ocr',
      apiKeyEnv: 'MY_KEY_ENV',
    })
    expect(spec.baseURL).toBe('https://example.com/v1')
    expect(spec.model).toBe('custom-vl')
    expect(spec.thinking).toBe('high')
    expect(spec.ocrModel).toBe('custom-ocr')
    expect(spec.apiKeyEnv).toBe('MY_KEY_ENV')
  })

  it('keeps the v1 behavior for an unset provider (custom)', () => {
    const spec = tool.resolveConfig({ baseURL: 'https://api.example.com/v1' })
    expect(spec.provider).toBe('custom')
    expect(spec.apiKeyEnv).toBe(tool.DEFAULT_API_KEY_ENV)
    expect(() => tool.resolveConfig({})).toThrow('llm-vision: baseURL must be an absolute http(s) URL')
  })

  it('rejects an unknown provider', () => {
    expect(() => tool.resolveConfig({ provider: 'nope' as tool.ProviderId })).toThrow(
      'llm-vision: provider must be one of',
    )
  })

  it('accepts a thinking suffix on the preset model', () => {
    const spec = tool.resolveConfig({ provider: 'zhipu', model: 'glm-4v-flash:off' })
    expect(spec.model).toBe('glm-4v-flash')
    expect(spec.thinking).toBe('off')
  })
})

/** Build a minimal ISO BMFF header with the given major brand. */
function ftypBytes(brand: string): Buffer {
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftyp'), Buffer.from(brand), Buffer.alloc(16)])
}

describe('HEIF media types', () => {
  it('sniffs HEIC and HEIF brands from the ftyp box', () => {
    expect(tool.sniffMimeType(ftypBytes('heic'))).toBe('image/heic')
    expect(tool.sniffMimeType(ftypBytes('heix'))).toBe('image/heic')
    expect(tool.sniffMimeType(ftypBytes('heim'))).toBe('image/heic')
    expect(tool.sniffMimeType(ftypBytes('heis'))).toBe('image/heic')
    expect(tool.sniffMimeType(ftypBytes('heif'))).toBe('image/heif')
  })

  it('rejects non-HEIF ftyp brands (avif, mif1) and truncated headers', () => {
    expect(tool.sniffMimeType(ftypBytes('avif'))).toBeUndefined()
    expect(tool.sniffMimeType(ftypBytes('mif1'))).toBeUndefined()
    expect(tool.sniffMimeType(ftypBytes('heic').subarray(0, 8))).toBeUndefined()
  })
})

describe('preprocessImage HEIF', () => {
  /** A runner that writes a tiny JPEG to the --out path (smaller than the input). */
  function jpegRunner(bytes: Buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])) {
    return async (args: string[], _timeoutMs: number): Promise<string> => {
      const outIndex = args.indexOf('--out')
      await writeFile(args[outIndex + 1], bytes)
      return ''
    }
  }

  it('re-encodes HEIC to JPEG even when the input is small', async () => {
    const out = await preprocessImage(ftypBytes('heic'), 'image/heic', DEFAULT_MAX_EDGE, jpegRunner())
    expect(out.mime).toBe('image/jpeg')
    expect(out.data[0]).toBe(0xff)
    expect(out.data[1]).toBe(0xd8)
  })

  it('re-encodes HEIF to JPEG', async () => {
    const out = await preprocessImage(ftypBytes('heif'), 'image/heif', DEFAULT_MAX_EDGE, jpegRunner())
    expect(out.mime).toBe('image/jpeg')
  })

  it('fails loudly on HEIC when sips is missing (ENOENT)', async () => {
    const noSips = async (): Promise<string> => {
      const error = new Error('spawn sips ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    await expect(preprocessImage(ftypBytes('heic'), 'image/heic', DEFAULT_MAX_EDGE, noSips))
      .rejects.toThrow('llm-vision: HEIC/HEIF images need the macOS sips converter')
  })

  it('silently degrades to the original bytes on non-ENOENT failures', async () => {
    const flaky = async (): Promise<string> => { throw new Error('sips exploded') }
    const bytes = ftypBytes('heic')
    const out = await preprocessImage(bytes, 'image/heic', DEFAULT_MAX_EDGE, flaky)
    expect(out.data).toBe(bytes)
    expect(out.mime).toBe('image/heic')
  })

  it('keeps HEIC untouched when preprocessing is disabled', async () => {
    const bytes = ftypBytes('heic')
    const out = await preprocessImage(bytes, 'image/heic', 0, jpegRunner())
    expect(out.data).toBe(bytes)
    expect(out.mime).toBe('image/heic')
  })

  it.runIf(process.platform === 'darwin')(
    'converts a real HEIC file to JPEG through the system sips',
    async () => {
      const { execFile } = await import('node:child_process')
      const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-vision-heic-'))
      cleanup.push(() => rm(dir, { recursive: true, force: true }))
      const src = join(dir, 'pixel.png')
      const heic = join(dir, 'pixel.heic')
      await writeFile(src, PNG_BYTES)
      await new Promise<void>((resolve, reject) => {
        execFile('sips', ['-s', 'format', 'heic', src, '--out', heic], (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      const { readFile } = await import('node:fs/promises')
      const bytes = await readFile(heic)
      expect(tool.sniffMimeType(bytes)).toBe('image/heic')
      const out = await preprocessImage(bytes, 'image/heic', DEFAULT_MAX_EDGE)
      expect(out.mime).toBe('image/jpeg')
      expect(out.data[0]).toBe(0xff)
      expect(out.data[1]).toBe(0xd8)
    },
  )
})
