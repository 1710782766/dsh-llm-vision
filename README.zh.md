# dsh-llm-vision

[English](README.md) | 中文

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/1710782766/dsh-llm-vision.svg)](https://github.com/1710782766/dsh-llm-vision)
[![CI](https://github.com/1710782766/dsh-llm-vision/actions/workflows/ci.yml/badge.svg)](https://github.com/1710782766/dsh-llm-vision/actions/workflows/ci.yml)
[![Node](<https://img.shields.io/badge/node-%3E%3D22-blue.svg>)](package.json)

**给 DeepSeek Harness 装上一双眼睛**——让纯文本模型可靠地看懂图片与文档，配置全部在 GUI 完成。

粘贴图片即可让模型描述或阅读；大图自动压缩、瞬时失败自动重试、相同图片命中持久缓存。
内置免费预设（智谱 / Gemini / DashScope）零配置上手，全程不碰配置文件。

## 快速上手

```sh
dsh plugin --profile web add dsh-llm-vision@0.3.2
```

1. **安装**（上面命令，或见[安装](#安装)）；
2. **重启一次 GUI**——插件在启动时加载，重启后设置卡才可见；此后改配置永不需重启；
3. 打开**设置 → 插件 → llm-vision**，选一个**服务商预设**（`zhipu` / `gemini` / `dashscope`
   自动填充端点字段——免费路线，无需绑卡，见[免费预设表](#免费预设零成本路线)）；
4. 在卡片的 **API Key** 字段**粘贴你的密钥**并**保存**（写入本机仅本人可读的设置文档，
   不再回显）；
5. **开用**——把图片粘贴 / 拖拽进输入框发送，模型就能看懂；或调用 `llm_vision_check`
   工具做一次全链路诊断。

## 为什么需要它

纯文本模型（DeepSeek V4、GLM 文本系列……）看不了图。本插件注册面向模型的工具，
后端是任意 OpenAI 兼容视觉端点：

| 工具                 | 用途                                                                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describe_image`   | 双视角图像理解：**normal**（自然描述）与 **critical**（审视视角——客观描述并主动报告文字错位、遮挡、重叠、换行异常、元素缺失，区分事实与推测）。critical 是「视觉模型会给渲染 bug 找补」的解药：页面/界面问题报告与截图对照设计稿时必用。支持单张 `image` 或一次最多 8 张的 `images` 批量读取。 |
| `extract_text`     | 走专用 OCR 模型的文字提取——证件、发票、回执；按需结构化输出（JSON/CSV）；只提取真实可见内容、绝不补全猜测。                                                                                                                                                                                                    |
| `llm_vision_check` | 诊断：验证配置、API key 能否解析、端点能否通过带鉴权的探测——可选`testCall` 发一次真实端到端视觉调用。报告里绝不出现密钥本身。                                                                                                                                                                                |

DSH 原生体验：

- **粘贴 / 拖拽**图片到输入框发送即可：浏览器半在提交时把带图消息改写为附件引用（文本模型可解析），
  并在会话里把引用原地升级为缩略图。
- **免重启设置卡**（设置 → 插件 → llm-vision）：端点、模型、提示词、上限、重试、预处理、缓存——
  保存即对下一次调用生效。
- **三种输入**：本地绝对路径、http(s) URL（拒绝重定向）、附件引用。
- **图片永不进入会话记录**——只有返回文字进入对话。

## 安装

```sh
dsh plugin --profile web add dsh-llm-vision@0.3.2
```

然后**重启一次 GUI**——插件在启动时加载，重启后插件与设置卡才可见（此后改配置
永不需重启）。

版本号是刻意钉扎的：pnpm 11 会暂缓 24 小时内新发布的包，裸 `add dsh-llm-vision`
（latest）在发版当天会静默装到上一版。本行随每次发版同步更新。`--profile web`
是当前部署的 GUI profile 名——不同部署请换成自己的 profile。

本版本要求 **dsh ≥ 0.1.2-alpha.1**（设置卡宿主 API 与浏览器半的 store 在该版本
调整）；更旧的 harness 无法渲染设置卡。

从源码 checkout 安装时，同一命令接受 tarball 或本地路径
（`pnpm pack` 以当前版本命名 tarball——请使用实际产出的文件名）：

```sh
pnpm install && pnpm build && pnpm pack   # → dsh-llm-vision-<版本号>.tgz
dsh plugin --profile web add ./dsh-llm-vision-<版本号>.tgz
# 或：dsh plugin --profile web add /路径/dsh-llm-vision   （先 build——lib/ 被 gitignore）
```

tarball 自带预构建的 `lib/`（node 半 + `lib/client.js`），安装方无需执行构建。

### 配置

一切配置都在 GUI 里完成——**设置 → 插件 → llm-vision** 卡片。不需要 patch
文件，也不需要导出环境变量：

1. 打开**设置 → 插件**，找到 **llm-vision** 卡片。
2. 选一个**服务商预设**即可零配置走免费路线；或选 `custom` 自己填
   `baseURL` / `model` / `ocrModel`。
3. 在 **API Key** 字段**粘贴你的密钥**——最简单的方式：它写入本机仅本人可读的
   设置文档（`~/.dsh/settings.yaml`，`0600`），GUI 不再回显。*高级*：留空该字段，
   让 `apiKeyEnv` 经凭证服务解析（预设会预填如 `DASHSCOPE_API_KEY`；默认
   `VISION_API_KEY`）——适合偏好环境变量的用户。
4. **保存**——下一次调用立即生效，无需重启。

配置前首次调用会得到清晰提示（`llm-vision: baseURL must be an absolute http(s) URL`）——
这是预期的未配置状态，不是安装坏了。

配置存于 harness 设置文档（`~/.dsh/settings.yaml`，`0600`，跨 profile 共享），
由 GUI 写入。profile patch 层仍可提供卡片的*部署默认值*（卡片上显示为
「继承」），但卡片保存的值始终优先——用户只需要 GUI 这一个配置入口。
没有 settings 提供者的部署回退到内置默认。

#### 免费预设（零成本路线）

**服务商预设**选择器会自动填充 `baseURL` / `model` / `ocrModel` /
`apiKeyEnv`——免费路线，无需绑卡。免费政策会变，调用失效时请复查各厂商文档：

| 预设 | 端点 | 免费密钥获取 |
|---|---|---|
| `zhipu` | 智谱 BigModel——永久免费 GLM-4V-Flash；中国大陆最佳默认 | open.bigmodel.cn——注册后创建 API key，免费额度，无需绑卡 |
| `gemini` | Google Gemini——Google AI Studio 免费 key（aistudio.google.com） | AI Studio 里 "Get API key"，免绑卡；**中国大陆直连不可用（需代理）** |
| `dashscope` | 阿里 DashScope（默认模型）带免费额度 | 阿里云百炼控制台（bailian.console.aliyun.com）——免费额度；中国大陆可直连 |

选择预设会预填端点字段（保存前仍可修改）；显式字段值在调用时始终优先。
免费预设的 OCR 复用同一视觉模型（`extract_text` 用 OCR 提示词驱动）——
免费层有限速，更适合交互使用而非批量跑。

| 键                     | 默认                               | 含义                                                                                                                        |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `provider`           | `custom`                         | 端点预设：`custom`（全部字段显式）、`dashscope`、`zhipu`（免费 GLM-4V-Flash）、`gemini`（免费 key）。显式字段优先。 |
| `baseURL`            | —（`custom` 必填）              | OpenAI 兼容根地址；按`apiStyle` 追加 /chat/completions 或 /responses。                                                    |
| `model`              | 预设，否则 `qwen3-vl-plus`       | `describe_image` 使用的视觉模型；可带思考后缀 `:off/:low/:medium/:high`。                                               |
| `ocrModel`           | 预设，否则 `qwen3.5-ocr`         | `extract_text` 使用的 OCR 模型；同样支持后缀。                                                                            |
| `apiKey`             | —                                 | 内联密钥，写入设置文档（secret：GUI 永不回显）。                                                                            |
| `apiKeyEnv`          | `VISION_API_KEY`                 | 凭证引用（环境变量名），经凭证服务解析；空字符串禁用。                                                                      |
| `criticalPrompt`     | 内置                               | `describe_image` critical 视角在模型未传 prompt 时使用。                                                                  |
| `normalPrompt`       | 内置                               | `describe_image` normal 视角在模型未传 prompt 时使用。                                                                    |
| `ocrPrompt`          | 内置                               | `extract_text` 在模型未传 prompt 时使用。                                                                                 |
| `apiStyle`           | `chat-completions`               | `chat-completions` 或 `responses`。                                                                                     |
| `maxBytes`           | `10485760`                       | 图片字节上限（本地与下载一致）。高清 PNG 壁纸（10–30MB）会超默认值；调大即可——加载后预处理会接管压缩。                   |
| `maxOutputTokens`    | `1024`                           | 发给端点的输出 token 上限。                                                                                                 |
| `timeoutMs`          | `60000`                          | 单次尝试超时。                                                                                                              |
| `maxRetries`         | `2`                              | 瞬时错误（超时/网络/429/5xx）重试次数；0 禁用。                                                                             |
| `maxEdge`            | `1568`                           | 图片最大边长（像素），超限自动缩放；0 禁用预处理。                                                                          |
| `compressEnabled`    | `true`                           | 超大图自动缩放/重压（macOS`sips`；其他平台跳过）。                                                                        |
| `cacheEnabled`       | `true`                           | 持久内容寻址缓存（跨会话复用）。                                                                                            |
| `cacheDir`           | `$XDG_CACHE_HOME/dsh-llm-vision` | 缓存目录。                                                                                                                  |
| `cacheTtlDays`       | `30`                             | 缓存保留天数。                                                                                                              |
| `cacheMaxEntries`    | `500`                            | 缓存条数上限，超限淘汰最旧。                                                                                                |
| `renderImagePreview` | `true`                           | 附件引用原地渲染缩略图（仅影响本地显示）。                                                                                  |
| `interceptImageSend` | `true`                           | 发送时改写带图消息为附件引用；关闭则原样放行（与其他视觉插件共用时）。                                                      |

## 可靠性工程

- **自动预处理**——超过 1568px 的图片自动等比缩放、大体积重编码（JPEG q85，透明格式保留 PNG），
  基于 macOS 自带 `sips` 零依赖；任何失败静默回退原图。HEIC/HEIF 输入一律重编码为 JPEG
  （端点对 HEIC 支持参差），仅在缺少 `sips` 的平台明确报错。解决「大截图必超时」经典故障。
- **重试**——瞬时错误按 `maxRetries` 重试，指数退避（≤4s），预算等比递减（总预算 ≤ 2×超时）；
  耗尽重试的错误带「（已重试 N 次）」后缀；调用方取消立即中止、绝不重试。
- **持久缓存**——相同图片 + 模型 + 提示词 + 预处理参数命中内容寻址缓存（图片字节 SHA-256），
  存于 `~/.cache/dsh-llm-vision/`；只存文字回答、绝不存图片字节；TTL 30 天、上限 500 条、
  原子写、0600/0700 权限。注意：敏感文档的 OCR 结果会以明文存在该缓存文件里——在意时把 `cacheEnabled` 关掉。

## 安全模型

- 视觉请求与图片下载一律拒绝 HTTP 重定向（`redirect: 'error'`）——bearer 凭证与图片字节不会离开所配端点。
- 请求体携带 base64 图片但不携带密钥；解析出的凭证绝不进日志。
- 只接受 http(s) URL 与本地路径，其余协议一律拒绝。
- 附件上传先校验（严格 base64、magic bytes、字节上限）再交给附件存储；只有引用 JSON（文本）进入会话。
- 响应体先按上限截断（`maxOutputTokens × 8 + 64 KiB`）再解析；错误摘要有界（200 字符）。
- 调用工具即把图片字节外发到所配端点——只把允许外传的图片交给模型。

## 测试状态

全部离线测试（vitest、mock HTTP 服务、tmp 目录缓存）+ 严格 typecheck +
每次推送的 CI。并已在**真实 DSH Web GUI 中端到端验证**：`describe_image` 真实读图
（DashScope `qwen3-vl-plus`）、`extract_text` 真实 OCR 转录（`qwen3.5-ocr`）、
attach 上传/回读路由经真实 web 服务器工作、设置卡在插件配置页正常渲染并可
保存生效——见[配置](#配置)。

## 已知限制

- 附件/上传通道仅 PNG / JPEG / GIF / WebP（官方附件存储的类型集合）。**HEIC/HEIF 图片
  可直接经工具读取**本地路径与 URL——macOS 上预处理会重编码为 JPEG——但向 GUI 粘贴
  HEIC 文件会被拒绝并给出提示；请先转换或改传路径。Windows/Linux（无 `sips`）上读取
  HEIC/HEIF 会得到明确报错。
- 预处理依赖 macOS `sips`（零依赖）；Windows/Linux 上静默降级、原样直发——
  绝不报错，但超大图更易超时。字节边界（`maxBytes`）在加载阶段把关，
  边界过小是干净的拒绝，不会崩溃。

## 开发

```bash
pnpm typecheck   # tsc -b + vitest 程序
pnpm test        # vitest run（全部离线）
pnpm build       # tsc -b && tsdown → lib/ + lib/client.js
pnpm watch       # tsdown --watch
```

## 许可与署名

Apache-2.0。基于：deepseek-harness packages/vision/tool-describe-image
(whitelonng/dsh-plugin-describe-image, MIT)、dsh-web-ui 插件家族（Apache-2.0）与
llm_vision 设计（MIT）。见 [NOTICE](NOTICE) 与 [AGENTS.md](AGENTS.md)。
