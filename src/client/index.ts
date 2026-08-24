/**
 * Browser half of the describe-image plugin: no composer chrome of its own.
 * The shell's input box has no image entry for text-only models, so image
 * sends are rewritten at submit time (installSendHook) into describe-image
 * references before they reach the model — the way a text-only model gets an
 * image to analyze without the shell's vision pipeline. The shell renders
 * user messages as plain text, so a sent reference is then upgraded in place
 * into an inline thumbnail (installConversationImagePreview) unless the
 * deployment turns previews off. The settings card registers into the
 * `settings.plugin.item` slot of the web GUI's plugin config page, keyed by
 * the `llm-vision` settings namespace the host half serves — the configurable
 * tab dispatches it by that key, so its edits land in the same namespace the
 * tools read.
 *
 * Failure policy: every DOM/runtime wiring failure is logged, never thrown —
 * the web shell fails the whole boot when a plugin apply throws.
 * @module dsh-llm-vision/client
 */

import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { installSendHook } from './send-hook.ts'
import { installConversationImagePreview, type ConversationImagePreview } from './preview.ts'
import { DescribeImageSettingsCard, DescribeImageSettingsCardController, type DescribeImageSettings } from './DescribeImageSettingsCard.tsx'
import { dictionaries, setLanguage, type DescribeImageClientKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The describe-image attach button copy. */
    'llm-vision': DescribeImageClientKey
  }

  interface SlotMap {
    /**
     * The settings card seat in the web GUI's plugin configuration page —
     * the official `settings.plugin.item` slot, keyed by the `llm-vision`
     * settings namespace this plugin's host half serves. Spelled here with
     * the same shape so this package can register without depending on the
     * sibling UI package.
     */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-ui-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

/** Locale namespace of the browser half. */
export const NS = 'llm-vision' as const

/**
 * The keyed-slot key of the settings card, and the settings namespace it
 * edits. The configurable-plugins tab dispatches `settings.plugin.item`
 * entries by `key` and pairs them with the served namespaces, so this value
 * MUST stay identical to `LLM_VISION_SETTINGS_NAMESPACE` (host half) — the
 * spec pins the two together.
 */
export const SETTINGS_CARD_KEY = 'llm-vision' as const

/** Required services: slots for the settings card, conversation for the send hook, settings scope and locale for the card copy. */
export const inject = ['slots', 'conversation', 'settingsScope', 'locale']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-tool-llm-vision: dictionaries')
  ctx.effect(() => {
    // Mirror the shell language into the module-level dictionary switch.
    const sync = (): void => {
      const lang = document.documentElement.lang
      setLanguage(lang === 'zh' || lang.startsWith('zh-') ? 'zh' : 'en')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, 'dsh-tool-llm-vision: language mirror')

  ctx.inject(['slots', 'conversation'], (scope: ClientContext) => {
    const conversation = scope.conversation
    const slots = scope.slots

    // Bound once the settings scope inject fires; the preview enhancer reads
    // it per scan, so an unbound scope (or a missing service) keeps the default.
    let settingsScopeRef: SettingsScope<DescribeImageSettings> | undefined
    // The settings subscription installed by the scope inject below; kept so
    // dispose (or a re-inject) never leaves a stale listener behind.
    let unsubscribeSettings: (() => void) | undefined

    // Text-only models reject image blocks at submit: rewrite image-bearing
    // sends into describe-image references before they reach the model. The
    // live switch (settings interceptImageSend, default on) is read per
    // send, so other vision plugins keep the raw image blocks when it is off.
    installSendHook(conversation, () => settingsScopeRef?.getSnapshot().value?.interceptImageSend !== false)

    // The shell renders user messages as plain text, so a sent reference sits
    // in the transcript as raw markdown; upgrade it in place into an inline
    // thumbnail unless the deployment turns previews off.
    let previewRef: ConversationImagePreview | undefined
    ctx.effect(() => {
      const handle = installConversationImagePreview(() => settingsScopeRef?.getSnapshot().value?.renderImagePreview !== false)
      previewRef = handle
      return () => {
        previewRef = undefined
        unsubscribeSettings?.()
        unsubscribeSettings = undefined
        settingsScopeRef = undefined
        handle.dispose()
      }
    }, 'dsh-tool-llm-vision: conversation image preview')

    // The settings card: bound to the `llm-vision` namespace through the
    // official settings scope (the host half serves it via the settings
    // section); the optional dsh-web-ui bridge remains for deployments that
    // install that family's settings plugin instead.
    ctx.inject(['settingsScope'], (settingsCtx: ClientContext) => {
      const binder = settingsCtx.get('webUiSettings') ?? settingsCtx.settingsScope
      const settingsScope = binder.bind<DescribeImageSettings>({ namespace: NS })
      unsubscribeSettings?.()
      settingsScopeRef = settingsScope
      // Live toggle: re-scan (or restore) the moment a settings save settles.
      unsubscribeSettings = settingsScope.subscribe(() => previewRef?.refresh())
      const settingsCard = new DescribeImageSettingsCardController(settingsScope)
      slots.inject('settings.plugin.item', () => {
        const unregister = slots.register({
          name: 'settings.plugin.item',
          // Keyed slot: the configurable-plugins tab dispatches cards by the
          // settings namespace they edit (tab-store pairs `key` with the
          // served namespaces), so the key MUST equal the namespace — an `id`
          // alone is never dispatched and the card silently never renders.
          key: SETTINGS_CARD_KEY,
          locale: NS,
          inject: () => settingsCard.inject(),
        }, DescribeImageSettingsCard)
        return () => {
          settingsCard.dispose()
          unregister()
        }
      })
    })
  })
}
