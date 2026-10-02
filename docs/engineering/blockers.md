# 实际阻断（2026-10-02）

未运行付费模型/云资源，未部署或 push。缺配置时 fail closed；没有以 mock 充当生产结果。

| 项目 | 必须配置/授权 | 当前结果 | 后续命令 |
|---|---|---|---|
| T00-C Blob 初建/CAS | BLOB_READ_WRITE_TOKEN、VIDEO_ENVIRONMENT、RUN_VIDEO_CLOUD_TESTS=1 | blocked，未执行真实竞争 | npm run test:video:cloud |
| T00-C Workflow claim/续流 | Vercel Preview 项目、VIDEO_PROBE_BASE_URL、VIDEO_CRON_SECRET、测试消耗授权 | blocked，未部署探针 | 待接入端点后执行 probe；当前没有冒称通过的脚本 |
| T00-C Sandbox detached/stop | VERCEL_PROJECT_ID、VERCEL_TEAM_ID、VERCEL_TOKEN 或平台 OIDC、固定媒体镜像 | blocked | 待 executor/probe 接入 |
| T00-C 字体/音频/2D/3D | VIDEO_SANDBOX_IMAGE_REF、VIDEO_SANDBOX_RUNTIME_DIGEST、TTS/ASR 许可与模型配置 | blocked | npm run test:video:styles（当前明确退出 2，不伪报运行） |
| Director 真实评估 | MODEL_PROVIDER、MODEL_BASE_URL、MODEL_API_KEY、VIDEO_DIRECTOR_MODEL；RUN_VIDEO_MODEL_TESTS=1 及消耗授权 | blocked | 待真实评估入口 |
| 公网生成 | 全部 VIDEO_PROJECT_MAX_* / VIDEO_DAILY_MAX_* 正整数、匿名签名 key、namespace、平台反滥用保护、总开关授权 | blocked，默认关闭 | 配置后 doctor 与 Preview 验收 |
| 43 风格86基线 | 完整可执行媒体环境、真实新主题与人工视听证据 | not_run，全部仍在交付范围 | 风格适配后逐项测试 |
| T19 5名新用户观察 | 实际人员与可用服务 | not_run | 真实任务观察，不能用自动浏览器替代 |
| T20 Preview验收 | 项目负责人选择云项目与消耗授权 | not_run | 不自动 Production 部署 |

精确缺项由 evidence/T00-doctor.json 记录，只输出配置名称，绝不输出值。付费测试授权与凭据须同时具备；当前不依据连接器的存在推定可以收费。
