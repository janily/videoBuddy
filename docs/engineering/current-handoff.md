# 当前工程交接（2026-10-02）

videoBuddy 已在仓库根目录开发，原 `.git`、origin、design 与交付文档保留；未 push、未生产部署、未运行付费模型。当前仍是阶段工程，C0/C1/C2 均未达到。用户已将 Vercel 方案改为完全自托管；以 [自托管架构](self-hosted-architecture.md) 和 [执行计划](self-hosted-plan.md) 为当前部署依据，原规格的产品功能、SSE、持久消息、43 风格及验收范围继续有效。

已替换 Blob/Workflow/Sandbox：生产 `FileStore` 使用 Python `fcntl` 跨进程 CAS、原子写入和持久卷；本地持久操作队列与独占 Worker 执行 Director；事件日志支撑 SSE 续流；私有产物使用短期签名下载；Docker 媒体执行器使用固定镜像 ID、无网络和资源约束。本地素材 API 验证实际字节、MIME 签名和同内容重放；Markdown 与文本层 PDF 发布不可变真实文本分析，附件消息持久归档，Director 读取原文并以实际行号/页码引文验证材料来源。独立资料 Worker 在受限容器中解析 PDF；扫描件无文本层时明确失败并解除 pending。现有“添加资料”支持 Markdown/PDF 直传、明确权利确认、失败重试、刷新恢复待发附件和空文本发送。原设计与布局未重做。

最新实际验证：Node 22.23.1，`npm ci --ignore-scripts --no-audit` 退出0；`npm test` 30文件138项通过；`npm run typecheck`、`npm run lint`、`npm run build` 均退出0；Playwright 17项通过；Python runner 3项通过。锁定依赖的固定 Docker 镜像 `sha256:75ffd41e…` 已构建，1秒中文2D/H.264最小探针、无网络、运行中停止、随机画面拒绝和容器清理测试通过；独立技术 QA 复核文件哈希、元数据及完整解码；PDF 实际上传/受限容器解析/来源发布与扫描件失败实测通过，见 [pdf-probe.json](evidence/pdf-probe.json)。原媒体探针文件仍记录上一镜像，最新镜像复测命令退出0；这不代表真实用户视频内容、声音、完整QA或风格基线完成。

离线声音增量：固定 `sha256:831c0ff8261e75468b3a6868ca29f5b3fd1eee6b222031912eff4e13071e6e64` 语音镜像在无网络、只读根目录的容器中，以两条新输入实际生成 24 kHz 中英文 WAV；独立探针验证格式、时长、SHA、非静音和同 stage 重放，见 [voice-probe.json](evidence/voice-probe.json)。增量回归：`npm test` 31文件141项、lint、typecheck、build、模型文件6项SHA校验均退出0。它尚未进行发音语义/听感、ASR、字词对齐或 48 kHz 混音，不代表 T10 完成。

主要缺项：T05 扫描 PDF、图片和音频的真实解读，超长 Markdown/PDF 的分段检索；Visual/Audio/Critic 及16行为评估；T10 的 ASR、时间轴混音及声音 QA；真实预览、审批、正式制作、独立QA与发布；修改/取消/导出完整闭环；43风格86条真实视听基线；备份恢复、安全/故障演练和5名新用户观察。图片/音频目前仅到 `uploaded`，不会被当作已分析的事实。精确现状见 [阻断记录](blockers.md) 和 [任务记录](task-ledger.md)。

下一步继续 T05 素材分析，并将真实媒体执行器接入预览与正式制作，完成音频、独立 QA 和取消清理。生产总开关默认关闭。不要把最小探针、单测、目录规则或交付原型视频当作完整媒体验收。
