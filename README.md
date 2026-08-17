# dsh-llm-vision

English | [中文](README.zh.md)

**Reliable vision + OCR for text-only models on DeepSeek Harness.**

Prompt engineering that makes screenshot QA trustworthy, the same reliability
engineering (preprocessing / retries / persistent cache) — plus the DSH-native
experience paste-bridge, live settings card, URL input, and attachment references.

> **Status**: v1 source on GitHub — **not yet published to npm**, and not yet
> verified against a live vision endpoint (covered by 183 offline tests).

## Why

Text-only models (DeepSeek V4, GLM text series, …) cannot see images. This plugin registers
two model-facing tools backed by any OpenAI-compatible vision endpoint:

| Tool | Purpose |
|---|---|
| `describe_image` | Image understanding with two perspectives: **normal** (natural description) and **critical** (objective inspection that actively reports text misalignment, overlap, occlusion, wrapping anomalies, missing elements, and separates fact from guess). The critical lens is the antidote to vision models rationalizing rendering bugs — use it for page/UI problem reports and screenshot-vs-design comparisons. |
| `extract_text` | OCR & document parsing through a dedicated OCR model — ID cards, invoices, receipts; structured output (JSON/CSV) on request; verbatim extraction that never guesses missing text. |

Plus the DSH-native experience:

- **Paste / drag / drop** an image into the composer and send — the browser half rewrites the
  image-bearing send into an attach reference the text model can resolve, and upgrades the
  reference into an inline thumbnail in the transcript.
- **Live settings card** (Settings → Plugins → llm-vision): endpoint, models, prompts, bounds,
  retries, preprocessing, and cache — no restart needed.
- **Three input kinds** per call: local absolute path, http(s) URL (redirects refused), or
  attachment reference.
- **The image never enters the session log** — only the returned text crosses into the
  conversation.

## Install

**Not published to npm yet.** `dsh plugin add <name>` resolves package names against the npm
registry, so the one-liner only works once the package is published. Until then, install from
a local tarball or checkout:

### Option 1 — tarball (recommended)

```sh
# from this repository checkout:
pnpm install && pnpm build && pnpm pack        # → dsh-llm-vision-0.1.0.tgz
dsh plugin --profile web add ./dsh-llm-vision-0.1.0.tgz
```

The tarball ships prebuilt `lib/` (both the node half and `lib/client.js`), so no build step
runs on the installing machine.

### Option 2 — local checkout

```sh
git clone https://github.com/1710782766/dsh-llm-vision.git
cd dsh-llm-vision && pnpm install && pnpm build   # lib/ is gitignored — must be built first
dsh plugin --profile web add /absolute/path/to/dsh-llm-vision
```

### Once published to npm

```sh
dsh plugin --profile web add dsh-llm-vision
```

### Configure

Settings → Plugins → llm-vision, or via the patch layer:

```yaml
- id: llm-vision
  name: 'dsh-llm-vision'
  config:
    baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen3-vl-plus
    ocrModel: qwen3.5-ocr
    apiKey: !!js process.env.VISION_API_KEY
```

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | — (required) | OpenAI-compatible root URL; `/chat/completions` or `/responses` appended per `apiStyle`. |
| `model` | `qwen3-vl-plus` | Vision model for `describe_image`; optional thinking suffix `:off/:low/:medium/:high`. |
| `ocrModel` | `qwen3.5-ocr` | OCR model for `extract_text`; same suffix support. |
| `apiKey` | — | Inline key; prefer `apiKeyEnv`. Schema marks it secret. |
| `apiKeyEnv` | `VISION_API_KEY` | Credential-reference (env var name) resolved through the credential seam; empty disables. |
| `criticalPrompt` | built-in | `describe_image` critical-perspective prompt when the model passes none. |
| `normalPrompt` | built-in | `describe_image` normal-perspective prompt when the model passes none. |
| `ocrPrompt` | built-in | `extract_text` prompt when the model passes none. |
| `apiStyle` | `chat-completions` | `chat-completions` or `responses`. |
| `maxBytes` | `10485760` | Image byte bound (local files and downloads). |
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
  back to the original image. Fixes the classic "big screenshot times out" failure.
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

183 offline unit/integration tests (vitest, mock HTTP server, tmp-dir cache) plus a strict
typecheck — but the plugin has **not yet been exercised against a live vision endpoint or a
real DSH web GUI session**. Expect rough edges until that verification happens.

## Known limitations

- PNG / JPEG / GIF / WebP only (magic-byte gate; the host attachment pipeline shares the same set).
- Single image per call — no multi-image input or follow-up questions against a previous image.
- Preprocessing relies on macOS `sips`; other platforms fall back to timeout + retry.

## Development

```bash
pnpm typecheck   # tsc -b + vitest program
pnpm test        # vitest run (183 tests, fully offline)
pnpm build       # tsc -b && tsdown → lib/ + lib/client.js
pnpm watch       # tsdown --watch
```

## License & attribution

Apache-2.0. Built on: deepseek-harness packages/vision/tool-describe-image
(whitelonng/dsh-plugin-describe-image, MIT), the dsh-web-ui plugin family (Apache-2.0), and the
llm_vision design (MIT). See [NOTICE](NOTICE) and [AGENTS.md](AGENTS.md).
