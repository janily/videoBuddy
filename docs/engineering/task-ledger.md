# 开发任务与证据

> 2026-10-02 架构变更：以下早期 Vercel/Blob/Workflow/Sandbox 记录仅保留为历史证据，已由 [自托管架构](self-hosted-architecture.md) 与 [执行计划](self-hosted-plan.md) 替代，不再是待索取的凭据。当前仍按原 T00–T21 产品范围验收；C0/C1/C2 未完成。最新本地结果：`npm ci --ignore-scripts --no-audit` 退出0、`npm test` 29文件131项通过、`npm run typecheck` 退出0、`npm run lint` 退出0、`npm run build` 退出0、Playwright 14项通过、Python runner 3项通过；原交付包独立校验通过，22任务/22需求/92验收/43风格/86基线目标和60份未改设计文件均匹配。T09 最小 Docker 2D/中文探针通过，真实1秒H.264/320×180/9,249字节、无网络、运行中停止、随机画面拒绝及独立 ffprobe/全解码技术QA证据见 [media-probe.json](evidence/media-probe.json) 和首帧；完整声音、合成、语义/字幕QA、WebGL仍未通过。付费模型评估、T05 全模态分析、43风格86基线未运行。自托管存储、队列/Worker、SSE、私有下载、本地素材字节 API 已开发并各有局部测试；不能据此标整项 T05/T09/T21 完成。

唯一规格：docs/hand-off/videobuddy-v5.1。依赖按 T00–T21 执行。

Pre-flight：T01→T02 的控制态由 project CAS 发布；T02→T03 重试纯变更不放宽语义基线；T03→T04 committed 必须在归档提交后；T04→T05 pending 上传不能永久锁审批；T05→T06 来源决定 patch 授权；T06→T07 服务端 action 决定主操作；T08→T15–18 43 slug 与分类不可变；T09→T10–12 媒体隔离/统一时钟/bundleHash/fence 不可弱化；T12→T13–14 不变产物与恢复只切指针；T15–20→T21 真实证据决定支持，不允许默认通过。

Ruling：本文计划用 T00 标题，不符合技能脚本 Task N 的提取格式；按原任务标题读取并在本 ledger 留存证据，不改交付规范。
Ruling：T00-C 缺凭据不阻断后续纯本地开发；所有依赖真实服务的门槛继续 blocked。

T00：in_progress；初始化创建过程见 bootstrap-report.md，没有虚构旧测试失败。

T00-A/B：implemented/tested locally。npm ci 成功；build、typecheck 成功；T00 5个配置/design测试通过；Playwright 10通过（首次浏览器缺失、随后隐藏status的测试定位修正，均保留实际记录）；最小 Mastra 本地协议测试见 model-adapter.log。T00-C blocked；整体不是 complete。
T01：18通过，T01-red.log 为缺目标模块，T01-green.log 为实现后的实际行为；纯契约可用。
T02：9通过，本地文件测试 adapter 在 tests/，生产默认仅 Private Blob；真实冷云实例/CAS blocked。发现 local lock 早返回导致读到未初始化，修正后重跑通过。
T03：5通过，本地 claim/effect/receipt；SDK start 集成与云故障测试待做。
T04：7通过，纯解析/reducer；归档与实际 Workflow SSE route 待接入。
T05：5通过，预约/幂等/UTF8 Markdown 本地逻辑；全模态 probe/真实分析与直传端点待做，partial。
T06：6通过，纯引导/来源/patch策略；真实 Mastra评估与16行为案例未跑，partial。
当前未达到 C0/C1/C2；deployed=false。继续 T07/T08 与后续可独立任务。

Ruling：Workflow 5 实际 withWorkflow 文档/构建清单表明封装 startOperation 不被入口扫描注册；在 messages route 直接调用官方 start(directorTurnWorkflow)，仍由唯一 Workflow 编排。verify-build.ts 检查真正产物，第一次红灯清单缺应用 workflow。
Ruling：进一步定位扫描器 importSpecifierPatterns 依赖 from 后的空白；紧凑但合法的 from\' 让 SDK 5 依赖发现遗漏。统一 import 空白并以构建清单验证，先前直接 start 的改动本身仍不足，不把先前 build 算作工作流成功。

## 当前增量（2026-10-02；不是最终完成）

以下“本地通过”只代表指定用例，并不等同于整项任务验收。当前 C0/C1/C2 均未达到，deployed=false。T00–T06 旧计数是当时的阶段证据，最新结果以 current-* 日志为准。

