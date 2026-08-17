# dsh-llm-vision

**Reliable vision + OCR for text-only models on DeepSeek Harness.**

The TypeScript-native port of [llm_vision](https://github.com/1710782766/llm_vision) (MIT):
the same prompt engineering that made screenshot QA trustworthy, the same reliability
engineering (preprocessing / retries / persistent cache) — plus the DSH-native experience
paste-bridge, live settings card, URL input, and attachment references.

> **Status: v1 in local development** — not yet published to npm/GitHub.

## Why

Text-only models (DeepSeek V4, GLM text series, …) cannot see images. This plugin registers
two model-facing tools backed by any OpenAI-compatible vision endpoint:

| Tool | Purpose |
|---|---|
| \u0060describe_image\u0060 | Image understanding with two perspectives: **normal** (natural description) and **critical** (objective inspection that actively reports text misalignment, overlap, occlusion, wrapping anomalies, missing elements, and separates fact from guess). The critical lens is the field-tested antidote to vision models rationalizing rendering bugs — use it for page/UI problem reports and screenshot-vs-design comparisons. |
| \u0060extract_text\u0060 | OCR & document parsing through a dedicated OCR model — ID cards, invoices, receipts; structured output (JSON/CSV) on request; verbatim extraction that never guesses missing text. |

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
| \u0060baseURL\u0060 | — (required) | OpenAI-compatible root URL; /chat/completions or /responses appended per \u0060apiStyle\u0060. |
| \u0060model\u0060 | \u0060qwen3-vl-plus\u0060 | Vision model for \u0060describe_image\u0060; optional thinking suffix \u0060:off/:low/:medium/:high\u0060. |
| \u0060ocrModel\u0060 | \u0060qwen3.5-ocr\u0060 | OCR model for \u0060extract_text\u0060; same suffix support. |
| \u0060apiKey\u0060 | — | Inline key; prefer \u0060apiKeyEnv\u0060. Schema marks it secret. |
| \u0060apiKeyEnv\u0060 | \u0060VISION_API_KEY\u0060 | Credential-reference (env var name) resolved through the credential seam; empty disables. |
| \u0060criticalPrompt\u0060 | built-in | \u0060describe_image\u0060 critical-perspective prompt when the model passes none. |
| \u0060normalPrompt\u0060 | built-in | \u0060describe_image\u0060 normal-perspective prompt when the model passes none. |
| \u0060ocrPrompt\u0060 | built-in | \u0060extract_text\u0060 prompt when the model passes none. |
| \u0060apiStyle\u0060 | \u0060chat-completions\u0060 | \u0060chat-completions\u0060 or \u0060responses\u0060. |
| \u0060maxBytes\u0060 | \u006010485760\u0060 | Image byte bound (local files and downloads). |
| \u0060maxOutputTokens\u0060 | \u00601024\u0060 | Output-token cap sent to the endpoint. |
| \u0060timeoutMs\u0060 | \u006060000\u0060 | Per-attempt timeout. |
| \u0060maxRetries\u0060 | \u00602\u0060 | Retries for transient failures (timeout / network / 429 / 5xx); 0 disables. |
| \u0060maxEdge\u0060 | \u00601568\u0060 | Max image edge (px) before auto-scaling; 0 disables preprocessing. |
| \u0060compressEnabled\u0060 | \u0060true\u0060 | Auto scale/re-encode oversize images (macOS \u0060sips\u0060; skipped elsewhere). |
| \u0060cacheEnabled\u0060 | \u0060true\u0060 | Persistent content-addressed answer cache (cross-session). |
| \u0060cacheDir\u0060 | \u0060$XDG_CACHE_HOME/dsh-llm-vision\u0060 | Cache directory. |
| \u0060cacheTtlDays\u0060 | \u006030\u0060 | Cache entry lifetime (days). |
| \u0060cacheMaxEntries\u0060 | \u0060500\u0060 | Cache capacity; oldest evicted. |
| \u0060renderImagePreview\u0060 | \u0060true\u0060 | Upgrade attach references into inline thumbnails (display only). |
| \u0060interceptImageSend\u0060 | \u0060true\u0060 | Rewrite image-bearing sends into attach references at submit; turn off to hand raw image blocks to other vision plugins. |

## Reliability engineering

- **Auto-preprocessing** — images over 1568px are scaled, oversize files re-encoded (JPEG q85,
  transparent formats kept as PNG) via the macOS built-in \u0060sips\u0060; every failure silently falls
  back to the original image. Fixes the classic "big screenshot times out" failure.
- **Retries** — transient errors retry up to \u0060maxRetries\u0060 with exponential backoff
  (≤ 4s) under a shrinking per-attempt budget (total ≤ 2× timeout). Exhausted retries append
  \u0060（已重试 N 次）\u0060. Caller cancellation aborts immediately without retry.
- **Persistent cache** — identical image + model + prompt + preprocessing settings hit a
  content-addressed cache (SHA-256 over the image bytes) at \u0060~/.cache/dsh-llm-vision/\u0060; only the
  text answer is stored, never image bytes; TTL 30 days, 500 entries, atomic writes, 0600/0700
  permissions. Note: OCR results of sensitive documents are stored in plain text there — set
  \u0060cacheEnabled\u0060 to false when that matters.

## Security model

- The vision request and any image download refuse HTTP redirects (\u0060redirect: 'error'\u0060) — bearer
  credentials and image bytes never leave the configured endpoint.
- Request bodies carry the base64 image but never the key; parsed credentials are never logged.
- Only http(s) URLs and local paths are accepted; all other schemes are rejected.
- Attach uploads are validated (strict base64, magic bytes, byte bound) before the attachment
  store persists them; only the reference JSON (text) enters the session.
- Response bodies are capped (\u0060maxOutputTokens × 8 + 64 KiB\u0060) before parsing; error excerpts are
  bounded to 200 chars.
- Calling the tools sends the image bytes to the configured endpoint — only hand the model images
  you are comfortable leaving your machine.

## Known limitations

- PNG / JPEG / GIF / WebP only (magic-byte gate; the host attachment pipeline shares the same set).
- Single image per call — no multi-image input or follow-up questions against a previous image.
- Preprocessing relies on macOS \u0060sips\u0060; other platforms fall back to timeout + retry.

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