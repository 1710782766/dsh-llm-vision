// @vitest-environment jsdom
/**
 * Browser-half settings card tests: the provider-preset prefill staging and
 * the keyed-slot contract (the card key MUST match the host settings
 * namespace — the configurable-plugins tab dispatches by that pair).
 *
 * The published dsh-client-runtime ships as a __ModuleLoader__ bundle that
 * cannot execute outside the web shell, so its snapshot-store engine is
 * replaced with a minimal twin here — the tests under this file exercise
 * pure staging logic and constants, never a live store.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (initial: unknown) => {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next: unknown) => {
        value = next
        for (const listener of [...listeners]) listener()
      },
    }
  },
}))

import { stageProviderPreset } from '../src/client/DescribeImageSettingsCard.tsx'
import { SETTINGS_CARD_KEY } from '../src/client/index.ts'
import { PROVIDER_PRESETS } from '../src/presets.ts'
import * as tool from '../src/index.ts'

/** A record of staged edits, keyed by field. */
function stagedEditRecorder() {
  const staged = new Map<string, string>()
  const edit = vi.fn((field: string, text: string) => { staged.set(field, text) })
  return { staged, edit }
}

describe('stageProviderPreset', () => {
  it('stages the provider and prefills every endpoint fact from the dashscope preset', () => {
    const { staged, edit } = stagedEditRecorder()
    stageProviderPreset(edit, 'dashscope')
    expect(edit).toHaveBeenCalledTimes(5)
    expect(staged.get('provider')).toBe('dashscope')
    expect(staged.get('baseURL')).toBe(PROVIDER_PRESETS.dashscope.baseURL)
    expect(staged.get('model')).toBe(PROVIDER_PRESETS.dashscope.model)
    expect(staged.get('ocrModel')).toBe(PROVIDER_PRESETS.dashscope.ocrModel)
    expect(staged.get('apiKeyEnv')).toBe(PROVIDER_PRESETS.dashscope.apiKeyEnv)
  })

  it('prefills the zhipu preset facts', () => {
    const { staged, edit } = stagedEditRecorder()
    stageProviderPreset(edit, 'zhipu')
    expect(staged.get('model')).toBe(PROVIDER_PRESETS.zhipu.model)
    expect(staged.get('apiKeyEnv')).toBe(PROVIDER_PRESETS.zhipu.apiKeyEnv)
  })

  it('prefills the gemini preset facts', () => {
    const { staged, edit } = stagedEditRecorder()
    stageProviderPreset(edit, 'gemini')
    expect(staged.get('baseURL')).toBe(PROVIDER_PRESETS.gemini.baseURL)
    expect(staged.get('model')).toBe(PROVIDER_PRESETS.gemini.model)
  })

  it('stages custom without prefilling anything', () => {
    const { staged, edit } = stagedEditRecorder()
    stageProviderPreset(edit, 'custom')
    expect(edit).toHaveBeenCalledTimes(1)
    expect(staged.get('provider')).toBe('custom')
  })

  it('stages an unknown provider id without prefilling', () => {
    const { staged, edit } = stagedEditRecorder()
    stageProviderPreset(edit, 'nope')
    expect(edit).toHaveBeenCalledTimes(1)
    expect(staged.get('provider')).toBe('nope')
  })
})

describe('settings card slot contract', () => {
  it('keeps the card key identical to the host settings namespace', () => {
    // The configurable-plugins tab renders a card only when its keyed-slot
    // key is served by the Host; a drift between the two would silently hide
    // the card again (the regression this pins).
    expect(SETTINGS_CARD_KEY).toBe(String(tool.LLM_VISION_SETTINGS_NAMESPACE))
  })

  it('names every provider choice the host config accepts', () => {
    // The card's choice list must stay a subset of what resolveConfig accepts;
    // PROVIDER_IDS is the single source, and the presets cover the non-custom
    // ids with endpoint facts.
    for (const presetId of Object.keys(PROVIDER_PRESETS)) {
      expect(tool.PROVIDER_IDS).toContain(presetId)
      expect(String(tool.resolveConfig({ provider: presetId as tool.ProviderId, baseURL: 'https://placeholder.invalid/v1' }).model).length).toBeGreaterThan(0)
    }
  })
})
