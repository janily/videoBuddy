# videoBuddy

VideoBuddy v5.1 应用，直接初始化于本仓库根目录。开发基线为 [CODEX_START_HERE](docs/hand-off/videobuddy-v5.1/CODEX_START_HERE.md)，原视觉参照与文档保留。

当前是**未完成的工程实现**，不是已验收的视频生成产品。没有数据库、登录或固定回复/示例视频；真实生成默认关闭。当前部署方向是单机自托管，见 [架构](docs/engineering/self-hosted-architecture.md) 和 [执行计划](docs/engineering/self-hosted-plan.md)。具体进度和缺项见 [任务记录](docs/engineering/task-ledger.md)。

Linux 服务模板和部署前检查见 [自托管部署草案](deploy/README.md)；仓库中的模板尚未被用于生产部署。

使用 Node 22.23.1（`.nvmrc`）：

```sh
nvm use
npm ci
cp .env.local.example .env.local
npm run dev
```

打开 http://localhost:3000/video。缺服务配置时界面保留草稿并显示实际错误。不要将 `VIDEO_GENERATION_ENABLED` 打开视为验收通过；现有模型聊天需要真实配置，素材分析和完整媒体工作流尚未接通。

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:video:e2e
python3 -m unittest discover -s runtime/media -p 'test_*.py'
npm run doctor
```

默认测试不调用付费服务。开发机可运行 `docker build -t videobuddy-media:local -f runtime/media/Dockerfile runtime/media` 构建本地媒体镜像。将 `docker image inspect --format '{{.Id}}' videobuddy-media:local` 得到的不可变镜像 ID 填入 `VIDEO_MEDIA_IMAGE_REF`，并把 ID 的 64 位十六进制部分填入 `VIDEO_MEDIA_RUNTIME_DIGEST`，再运行 `npm run probe:video:media`。该探针只证明最小浏览器和编码链路；`test:video:styles` 当前明确返回阻断，不能把43份风格规则当作43种已运行风格。86条真实视听基线尚未运行。

当前未部署，未推送远程；`.git` 和 origin 保持原样。
