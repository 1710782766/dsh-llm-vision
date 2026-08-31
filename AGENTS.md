# AGENTS.md — dsh-llm-vision 项目规范

本文件是给 AI agent（及人类贡献者）的项目约定。**上线级质量是本项目的硬要求**，不接受粗糙实现。

## 项目定位

DeepSeek Harness 插件：给纯文本模型提供可靠视觉 + OCR。差异化一句话：**"The vision plugin that doesn't
hallucinate on screenshots"**——critical 审视视角（实测沉淀）+ 可靠性工程
（预处理 / 重试 / 持久缓存）+ DSH 原生体验（粘贴桥 / 设置卡 / URL / 附件引用）。

## 错误行为协议（错误即接口）

1. **前缀稳定可 grep**：所有抛出的 Error 消息以 "llm-vision: " 开头。测试逐条断言这些
   前缀；改动文案必须同步测试。
2. **失败=抛出（isError），领域结果=规范 JSON**：基础设施/校验失败 throw；成功的领域
   结果写进 output.schema 规范值（{ text, model, image, mimeType, bytes }），渲染
   层负责人类可读内容。绝不返回"错误字符串冒充成功"。
3. **错误信息有界**：端点错误摘录 ≤ 200 字符；响应体按 maxOutputTokens*8+64KiB 截断
   后再解析；密钥绝不进错误/日志。
4. **瞬时错误才重试**：超时 / 网络 / HTTP 429、5xx 按 maxRetries 重试（退避
   min(2^i, 4s)，预算递减 ≤ 2×timeout）；调用方取消（AbortError）立即中止不重试；
   4xx 与解析错误直接失败。耗尽重试的错误带"（已重试 N 次）"后缀。
5. **预处理与缓存绝不破坏调用链**：preprocess/cache 任何失败静默降级为原图/未命中。

## 架构

    src/index.ts（注册 describe_image[normal|critical，单图 image / 批量 images ≤ 8] +
      extract_text + llm_vision_check 诊断，共 runVision 管线）
      → config-resolve.ts（Config schemastery schema = 设置卡 schema；resolveConfig
        每次调用时展开：显式字段 > provider 预设 > 内置默认；apiKey 解析链）
      → presets.ts          **预设数据唯一源**（ProviderId/PROVIDER_IDS/PROVIDER_PRESETS/
                            DEFAULT_VISION_MODEL/DEFAULT_OCR_MODEL，零依赖纯数据）——
                            host 与 client 半共用；任何地方出现第二份拷贝都是 review 失败
      → settings 接线：apply 里 ctx.inject(['settings']) 后
        settingsCtx.settings.installSection(ctx, LLM_VISION_SETTINGS_NAMESPACE, Config,
        config, { setSource, validate })（dsh ≥ 0.1.2-alpha.1 服务 API，官方 cookbook
        同款）—— 设置卡保存的 user 层覆盖 entry（base 层），无 settings 服务时回退
        entry；配置权威来源 = GUI 设置卡
      → cache.ts            PersistentAnswerCache：内容寻址（图片字节 SHA-256，单图 key
                             格式锁定 v1——存量缓存跨版本命中；多图 key 用 digest 列表），
                             TTL 30d，上限 500 条，原子写，0600/0700，跨会话
      → vision-client.ts    loadImage（路径/URL/附件引用，magic bytes，10MB 上限，拒重定向，
                             stat/readFile 错误一律包 "llm-vision: " 前缀）
                            → preprocess.ts（超 1568px 缩放 / 超 1.5MB 重压，macOS sips 零依赖，
                              失败静默降级；HEIC/HEIF 无条件重编码 JPEG——"转出更大"保护
                              不适用于 HEIF——无 sips 平台明确报错；runner 可注入供离线测试）
                            → callVision（双协议 chat-completions/responses，多图 content
                              数组，重试/退避）
      → health.ts           runHealthCheck：apiKey 解析 + GET /models 探测（401/404/网络分类）
                            + 可选 testCall 64×64 探针图端到端（不得改回 1×1——
                            qwen3-vl-plus 拒绝最小尺寸输入，有防回归测试钉住）；
                            报告为领域 JSON，绝不 throw
      → attach-routes.ts    /llm-vision/attach 上传路由 + /llm-vision/raw 回读（内容寻址 id；
                            body cap 随 maxBytes 动态放大；附件通道仅收官方 4 类媒体，
                            HEIC/HEIF 上传明确拒绝并提示走路径）
      → client/（browser 半）发送改写为引用、会话内缩略图、设置卡
        （slots 'settings.plugin.item' 注册必须用 key = LLM_VISION_SETTINGS_NAMESPACE
        ——keyed slot 按 key 分发，id 永不渲染；SETTINGS_CARD_KEY 常量钉住一致性）

