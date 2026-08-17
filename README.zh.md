# dsh-llm-vision

**给纯文本模型可靠视觉 + OCR 的 DeepSeek Harness 插件。**

[llm_vision](https://github.com/1710782766/llm_vision)（MIT）的 TypeScript 原生移植：
沉淀了让截图 QA 可信的提示词工程、同款可靠性工程（预处理 / 重试 / 持久缓存），
并补齐 DSH 原生体验——粘贴桥、免重启设置卡、URL 输入、附件引用。

> **状态：v1 本地开发中**——尚未发布到 npm / GitHub。

## 为什么需要它

纯文本模型（DeepSeek V4、GLM 文本系列……）看不了图。本插件注册两个面向模型的工具，
后端是任意 OpenAI 兼容视觉端点：

| 工具 | 用途 |
|---|---|
| \u0060describe_image\u0060 | 双视角图像理解：**normal**（自然描述）与 **critical**（审视视角——客观描述并主动报告文字错位、遮挡、重叠、换行异常、元素缺失，区分事实与推测）。critical 是实测沉淀的「视觉模型会给渲染 bug 找补」解药：页面/界面问题报告与截图对照设计稿时必用。 |
| \u0060extract_text\u0060 | 走专用 OCR 模型的文字提取——证件、发票、回执；按需结构化输出（JSON/CSV）；只提取真实可见内容、绝不补全猜测。 |

DSH 原生体验：

- **粘贴 / 拖拽**图片到输入框发送即可：浏览器半在提交时把带图发送改写为附件引用（文本模型可解析），
  并在会话里把引用原地升级为缩略图。
- **免重启设置卡**（设置 → 插件配置 → llm-vision）：端点、模型、提示词、上限、重试、预处理、缓存。
- **三种输入**：本地绝对路径、http(s) URL（拒绝重定向）、附件引用。
- **图片永不进入会话记录**——只有返回文字进入对话。

## 安装

```sh
dsh plugin --profile web add dsh-llm-vision
```

### 配置

设置 → 插件配置 → llm-vision，或经 patch 层：

```yaml
- id: llm-vision
  name: 'dsh-llm-vision'
  config:
    baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen3-vl-plus
    ocrModel: qwen3.5-ocr
    apiKey: !!js process.env.VISION_API_KEY
```

| 键 | 默认 | 含义 |
|---|---|---|
| \u0060baseURL\u0060 | —（必填） | OpenAI 兼容根地址；按 \u0060apiStyle\u0060 追加 /chat/completions 或 /responses。 |
| \u0060model\u0060 | \u0060qwen3-vl-plus\u0060 | \u0060describe_image\u0060 使用的视觉模型；可带思考后缀 \u0060:off/:low/:medium/:high\u0060。 |
| \u0060ocrModel\u0060 | \u0060qwen3.5-ocr\u0060 | \u0060extract_text\u0060 使用的 OCR 模型；同样支持后缀。 |
| \u0060apiKey\u0060 | — | 内联密钥；建议用 \u0060apiKeyEnv\u0060。schema 标记为 secret。 |
| \u0060apiKeyEnv\u0060 | \u0060VISION_API_KEY\u0060 | 凭证引用（环境变量名），经凭证服务解析；空字符串禁用。 |
| \u0060criticalPrompt\u0060 | 内置 | \u0060describe_image\u0060 critical 视角在模型未传 prompt 时使用。 |
| \u0060normalPrompt\u0060 | 内置 | \u0060describe_image\u0060 normal 视角在模型未传 prompt 时使用。 |
| \u0060ocrPrompt\u0060 | 内置 | \u0060extract_text\u0060 在模型未传 prompt 时使用。 |
| \u0060apiStyle\u0060 | \u0060chat-completions\u0060 | \u0060chat-completions\u0060 或 \u0060responses\u0060。 |
| \u0060maxBytes\u0060 | \u006010485760\u0060 | 图片字节上限（本地与下载一致）。 |
| \u0060maxOutputTokens\u0060 | \u00601024\u0060 | 发给端点的输出 token 上限。 |
| \u0060timeoutMs\u0060 | \u006060000\u0060 | 单次尝试超时。 |
| \u0060maxRetries\u0060 | \u00602\u0060 | 瞬时错误（超时/网络/429/5xx）重试次数；0 禁用。 |
| \u0060maxEdge\u0060 | \u00601568\u0060 | 图片最大边长（像素），超限自动缩放；0 禁用预处理。 |
| \u0060compressEnabled\u0060 | \u0060true\u0060 | 超大图自动缩放/重压（macOS \u0060sips\u0060；其他平台跳过）。 |
| \u0060cacheEnabled\u0060 | \u0060true\u0060 | 持久内容寻址缓存（跨会话复用）。 |
| \u0060cacheDir\u0060 | \u0060$XDG_CACHE_HOME/dsh-llm-vision\u0060 | 缓存目录。 |
| \u0060cacheTtlDays\u0060 | \u006030\u0060 | 缓存保留天数。 |
| \u0060cacheMaxEntries\u0060 | \u0060500\u0060 | 缓存条数上限，超限淘汰最旧。 |
| \u0060renderImagePreview\u0060 | \u0060true\u0060 | 附件引用原地渲染缩略图（仅影响本地显示）。 |
| \u0060interceptImageSend\u0060 | \u0060true\u0060 | 发送时改写带图消息为附件引用；关闭则原样放行（与其他视觉插件共用时）。 |

## 可靠性工程

- **自动预处理**——超过 1568px 的图片自动等比缩放、大体积重编码（JPEG q85，透明格式保留 PNG），
  基于 macOS 自带 \u0060sips\u0060 零依赖；任何失败静默回退原图。解决「大截图必超时」经典故障。
- **重试**——瞬时错误按 \u0060maxRetries\u0060 重试，指数退避（≤4s），预算等比递减（总预算 ≤ 2×超时）；
  耗尽重试的错误带「（已重试 N 次）」后缀；调用方取消立即中止、绝不重试。
- **持久缓存**——相同图片 + 模型 + 提示词 + 预处理参数命中内容寻址缓存（图片字节 SHA-256），
  存于 \u0060~/.cache/dsh-llm-vision/\u0060；只存文字回答、绝不存图片字节；TTL 30 天、上限 500 条、
  原子写、0600/0700 权限。注意：敏感文档的 OCR 结果会以明文存在该缓存文件里——在意时把 \u0060cacheEnabled\u0060 关掉。

## 安全模型

- 视觉请求与图片下载一律拒绝 HTTP 重定向（\u0060redirect: 'error'\u0060）——bearer 凭证与图片字节不会离开所配端点。
- 请求体携带 base64 图片但不携带密钥；解析出的凭证绝不进日志。
- 只接受 http(s) URL 与本地路径，其余协议一律拒绝。
- 附件上传先校验（严格 base64、magic bytes、字节上限）再交给附件存储；只有引用 JSON（文本）进入会话。
- 响应体先按上限截断（\u0060maxOutputTokens × 8 + 64 KiB\u0060）再解析；错误摘要有界（200 字符）。
- 调用工具即把图片字节外发到所配端点——只把允许外传的图片交给模型。

## 已知限制

- 仅 PNG / JPEG / GIF / WebP（magic-byte 门；与宿主附件管线一致）。
- 单图单答：不支持多图输入或对上一张图的追问。
- 预处理依赖 macOS \u0060sips\u0060；其他平台靠超时 + 重试兜底。

## 开发

```bash
pnpm typecheck   # tsc -b + vitest 程序
pnpm test        # vitest run（183 个测试，全部离线）
pnpm build       # tsc -b && tsdown → lib/ + lib/client.js
pnpm watch       # tsdown --watch
```

## 许可与署名

Apache-2.0。基于：deepseek-harness packages/vision/tool-describe-image
（whitelonng/dsh-plugin-describe-image，MIT）、dsh-web-ui 插件全家桶（Apache-2.0）、
llm_vision 设计（MIT）。见 [NOTICE](NOTICE) 与 [AGENTS.md](AGENTS.md)。