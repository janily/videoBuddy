# videoBuddy

当前先交付可用MVP：文字需求 → 真实预览 → 一次确认 → 视频下载 → 聊天修改。开发顺序与当前阻断见 [MVP优先计划](docs/engineering/MVP_FIRST.md)；43风格完整交付保留为后续阶段。

VideoBuddy v5.1 应用，直接初始化于本仓库根目录。开发基线为 [CODEX_START_HERE](docs/hand-off/videobuddy-v5.1/CODEX_START_HERE.md)，原视觉参照与文档保留。

当前已通过正常页面预览和批准，真实20秒1080p正式影片已发布，15项MVP必需质量检查全部通过。首片浏览器下载已通过；修改版的正确标题预览已通过，但正式检查发现结尾标题动画漏字，未发布新版；具体状态见 [MVP验收记录](docs/engineering/MVP_DELIVERY.md)。没有数据库、登录或固定回复/示例视频；通用示例配置默认关闭真实生成。当前部署方向是单机自托管，见 [架构](docs/engineering/self-hosted-architecture.md) 和 [执行计划](docs/engineering/self-hosted-plan.md)。具体进度和缺项见 [任务记录](docs/engineering/task-ledger.md)。

Linux 服务模板和部署前检查见 [自托管部署草案](deploy/README.md)；仓库中的模板尚未被用于生产部署。

本机已配置真实服务，按 [MVP本机启动说明](docs/engineering/MVP_LOCAL_RUN.md) 分别运行 `npm run dev:mvp` 和 `npm run worker:mvp`，无需Blob/Sandbox账号。

在新机器配置开发环境，使用 Node 22.23.1（`.nvmrc`）：

```sh
nvm use
npm ci
cp .env.local.example .env.local
npm run dev
```

打开 http://localhost:3000/video。缺服务配置时界面保留草稿并显示实际错误。Markdown 在上传完成时解析；文本层 PDF 需要单独运行 `npm run worker:sources` 和已固定的本地 Docker 镜像。扫描 PDF、图片和音频仍缺真实视觉或语音分析。不要将 `VIDEO_GENERATION_ENABLED` 打开视为验收通过；聊天和媒体工作流需要真实模型、固定的Docker运行时与Worker；是否验收通过以实际闭环证据为准。

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:video:e2e
python3 -m unittest discover -s runtime/media -p 'test_*.py'
npm run doctor
```

默认测试不调用付费服务。开发机可运行 `docker build -t videobuddy-media:local -f runtime/media/Dockerfile runtime/media` 构建本地媒体镜像。将 `docker image inspect --format '{{.Id}}' videobuddy-media:local` 得到的不可变镜像 ID 填入 `VIDEO_MEDIA_IMAGE_REF`，并把 ID 的 64 位十六进制部分填入 `VIDEO_MEDIA_RUNTIME_DIGEST`，再运行 `npm run probe:video:media` 与 `npm run probe:video:pdf`。这两个探针只证明最小媒体链路和文本 PDF 读取；`test:video:styles` 当前明确返回阻断，不能把43份风格规则当作43种已运行风格。86条真实视听基线尚未运行。

当前未部署，未推送远程；`.git` 和 origin 保持原样。
