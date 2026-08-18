# dsh-llm-vision

English | [中文](README.zh.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/1710782766/dsh-llm-vision.svg)](https://github.com/1710782766/dsh-llm-vision)
[![CI](https://github.com/1710782766/dsh-llm-vision/actions/workflows/ci.yml/badge.svg)](https://github.com/1710782766/dsh-llm-vision/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22-blue.svg)](package.json)

**Reliable vision + OCR for text-only models on DeepSeek Harness.**

Prompt engineering that makes screenshot QA trustworthy, the same reliability
engineering (preprocessing / retries / persistent cache) — plus the DSH-native
experience paste-bridge, live settings card, URL input, and attachment references.

> **Status**: v0.2.2 on GitHub and npm. Verified end-to-end against a live
> OpenAI-compatible vision endpoint (DashScope `qwen3-vl-plus` / `qwen3.5-ocr`)
> in the real web GUI; 217 offline tests. v0.2.0 added free provider presets
> (Zhipu GLM-4V-Flash, Gemini), multi-image batch reads, a `llm_vision_check`
> diagnostic tool, and HEIC/HEIF support. v0.2.2 fixes the `llm_vision_check`
> testCall probe to a 64×64 image (the old 1×1 probe was rejected by
> qwen3-vl-plus's minimum-size rule) — the diagnostic now passes end to end.

## Why

Text-only models (DeepSeek V4, GLM text series, …) cannot see images. This plugin registers
model-facing tools backed by any OpenAI-compatible vision endpoint:

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
  retries, preprocessing, and cache — no restart needed.
- **Three input kinds** per call: local absolute path, http(s) URL (redirects refused), or
  attachment reference.
- **The image never enters the session log** — only the returned text crosses into the
  conversation.

## Install

```sh
dsh plugin --profile web add dsh-llm-vision@0.2.2
```

The version is pinned on purpose: pnpm 11 holds back packages published in the
last 24 hours, so a bare `add dsh-llm-vision` (latest) would silently install
the previous release on launch day. This line is bumped with every release.

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

The official web GUI's plugin-configuration page only exposes allowlisted
settings namespaces — third-party namespaces are a deliberate security
boundary (the harness comments call plugin-declared exposure "deferred
work"). The settings card therefore shows a "namespace not exposed" note;
configure through the profile patch layer instead, referencing the key from
the environment (never a plaintext key in a patch file):

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: llm-vision
  name: 'dsh-llm-vision'
  config:
    baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen3-vl-plus
    ocrModel: qwen3.5-ocr
    apiKey: !!js process.env.VISION_API_KEY
```

```sh
# ~/.dsh/.env (or export it before launching dsh)
VISION_API_KEY=sk-...
```

Then restart the GUI. The card is visible in Settings → Plugins and explains
this gap instead of vanishing.

#### Free presets (zero-cost routes)

Instead of naming `baseURL` / `model` / `ocrModel` yourself, one `provider`
switch fills them from a built-in preset — including two **permanently free**
vision routes (facts verified 2026-08; free policies change, so re-check the
provider docs if a call stops working):

```yaml
# Zhipu BigModel — free GLM-4V-Flash (best default in mainland China)
- id: llm-vision
  name: 'dsh-llm-vision'
  config:
    provider: zhipu
    apiKey: !!js process.env.ZHIPU_API_KEY   # or set apiKeyEnv: ZHIPU_API_KEY
```

```sh
# ~/.dsh/.env
ZHIPU_API_KEY=your-zhipu-key   # https://open.bigmodel.cn — free tier, no card
```

```yaml
# Google Gemini — free key from Google AI Studio (aistudio.google.com, no card)
- id: llm-vision
  name: 'dsh-llm-vision'
  config:
    provider: gemini
    apiKey: !!js process.env.GEMINI_API_KEY
```

```yaml
# Alibaba DashScope (the default models, as a preset)
- id: llm-vision
  name: 'dsh-llm-vision'
  config:
    provider: dashscope
    apiKey: !!js process.env.DASHSCOPE_API_KEY
```

Explicit `baseURL` / `model` / `ocrModel` / `apiKeyEnv` always override the
preset. The free presets reuse the vision model for OCR (`extract_text` drives
it with the OCR prompt) — free tiers are rate-limited, so they suit
interactive use better than batch runs.

| Key | Default | Meaning |
|---|---|---|
| `provider` | `custom` | Endpoint preset: `custom` (all fields explicit), `dashscope`, `zhipu` (free GLM-4V-Flash), or `gemini` (free key). Explicit fields win. |
| `baseURL` | — (required for `custom`) | OpenAI-compatible root URL; `/chat/completions` or `/responses` appended per `apiStyle`. |
| `model` | `qwen3-vl-plus` | Vision model for `describe_image`; optional thinking suffix `:off/:low/:medium/:high`. |
| `ocrModel` | `qwen3.5-ocr` | OCR model for `extract_text`; same suffix support. |
| `apiKey` | — | Inline key; prefer `apiKeyEnv`. Schema marks it secret. |
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

216 offline unit/integration tests (vitest, mock HTTP server, tmp-dir cache)
plus a strict typecheck and CI on every push. Verified **end-to-end in the
real DSH web GUI** against a live OpenAI-compatible vision endpoint:
`describe_image` reads a real image (DashScope `qwen3-vl-plus`), `extract_text`
OCR returns real transcription (`qwen3.5-ocr`), the attach upload/readback
routes work through the live web server, and the settings card renders in the
plugin-configuration page. Known cosmetic gap: the card cannot edit values in
the GUI (official settings allowlist), so configuration lives in the patch
layer — see [Configure](#configure).

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
pnpm test        # vitest run (216 tests, fully offline)
pnpm build       # tsc -b && tsdown → lib/ + lib/client.js
pnpm watch       # tsdown --watch
```

## License & attribution

Apache-2.0. Built on: deepseek-harness packages/vision/tool-describe-image
(whitelonng/dsh-plugin-describe-image, MIT), the dsh-web-ui plugin family (Apache-2.0), and the
llm_vision design (MIT). See [NOTICE](NOTICE) and [AGENTS.md](AGENTS.md).
