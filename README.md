# videoBuddy

VideoBuddy 把聊天中的创作需求变成视频：确认主题与画风、生成脚本、绘制镜头、生成完整视频，在画布上查看进度并下载 MP4 或海报。可以换配乐或只重画某个镜头。

当前技术方向以 [RUNTIME_PLAN](docs/engineering/RUNTIME_PLAN.md) 的 D1–D3 为准：quick 单一路径、本地 Chromium + FFmpeg、单台 Linux 主机部署。旧审批出片、旁白和语音识别已下线。存量待审批项目需要先运行迁移脚本，详情见部署文档。

## 开发

使用 `.nvmrc` 固定的 Node 22：

```sh
nvm use
npm ci
npx playwright install chromium
cp .env.local.example .env.local
npm run dev
```

系统需要 FFmpeg/ffprobe 6 或更高版本；Python 3 仅用于现有文件存储锁。字体已固定并随仓库提供。打开 http://localhost:3000/video，补齐模型、预算、会话签名和持久磁盘配置后，另行运行 `npm run worker` 与 `npm run worker:sources`。已有本机配置可使用 `npm run dev:mvp`、`npm run worker:mvp`。

渲染默认开启 Chromium 沙箱，生产环境通过独立渲染用户和 `npm run worker:render` 运行。仅开发时可显式设置 `VIDEO_UNSAFE_NO_SANDBOX=1`，界面会显示红色提示；生产环境拒绝此设置。部署步骤和权限隔离见 [部署文档](deploy/README.md)。当前重构不提供 Vercel 的持久存储和渲染工作流。

支持 Markdown、带文本层的 PDF 及图片分析；不接受音频上传。PDF 在有限时、限内存的独立线程中解析。曲库设置见 [quick 流程](docs/engineering/QUICK_FLOW.md)。

## 验证

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:video:e2e
npm run doctor
```

默认测试不调用付费模型。实际基准结果及尚未达到的门槛记录在 [性能证据目录](docs/engineering/evidence/runtime-bench/)，生产主机的沙箱和服务限额须由目标主机的 doctor 与 systemd 检查确认。历史 MVP 验收记录不代表本次重构已通过上线门槛。
