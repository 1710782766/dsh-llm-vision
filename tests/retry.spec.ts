/**
 * Retry engineering tests (llm_vision parity): shrinking per-attempt budgets,
 * transient-failure classification (5xx/429/network/timeout retried; 4xx and
 * parse failures not), caller-cancellation without retry, and the
 * （已重试 N 次） suffix on exhausted retries. backoff is stubbed so no test
 * sleeps.
 */

import { describe, expect, it, vi } from 'vitest'
import { attemptTimeouts, callVision, type LoadedImage } from '../src/vision-client.ts'
import { resolveConfig } from '../src/config-resolve.ts'
import { chatReply, PNG_BYTES } from './mock-server.ts'

const image: LoadedImage = { bytes: PNG_BYTES, mimeType: 'image/png' }
const signal = new AbortController().signal

/** Counts backoff sleeps instead of really sleeping. */
function countingBackoff() {
  const calls: number[] = []
  return { calls, fn: async (ms: number) => { calls.push(ms) } }
}

function spec(overrides: Record<string, unknown> = {}) {
  return resolveConfig({ baseURL: 'https://api.example.com/v1', model: 'vision-1', apiKey: 'sk', timeoutMs: 120_000, maxRetries: 2, ...overrides })
}

function okResponse(text = 'answer') {
  return new Response(JSON.stringify(chatReply(text)), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('attemptTimeouts budgets', () => {
  it('shrinks per-attempt budgets geometrically', () => {
    expect(attemptTimeouts(120_000, 2)).toEqual([120_000, 60_000, 30_000])
    expect(attemptTimeouts(60_000, 2)).toEqual([60_000, 30_000, 15_000])
  })

  it('drops attempts below the 10s floor once one attempt exists', () => {
    expect(attemptTimeouts(30_000, 4)).toEqual([30_000, 15_000])
  })

  it('disables retries with maxRetries 0', () => {
    expect(attemptTimeouts(120_000, 0)).toEqual([120_000])
  })
})

describe('callVision retry classification', () => {
  it('retries a 500 then succeeds without a suffix', async () => {
    const backoff = countingBackoff()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }))
      .mockResolvedValueOnce(okResponse('recovered'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const text = await callVision(spec(), 'sk', 'p', image, signal, undefined, backoff.fn)
      expect(text).toBe('recovered')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(backoff.calls).toEqual([1000])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('gives up after maxRetries on persistent 500 and appends the retry suffix', async () => {
    const backoff = countingBackoff()
    const fetchMock = vi.fn().mockImplementation(() => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(callVision(spec(), 'sk', 'p', image, signal, undefined, backoff.fn)).rejects.toThrow(/HTTP 500: boom（已重试 2 次）/)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(backoff.calls).toEqual([1000, 2000])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not retry a 4xx and reports no retry suffix', async () => {
    const backoff = countingBackoff()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'unauthorized' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(callVision(spec(), 'sk', 'p', image, signal, undefined, backoff.fn)).rejects.toThrow(/HTTP 401: unauthorized/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(backoff.calls).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('retries a network failure then succeeds', async () => {
    const backoff = countingBackoff()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse('recovered'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const text = await callVision(spec(), 'sk', 'p', image, signal, undefined, backoff.fn)
      expect(text).toBe('recovered')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('exhausts network failures with the retry suffix', async () => {
    const backoff = countingBackoff()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(callVision(spec(), 'sk', 'p', image, signal, undefined, backoff.fn)).rejects.toThrow(/network error: fetch failed（已重试 2 次）/)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('aborts immediately on caller cancellation without retry', async () => {
    const backoff = countingBackoff()
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(callVision(spec(), 'sk', 'p', image, controller.signal, undefined, backoff.fn)).rejects.toThrow(/aborted/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(backoff.calls).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