| 任务 | 当前 implemented / tested | 尚缺的实现与验收 |
|---|---|---|
| T00 | 根目录工程、精确lockfile、Node22、真实SDK最小调用、doctor；生产构建含 Workflow 入口 | 六组真实云探针未完成；只有 Blob 探针代码，不把未实现探针都归因凭据 |
| T01 | 公共请求/SSE严格Zod、理解patch、hash/状态/预览基线；domain 18项 | ProjectControl/完整FilmSpec等尚未全量Zod化；deriveActions全状态尚缺 |
| T02 | Private Blob fresh body/ETag同响应、CAS、匿名owner、不可变归档/分块索引、容量预约；storage-access 9项、project-api 6项 | 云冷实例测试、全模态/产物存储布局、完整清理未验收 |
| T03 | durable receipt、canonical claim、effect ledger、聊天恢复端点；commands 9项、reconcile 2项 | 完整生产资源恢复/停止核实、云故障演练；reserved原请求仍可重试 |
| T04 | UTF8/SSE/游标/reducer、Workflow真实流端点、已归档回复保护、启动重连；stream 8项 | 真实跨云请求续流/流过期修复/中文长流未验收；当前Director结构化完成后发delta，并非原生token流 |
| T05 | 预约容量/幂等/UTF8 Markdown实际探测；assets 5项 | 直传端点、PDF/图片/音频探测与真实解读、完整来源UI尚未接通 |
| T06 | 真实Mastra adapter、来源授权/逐轮引导/理解patch、持久聊天Workflow；guidance 6项、model-adapter 1项 | Visual/Audio/Critic代理、16项真实行为评估、材料来源授权；context超限明确失败而非偷删事实 |
| T07 | 已确认布局、单输入、IME/草稿、聊天列表、手机标签、风格原生dialog；Playwright 14项 | 左侧目前欢迎/收集态；完整预览/制作/完成态、5条待发队列及进阶交互尚缺 |
| T08 | 43原slug/9分类/固定版本STYLE规则与哈希、搜索/知识加载；styles 6项 | 推荐策略与完整StylePack执行适配尚缺；所有公开profiles为空，能力标not_run |
| T09 | SDK Sandbox deny-all固定镜像配置、detached submit/inspect/stop、固定Python锁/marker、Chromium绝对时间截图/FFmpeg picture编码；media-executor 7项、Python 3项 | 固定镜像尚未构建/提供；可信素材传输、真实检测、跨请求stop/GL报告未跑；本机没有ffmpeg/ffprobe，未渲染真实媒体 |
| T10 | 帧/采样绝对时间、字幕边界/字形/可读时间、ASR不改原稿；audio-timeline 5项 | TTS/ASR实际provider、音乐/音效合成混音、完整AudioManifest尚缺 |
| T11 | 6–12秒excerpt映射、null转场/语义审批基线；preview 3项及domain覆盖 | 真实复合预览生产、bundleHash全链路、批准route/唯一正式启动尚缺 |
| T12 | QA blocking/not_checked门槛、证据与发布fence/hash；publish 3项 | 独立真实FFmpeg/ASR/逐帧QA、正式render workflow/原子发布尚缺 |
| T13 | 自然语言修改风险/来源/预算/撤回策略、回复取消竞态/预claim取消；changes 4项及commands覆盖 | safe-direct实际混音/字幕更新、新预览、制作取消与恢复原片尚缺 |
| T14 | 私有artifact短期授权GET route、工程导出白名单、删除立即禁访问、最近20个项目ID服务端鉴权查找；delivery 8项 | 稳定播放器/URL续期、实际ZIP/字幕导出、资源取消后清理尚缺 |
| T15 | A批16规则保留（T08验证覆盖） | 16项执行适配与32条真实横竖基线未完成 |
| T16 | B批12规则保留（T08验证覆盖） | 12项执行适配与24条真实横竖基线未完成 |
| T17 | C批10规则保留（T08验证覆盖） | 10项执行适配与20条真实横竖基线未完成 |
| T18 | D批5规则保留（T08验证覆盖） | 5项执行适配与10条真实横竖基线、实际WebGL能力报告未完成 |
| T19 | 8屏宽/单输入/IME/错误保稿/移动标签/原生风格弹窗本地浏览器证据 | 真实完整用户闭环、离线续流/200%缩放完整覆盖、5名新用户观察未完成 |
| T20 | 配置fail closed、模型CAS预算预约与零隐式重试；budget 2项 | Sandbox/TTS预算实际消费集成、反滥用配置、运维cron/清理/回滚演练、Preview部署未完成 |
| T21 | 真实状态表、43风格86基线not_run清单、启动与阻断说明 | 22需求/92验收/16行为/86风格与全部公开profile未验收；不能宣称C2 |

模型预算是保守预约上界：输入按UTF8字节数+4096开销预留、输出2000tokens硬上限；daily先预约，project失败时不自动返还，未知计费不会重试。该行为可少用预算，不会放宽上限。媒体/TTS尚未接入收费入口，不能声称这两类预算已运行。

审查修复：hot128 receipt淘汰仍按durable accepted重放；完成归档不得被空interrupted覆盖；SSE OPERATION_NOT_STARTED重试并可显式恢复；cancel在CAS内校验通道/终态，未claim取消立即终结；真实失败run可恢复为interrupted，unknown保留占用；用户新消息刷新30天activity期限。测试fixtures只用于本地测试，不进入生产返回值。
