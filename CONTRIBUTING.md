# Contributing to dsh-llm-vision

欢迎贡献！本项目遵循 [AGENTS.md](AGENTS.md) 的上线级质量约定与 Apache-2.0 许可。
参与即表示你同意你的贡献按 Apache-2.0 授权。

## 提交 Issue

- **Bug 报告**：附上复现步骤、期望行为、实际行为、相关配置（端点样式、模型、
  预处理/缓存开关）与错误原文（以 `llm-vision: ` 开头）。
- **功能请求**：说明使用场景与期望的工具行为。
- 安全相关问题：不要公开提交——在 GitHub 上私信维护者或直接开一个标记
  `security` 的 issue 说明。

## 开发流程

```bash
pnpm install
pnpm typecheck   # tsc -b + vitest 程序
pnpm test        # vitest run（全部离线：mock server / tmp 目录）
pnpm build       # tsc -b && tsdown → lib/ + lib/client.js
pnpm watch       # tsdown --watch（client 半热更）
```

### 提交约定

- Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` /
  `build:` / `chore:`。
- 一个提交一件事；独立改动拆开提交。
- 未暂存改动存在时禁用 `git add -A`——显式路径 add（防止误带入无关改动）。
- 新增能力必须带测试；错误文案断言 `llm-vision: ` 前缀，不断言完整文案。
- 改动配置默认值必须同步 5 处（config-resolve.ts 常量与 schema、tests、
  README ×2 配置表、AGENTS.md）——只改一处会静默漂移。
- 移植/借鉴任何代码必须保留文件头来源注释并更新 [NOTICE](NOTICE)。

## 本地验证安装（未发布阶段）

```sh
pnpm install && pnpm build && pnpm pack
dsh plugin --profile web add ./dsh-llm-vision-0.1.0.tgz
```

卸载：`dsh plugin --profile web remove dsh-llm-vision`。

## 发布流程（维护者）

1. `pnpm typecheck && pnpm test && pnpm build` 全绿。
2. 更新 `package.json` 版本号，提交并打 tag（`git tag v0.1.0`）。
3. `npm publish`（需 npm 账号登录；发布前确认包名可用、README 状态行已更新）。
4. 创建 GitHub Release，附变更摘要。
