# dsh-llm-vision

English | [中文](README.zh.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/1710782766/dsh-llm-vision.svg)](https://github.com/1710782766/dsh-llm-vision)
[![CI](https://github.com/1710782766/dsh-llm-vision/actions/workflows/ci.yml/badge.svg)](https://github.com/1710782766/dsh-llm-vision/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22-blue.svg)](package.json)

**Give your DeepSeek Harness a pair of eyes** — reliable image understanding
and OCR for text-only models, configured entirely in the GUI.

Paste an image and the model describes or reads it; big screenshots are
auto-compressed, transient failures retry, identical images hit a persistent
cache. Built-in free presets (Zhipu / Gemini / DashScope) get you running
without touching a config file.

> **Status**: v0.3.0 on GitHub and npm — 227 offline tests, verified
> end-to-end in the real web GUI. v0.3.0 makes the settings card the
> authoritative configuration surface (no patch files); v0.2.0 added free
> provider presets, multi-image batch reads, a `llm_vision_check` diagnostic,
> and HEIC/HEIF support.

## Quick start

```sh
dsh plugin --profile web add dsh-llm-vision@0.3.0
```

1. **Install** with the command above (or see [Install](#install)).
2. **Restart the GUI once** — plugins load at boot, so the card is not visible
   until then. Configuration changes after install never need a restart.
3. Open **Settings → Plugins → llm-vision** and pick a **Provider preset**:
   `zhipu`, `gemini`, or `dashscope` fill the endpoint fields for you — free
   routes, no payment details (see the [free presets
   table](#free-presets-zero-cost-routes)).
4. Paste your **API key** into the card's **API key** field and **Save** — it
   is stored in your owner-only settings document and never shown again.
5. **Use it** — paste / drag / drop an image into the composer and send; the
   model now sees it. Or call the `llm_vision_check` tool for a full pipeline
   diagnosis.

## Why

Text-only models (DeepSeek V4, GLM text series, …) cannot see images. This
plugin registers model-facing tools backed by any OpenAI-compatible vision
endpoint:

| Tool | Purpose |
|---|---|
| `describe_image` | Image understanding with two perspectives: **normal** (natural description) and **critical** (objective inspection that actively reports text misalignment, overlap, occlusion, wrapping anomalies, missing elements, and separates fact from guess). The critical lens is the antidote to vision models rationalizing rendering bugs — use it for page/UI problem reports and screenshot-vs-design comparisons. Accepts a single `image` or a batch of up to 8 `images` read together in one call. |
| `extract_text` | OCR & document parsing through a dedicated OCR model — ID cards, invoices, receipts; structured output (JSON/CSV) on request; verbatim extraction that never guesses missing text. |
| `llm_vision_check` | Diagnostics: verifies the configuration, that an API key resolves, and that the endpoint answers an authenticated probe — optionally with a real end-to-end vision call (`testCall`). The key itself never appears in the report. |

Plus the DSH-native experience:

- **Paste / drag / drop** images into the composer and send — the browser half rewrites the
  image-bearing send into attach references the text model can resolve, and upgrades the
  references into inline thumbnails in the transcript.
- **Live settings card** (Settings → Plugins → llm-vision): endpoint, models, prompts, bounds,
  retries, preprocessing, and cache — saves apply to the very next call.
- **Three input kinds** per call: local absolute path, http(s) URL (redirects refused), or
  attachment reference.
- **The image never enters the session log** — only the returned text crosses into the
  conversation.

## Install

```sh
dsh plugin --profile web add dsh-llm-vision@0.3.0
```

Then **restart the GUI once** — plugins load at boot, so the plugin and its
settings card become visible only after the restart (configuration changes
after that never need one).

The version is pinned on purpose: pnpm 11 holds back packages published in the
last 24 hours, so a bare `add dsh-llm-vision` (latest) would silently install
the previous release on launch day. This line is bumped with every release.
`--profile web` is the GUI profile of this deployment — use your own profile
name if it differs.

From a source checkout the same command accepts a tarball or local path
(`pnpm pack` names the tarball after the current version — use that name):

```sh
pnpm install && pnpm build && pnpm pack   # → dsh-llm-vision-<version>.tgz
dsh plugin --profile web add ./dsh-llm-vision-<version>.tgz
# or: dsh plugin --profile web add /path/to/dsh-llm-vision   (build first — lib/ is gitignored)
```

The tarball ships prebuilt `lib/` (both the node half and `lib/client.js`), so no build step
runs on the installing machine.

### Configure

Everything is configured in the GUI — the **Settings → Plugins → llm-vision**
card. No patch file, no environment exports required:

1. Open **Settings → Plugins** and find the **llm-vision** card.
2. Pick a **Provider preset** for a zero-config route, or set
   `baseURL` / `model` / `ocrModel` yourself (`custom`).
3. Paste the **API key** into the card's **API key** field — the simple path:
   it is stored in the harness's owner-only settings document
   (`~/.dsh/settings.yaml`, `0600`) and never shown again. *Advanced:* leave
   the field empty and let `apiKeyEnv` resolve through the credential seam
   instead (presets prefill e.g. `DASHSCOPE_API_KEY`; the default is
   `VISION_API_KEY`) — for users who prefer environment variables.
4. **Save** — the change reaches the very next tool call, no restart.

Before configuring, the first call fails with a clear hint (`llm-vision:
baseURL must be an absolute http(s) URL`) — that is the expected unconfigured
state, not a broken install.

The values live in the harness settings document (`~/.dsh/settings.yaml`,
`0600`, shared across profiles) and are written by the GUI. A profile patch
layer may still provide *deployment defaults* for the card (shown as
"Inherit"), but the card's saved values always win — the GUI is the only
configuration surface a user needs. A deployment without a settings provider
falls back to the built-in defaults.

#### Free presets (zero-cost routes)

The **Provider preset** selector fills `baseURL` / `model` / `ocrModel` /
`apiKeyEnv` for you — free routes, no payment details. Free policies change,
so re-check the provider docs if a call stops working:

| Preset | Endpoint | Getting a free key |
|---|---|---|
| `zhipu` | Zhipu BigModel — permanently free GLM-4V-Flash; the best default in mainland China | open.bigmodel.cn — register, create an API key; free tier, no card |
| `gemini` | Google Gemini — free key from Google AI Studio (aistudio.google.com) | AI Studio → "Get API key", no card; **not reachable from mainland China without a proxy** |
| `dashscope` | Alibaba DashScope (the default models) with free quota | Alibaba Cloud Bailian console (bailian.console.aliyun.com) — free quota; reachable from mainland China |

Picking a preset prefills the endpoint fields (still editable before saving);
explicit field values always win at call time. The free presets reuse the
vision model for OCR (`extract_text` drives it with the OCR prompt) — free
tiers are rate-limited, so they suit interactive use better than batch runs.

| Key | Default | Meaning |
|---|---|---|
| `provider` | `custom` | Endpoint preset: `custom` (all fields explicit), `dashscope`, `zhipu` (free GLM-4V-Flash), or `gemini` (free key). Explicit fields win. |
| `baseURL` | — (required for `custom`) | OpenAI-compatible root URL; `/chat/completions` or `/responses` appended per `apiStyle`. |
| `model` | preset, else `qwen3-vl-plus` | Vision model for `describe_image`; optional thinking suffix `:off/:low/:medium/:high`. |
| `ocrModel` | preset, else `qwen3.5-ocr` | OCR model for `extract_text`; same suffix support. |
| `apiKey` | — | Inline key, stored in the settings document (secret: never shown by the GUI). |
| `apiKeyEnv` | `VISION_API_KEY` | Credential-reference (env var name) resolved through the credential seam; empty disables. |
| `criticalPrompt` | built-in | `describe_image` critical-perspective prompt when the model passes none. |
| `normalPrompt` | built-in | `describe_image` normal-perspective prompt when the model passes none. |
| `ocrPrompt` | built-in | `extract_text` prompt when the model passes none. |
| `apiStyle` | `chat-completions` | `chat-completions` or `responses`. |
| `maxBytes` | `10485760` | Image byte bound (local files and downloads). Hi-res PNG wallpapers (10–30 MB) exceed the default; raise it — preprocessing compresses after loading. |
| `maxOutputTokens` | `1024` | Output-token cap sent to the endpoint. |
| `timeoutMs` | `60000` | Per-attempt timeout. |
| `maxRetries` | `2` | Retries for transient failures (timeout / network / 429 / 5xx); 0 disables. |
| `maxEdge` | `1568` | Max image edge (px) before auto-scaling; 0 disables preprocessing. |
| `compressEnabled` | `true` | Auto scale/re-encode oversize images (macOS `sips`; skipped elsewhere). |
| `cacheEnabled` | `true` | Persistent content-addressed answer cache (cross-session). |
| `cacheDir` | `$XDG_CACHE_HOME/dsh-llm-vision` | Cache directory. |
| `cacheTtlDays` | `30` | Cache entry lifetime (days). |
| `cacheMaxEntries` | `500` | Cache capacity; oldest evicted. |
| `renderImagePreview` | `true` | Upgrade attach references into inline thumbnails (display only). |
| `interceptImageSend` | `true` | Rewrite image-bearing sends into attach references at submit; turn off to hand raw image blocks to other vision plugins. |

#### Migrating from v0.2.x

v0.3.0 makes the settings card the authoritative configuration surface.
There was no released user base before this change, so there is no automatic
migration: after upgrading, remove the old `llm-vision` config block from
`cordis.patch.yml` and re-enter your endpoint and key in the card once
(any values you had there — e.g. a raised `maxBytes` — must be set again in
the GUI). Environment variables set for the key (`VISION_API_KEY` etc.) keep
working as the `apiKeyEnv` fallback.

## Reliability engineering

- **Auto-preprocessing** — images over 1568px are scaled, oversize files re-encoded (JPEG q85,
  transparent formats kept as PNG) via the macOS built-in `sips`; every failure silently falls
  back to the original image. HEIC/HEIF inputs are always re-encoded to JPEG (endpoints support
  HEIC unevenly), failing loudly only when `sips` is absent. Fixes the classic "big screenshot
  times out" failure.
- **Retries** — transient errors retry up to `maxRetries` with exponential backoff
  (≤ 4s) under a shrinking per-attempt budget (total ≤ 2× timeout). Exhausted retries append
  `（已重试 N 次）`. Caller cancellation aborts immediately without retry.
- **Persistent cache** — identical image + model + prompt + preprocessing settings hit a
  content-addressed cache (SHA-256 over the image bytes) at `~/.cache/dsh-llm-vision/`; only the
  text answer is stored, never image bytes; TTL 30 days, 500 entries, atomic writes, 0600/0700
  permissions. Note: OCR results of sensitive documents are stored in plain text there — set
  `cacheEnabled` to false when that matters.

## Security model

- The vision request and any image download refuse HTTP redirects (`redirect: 'error'`) — bearer
  credentials and image bytes never leave the configured endpoint.
- Request bodies carry the base64 image but never the key; parsed credentials are never logged.
- Only http(s) URLs and local paths are accepted; all other schemes are rejected.
- Attach uploads are validated (strict base64, magic bytes, byte bound) before the attachment
  store persists them; only the reference JSON (text) enters the session.
- Response bodies are capped (`maxOutputTokens × 8 + 64 KiB`) before parsing; error excerpts are
  bounded to 200 chars.
- Calling the tools sends the image bytes to the configured endpoint — only hand the model images
  you are comfortable leaving your machine.

## Testing status

227 offline unit/integration tests (vitest, mock HTTP server, tmp-dir cache)
plus a strict typecheck and CI on every push. Verified **end-to-end in the
real DSH web GUI** against a live OpenAI-compatible vision endpoint:
`describe_image` reads a real image (DashScope `qwen3-vl-plus`), `extract_text`
OCR returns real transcription (`qwen3.5-ocr`), the attach upload/readback
routes work through the live web server, and the settings card renders and
saves in the plugin-configuration page — see [Configure](#configure).

## Known limitations

- Attachment/upload channel: PNG / JPEG / GIF / WebP only (the official attachment store's
  type set). **HEIC/HEIF images are read directly by the tools** from local paths and URLs —
  preprocessing re-encodes them to JPEG on macOS — but pasting a HEIC file into the GUI is
  rejected with a hint; convert it or pass the path instead. On Windows/Linux (no `sips`) a
  HEIC/HEIF read fails with a clear message.
- Preprocessing relies on macOS `sips` (zero dependencies); on Windows/Linux the
  plugin degrades silently and sends the original bytes — never an error, but
  oversized images are then likelier to time out. The bound gates loading
  (`maxBytes`), so a too-small bound is a clean rejection, never a crash.

## Development

```bash
pnpm typecheck   # tsc -b + vitest program
pnpm test        # vitest run (227 tests, fully offline)
pnpm build       # tsc -b && tsdown → lib/ + lib/client.js
pnpm watch       # tsdown --watch
```

## License & attribution

Apache-2.0. Built on: deepseek-harness packages/vision/tool-describe-image
(whitelonng/dsh-plugin-describe-image, MIT), the dsh-web-ui plugin family (Apache-2.0), and the
llm_vision design (MIT). See [NOTICE](NOTICE) and [AGENTS.md](AGENTS.md).