- 工具恒返回字符串成功 / 抛错失败，图片字节永不进会话记录
- mountOnce('dsh-llm-vision', …) 防重复挂载；工具注册基于副作用，卸载自动注销
- client 半的 DOM 接线失败只记日志绝不抛（壳会因插件 apply 抛错而整体启动失败）

## 配置纪律（改默认值需同步 5 处）

配置默认值同时出现在：presets.ts 或 config-resolve.ts 的 DEFAULT_* 常量、Config
schema（注意：model/ocrModel/apiKeyEnv 故意无 schema 默认——有默认会抢在 provider
预设展开之前，预设开关就失效了，有回归测试钉住）、tests/ 相关断言、README ×2
的配置表、本文件。只改一处会静默漂移（此前踩过的坑，不许重犯）。所有"部署间
可能不同的旋钮"必须是配置字段，不得硬编码。预设数据只在 src/presets.ts 一份。

## 设置卡契约（不许再犯的坑）

- host 半通过 ctx.settings.installSection 注册 namespace；client 卡片注册进
  `settings.plugin.item` 必须带 `key`（keyed slot 的分发键），且 key 必须等于
  namespace 字符串——`id` 不会被分发，卡片会静默不渲染（v0.3.0 修复的历史断点）
- harness 的 settings 服务对第三方 namespace 无白名单：describe() 全量返回注册项；
  "allowlisted settings namespaces"是错误结论（源于对 cordis-host-runner 沙箱 guard
  的误读——那是会话级动态插件机制，与 bundle 静态加载无关），文档不得再写

## 测试纪律

- 全部测试离线（fetch 用 mock server；backoff 用 vi.mock 跳过等待；持久缓存用 tmp 目录）
- 测试移植自既有实现的 spec（工具 / 设置 / 路由 / 组合 / 缓存 / client 等）与更早前身的
  用例设计（错误前缀、边界、TOCTOU、重试预算）
- 新增能力必须带测试；错误文案断言前缀，不断言完整文案

## 安全 / 隐私

- API key：内联 apiKey（schema role('secret')）→ 凭证服务 apiKeyEnv（默认
  VISION_API_KEY）→ 启动环境，逐级回退；绝不写进 cordis.patch.yml 或代码
- 视觉请求与图片下载一律 redirect: 'error'；仅接受 http(s) 与本地路径
- 调用工具即把图片字节外发到所配端点——README 明示，仅外传允许外传的图

## 常用命令

    pnpm typecheck          # tsc -b + vitest 程序
    pnpm test               # vitest run（离线）
    pnpm build              # tsc -b && tsdown（lib/ + lib/client.js）
    pnpm watch              # tsdown --watch

## 署名与许可（法律义务）

主体代码移植自 whitelonng/dsh-plugin-describe-image（MIT，源自 deepseek-ai
deepseek-harness）与 zhu1090093659/dsh-web-ui（Apache-2.0）；llm_vision（MIT）贡献
提示词与可靠性设计。Apache-2.0 许可 + NOTICE 署名已就位；**新增的移植/借鉴代码必须
保持文件头来源注释与 NOTICE 更新**。

## GitHub 识别与发布规范

**GitHub 侧（识别为 dsh 插件的关键，改 topics/description 必须保持）**：
- topics 必含 `dsh-plugin`（市场/榜单/awesome 列表全靠它自动抓取），并保持
  `deepseek-harness`、`dsh`、`vision`、`ocr` 等生态相关标签
- description 保持一句定位话（英文）：给文本模型可靠视觉 + OCR 的 DSH 插件

**发布检查清单（npm publish 前逐项过）**：
1. `pnpm typecheck && pnpm test && pnpm build` 全绿；CI（.github/workflows/ci.yml）通过
2. `pnpm pack` 产物含 lib/（node 半 + lib/client.js）与 cordis.patch.yml
3. 版本号与 git tag 同步；README 状态行从"未发布"更新为发布版本
4. **同步更新安装钉扎版本**：README ×2 Install 主命令、cordis.patch.yml 头注释里的
   `dsh-llm-vision@<version>` 一并改到新版本（pnpm 11 暂缓 24h 内新发布，装 latest
   会拿到旧版；漏改一处用户就会装到上一版）
5. 发布后立即验证：`dsh plugin --profile web add dsh-llm-vision@<version>` 安装成功 + bundle 层生效
6. 记得给 GitHub Release 附变更摘要（git tag + 说明）

**安装路径事实（写文档/注释时不许再写错）**：
- `dsh plugin add <name>` 是 pnpm 转发器，按包名从 npm registry 解析——未发布时
  **必然失败**；当前可用路径是 `pnpm pack` tarball 或本地 checkout（先 build，lib 不入库）
- git 直装需要 prepare 脚本 + 用户 allowBuilds（未提供时文档不得写 git 直装方式）

