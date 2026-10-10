# 画布 × 视频助手：实现与验收记录

对应 `canvas-assistant-ux.md` v1.0，开发分支 `feat/canvas-assistant-ux`。

## 已实现

- M1：累积式想法、画风、脚本、成片卡片；原位规格和画风选择；最近项目下拉与独立列表页；移除原有弹窗；助手推荐、快捷回复、画布定位随消息归档。
- M2：画风确定后的独立脚本任务，3 秒合并窗口；草稿和正式生成共用 treatment 缓存；按镜头发布真实绘制/草图/片段状态；私有媒体访问；移动端更新提示和迷你进度；持久化聊天里程碑。
- M3 代码：单镜播放、无模型规格直写、43 种画风样片批处理工具、最近 20 次步骤耗时中位数、事件记录与 `/video/metrics` 看板、统一错误文案。
- 并发与恢复：画布操作原文归档、幂等重试、快速连续改稿保留上一版、生成中反馈用于下一版、历史成片恢复、旧数据和 `VIDEO_FLOW=staged` 兼容。

## 明确的运行行为

- 生成仍需用户明确点击。自动脚本只执行构思，不开始绘图或成片。
- 生产期间可以提交聊天修改。绘图模型占用全局计费锁时，先持久化请求，进入渲染阶段后再处理助手回复；不会并行开启第二个模型调用。
- 有结构化补丁的下一版修改在当前制作结束后应用；缺少具体修改内容时明确提示澄清，并阻止把未落实的意见误当作新脚本生成。
- 时长、比例的直接修改在任务繁忙时禁用/拒绝；用户仍可通过聊天提交下一版需求。成片后的规格修改保留旧成片，并允许再次生成。
- 配乐与单镜重画的设置、用户消息、助手确认一次性提交；同一命令重试不会重复增加重画次数。
- 看板只展示当前身份实际采集的有界数据，不存聊天文本。客户端计时不能替代真实端到端 SLA；24 小时首片完成率、总耗时、对话轮数和流失率需补充完整服务端生命周期数据后再统计。

## 部署要求

使用仓库要求的 Node 22。新增存储字段均为可选字段，无数据库迁移；更新 Web 与 worker 后重启两者。

镜头草图依赖更新后的媒体镜像。重新构建并更新环境中的不可变镜像标识：

```sh
docker build -t videobuddy-media:local -f runtime/media/Dockerfile runtime/media
docker image inspect --format '{{.Id}}' videobuddy-media:local
```

将返回的 `sha256:…` 设置为 `VIDEO_MEDIA_IMAGE_REF`，其十六进制部分设置为 `VIDEO_MEDIA_RUNTIME_DIGEST`。旧镜像仍可生成片段，但不会产出新增的中间帧海报。

## 样片与真实环境验收

批处理默认仅输出计划，不调用付费模型：

```sh
npx tsx scripts/video/style-samples.ts
npx tsx scripts/video/style-samples.ts --execute --styles=watercolor --output=public/style-samples
npx tsx scripts/video/style-samples.ts --execute --output=public/style-samples
```

执行模式需要正常的模型、预算和 Docker 配置，复用缓存并纳入预算记账。每种画风输出 JPG、6 秒 MP4 和待人工审核的 review JSON；素材含 AI 标识。

本次未执行真实付费模型/Docker 出片与 43 种样片批量生成。样片缺失时界面使用明确的静态替代展示。以下验收仍需在部署环境实测：脚本 15 秒内可见、生成期间任意 10 秒内有真实内容变化、规格修改 500ms 内生效、所有样片视觉质量及移动设备视频播放。自动化测试证明缓存复用与状态正确性，不代表这些时延已经达标。

## 自动化验证

本次验证结果：

- Lint、TypeScript 类型检查、生产构建通过。
- 62 项 Playwright 浏览器测试全部通过。
- 完整单元回归覆盖 170 个文件、851 项测试：849 项通过，旧有内容评审传输与语音测试各有一项触发 15 秒超时。随后串行重跑这两个完整测试文件，7 项全部通过，未修改其断言或超时阈值。
- 样片工具 dry-run 覆盖全部 43 种画风；真实模型与媒体运行验收未执行。
- 独立代码审查发现的任务并发、未落实反馈、重试与历史版本问题均已修复并补回归。

验证命令：

```sh
npm run lint
npm run typecheck
npm test -- --maxWorkers=2
npm run test:video:e2e
npm run build
npx vitest run tests/video/content-critic-transport.test.ts tests/video/voice-stage.test.ts --maxWorkers=1
```

浏览器覆盖桌面与 390px 移动端完整旅程、无弹窗、刷新恢复、脚本事件、保留输入草稿、历史结果、失败重试与待澄清修改。本次运行使用 Chromium 153 的独立可执行文件；测试配置覆盖仅位于临时目录，未修改仓库的默认 Playwright 配置。
