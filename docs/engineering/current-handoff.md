# 当前工程交接（2026-10-02）

videoBuddy 已在仓库根目录开发，原 `.git`、origin、design 与交付文档保留；未 push、未生产部署、未运行付费模型。当前仍是阶段工程，C0/C1/C2 均未达到。用户已将 Vercel 方案改为完全自托管；以 [自托管架构](self-hosted-architecture.md) 和 [执行计划](self-hosted-plan.md) 为当前部署依据，原规格的产品功能、SSE、持久消息、43 风格及验收范围继续有效。

已替换 Blob/Workflow/Sandbox：生产 `FileStore` 使用 Python `fcntl` 跨进程 CAS、原子写入和持久卷；本地持久操作队列与独占 Worker 执行 Director；事件日志支撑 SSE 续流；私有产物使用短期签名下载；Docker 媒体执行器使用固定镜像 ID、无网络和资源约束。新增本地素材预约、字节上传与完成 API，验证 MIME 签名和同内容重放。原设计与布局未重做。

最新实际验证：Node 22.23.1，`npm ci --ignore-scripts --no-audit` 退出0；`npm test` 29文件131项通过；`npm run typecheck`、`npm run lint`、`npm run build` 均退出0；Playwright 14项通过；Python runner 3项通过。旧 Workflow SDK 留下的未跟踪生成路由曾使构建失败，确认非用户文件后已清理，重建通过。固定 Docker 镜像已构建，1秒中文2D/H.264最小探针、无网络、运行中停止、随机画面拒绝和容器清理测试通过；独立技术 QA 复核文件哈希、元数据及完整解码；见 evidence/media-probe.json 与 media-probe-frame.png。这不代表真实用户内容、声音、完整QA或风格基线完成。

主要缺项：T05 图片/PDF/音频真实解读和来源进入聊天；Visual/Audio/Critic 及16行为评估；TTS/ASR、时间轴混音、真实预览、审批、正式制作、独立QA与发布；修改/取消/导出完整闭环；43风格86条真实视听基线；备份恢复、安全/故障演练和5名新用户观察。只上传的素材保持 `uploaded` 和 pending，当前不会被当作已分析的事实。精确现状见 [阻断记录](blockers.md) 和 [任务记录](task-ledger.md)。

下一步继续 T05 素材分析，并将真实媒体执行器接入预览与正式制作，完成音频、独立 QA 和取消清理。生产总开关默认关闭。不要把最小探针、单测、目录规则或交付原型视频当作完整媒体验收。
