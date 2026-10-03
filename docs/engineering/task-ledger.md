# 开发任务与证据

> 2026-10-02 架构变更：以下早期 Vercel/Blob/Workflow/Sandbox 记录仅保留为历史证据，已由 [自托管架构](self-hosted-architecture.md) 与 [执行计划](self-hosted-plan.md) 替代，不再是待索取的凭据。当前仍按原 T00–T21 产品范围验收；C0/C1/C2 未完成。当时本地结果：`npm ci --ignore-scripts --no-audit` 退出0、`npm test` 36文件158项通过、`npm run typecheck` 退出0、`npm run lint` 退出0、`npm run build` 退出0、Playwright 17项此前通过、Python runner 3项通过；原交付包独立校验通过，22任务/22需求/92验收/43风格/86基线目标和60份未改设计文件均匹配。T09 最小 Docker 2D/中文探针通过，真实1秒H.264/320×180/9,249字节、无网络、运行中停止、随机画面拒绝及独立 ffprobe/全解码技术QA证据见 [media-probe.json](evidence/media-probe.json) 和首帧；随后真实语音、字幕与20秒技术合成证据见文末增量记录。付费模型评估、T05 全模态分析、43风格86基线未运行。自托管存储、队列/Worker、SSE、私有下载、本地素材字节 API 与 Markdown/文本 PDF 解析及附件消息已开发并各有局部测试；不能据此标整项 T05/T09/T21 完成。

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
| T05 | 预约容量/幂等/UTF8 Markdown探测、本地直传及完成 API；Markdown/文本 PDF 不可变原文、ready、消息附件、行号/页码引文验证；受限容器 PDF 探针与扫描件失败解除 pending 实测通过；明确语音用途的0.2–120秒分段ASR与时间引用接通，56.525秒多句测试通过、52秒机械重复漏识别被拒 | 扫描 PDF/图片视觉解读、配乐/环境声、真实用户长音频听验与超长资料分段检索和全模态验收尚未接通 |
| T06 | 真实Mastra adapter、来源授权/逐轮引导/理解patch、持久聊天Workflow；guidance 6项、model-adapter 1项 | Visual/Audio/Critic代理、16项真实行为评估、材料来源授权；context超限明确失败而非偷删事实 |
| T07 | 已确认布局、单输入、IME/草稿、聊天列表、手机标签、风格原生dialog；Playwright 14项 | 左侧目前欢迎/收集态；完整预览/制作/完成态、5条待发队列及进阶交互尚缺 |
| T08 | 43原slug/9分类/固定版本STYLE规则与哈希、搜索/知识加载；styles 6项 | 推荐策略与完整StylePack执行适配尚缺；所有公开profiles为空，能力标not_run |
| T09 | SDK Sandbox deny-all固定镜像配置、detached submit/inspect/stop、固定Python锁/marker、Chromium绝对时间截图/FFmpeg picture编码；media-executor 7项、Python 3项 | 固定镜像尚未构建/提供；可信素材传输、真实检测、跨请求stop/GL报告未跑；本机没有ffmpeg/ffprobe，未渲染真实媒体 |
| T10 | 帧/采样绝对时间、真实离线TTS/ASR、按字词时间编译SRT、真实字体字形、48 kHz旁白轨和AAC/H.264技术合成；见文末探针 | 音乐/音效及其响度母带、长篇/复杂混音的最终ASR与听验、字幕视觉全尺寸QA和完整AudioManifest尚缺 |
| T11 | 6–12秒excerpt映射、null转场/语义审批基线、可复用技术合成器；preview 3项及domain覆盖 | 真实复合预览生产、bundleHash全链路、批准route/唯一正式启动尚缺 |
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

模型预算是保守预约上界：输入按UTF8字节数+4096开销预留、输出2000tokens请求上限（2026-10-03实测当前提供方不执行该限制，不能视为硬上限）；daily先预约，project失败时不自动返还，未知计费不会重试。预约与零隐式重试保守限制调用次数；当前提供方的实际输出token可能超过预约，不具备硬token费用上限。媒体/TTS尚未接入收费入口，不能声称这两类预算已运行。

审查修复：hot128 receipt淘汰仍按durable accepted重放；完成归档不得被空interrupted覆盖；SSE OPERATION_NOT_STARTED重试并可显式恢复；cancel在CAS内校验通道/终态，未claim取消立即终结；真实失败run可恢复为interrupted，unknown保留占用；用户新消息刷新30天activity期限。测试fixtures只用于本地测试，不进入生产返回值。

2026-10-02 T05 增量：固定 `sha256:75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919` 镜像内 PDF.js 6.3.289 实际文本层读取；[pdf-probe.json](evidence/pdf-probe.json) 记录真实13,446字节中文PDF提取上海事实、1页、ready、briefVersion=1、pending=false，另有图片扫描PDF实际失败为 `PDF_TEXT_UNAVAILABLE`、pending=false。新镜像最小媒体探针复测通过；`npm test` 30文件138项、Playwright 17项、lint/typecheck/build均通过。此证据不代表扫描件OCR、模型事实质量或视频闭环通过。

2026-10-02 T10 声音增量：`@uzen/kokoro-js@1.2.4` 与精确 ONNX 模型/voice SHA 构建本地镜像 `sha256:831c0ff8261e75468b3a6868ca29f5b3fd1eee6b222031912eff4e13071e6e64`。受限无网容器用全新上海活动文案生成中文 4.1 秒、英文 3.7 秒 24 kHz 单声道 float WAV，独立检查真实时长、电平、SHA、重放，见 [voice-probe.json](evidence/voice-probe.json)。`tests/video/voice-runtime.test.ts` 3项通过；完整 `npm test` 31文件141项、lint、typecheck、build均通过，模型6项SHA复核通过。未做 ASR/字词时间戳、发音听验、48 kHz 混音或成片，T10仍 partial。

2026-10-02 T10 时间轴增量：`prepareNarration` 严格区分显示文字/发声文字/ASR期待文本，用真实 WAV 时长拒绝超出预留时段，空旁白可表达明确静音；`buildNarrationTrack` 在固定无网媒体镜像中用 FFmpeg 48 kHz 精确采样偏移合成旁白轨。实测 20 秒 960,000 采样；0–0.8秒、5.5–7.5秒、12.5–19秒 RMS 为零，中文/英文窗口分别为0.066/0.042；独立空旁白轨为纯静音，同stage重放哈希相同。见更新的 [voice-probe.json](evidence/voice-probe.json)。`npm test` 33文件147项、typecheck、lint、build均退出0。音乐/音效、响度、ASR、字词时间戳、听验及成片仍未完成；T10仍 partial。

2026-10-02 T10 ASR增量：锁定 `Systran/faster-whisper-small@2ec96c5` 及 Python 依赖、固定无网只读镜像 `sha256:c0238dfb63f981905ddd4a13d1658fc5e2915d339bc1ad25036fd2ca79ba5fa4`。识别容器只收实际 WAV 与语言，不收期望台词；`verifyNarration` 将识别结果和词时间与原始计划核对，日期数字做窄范围等值归一化，实测错误的10月9日被拒绝。中文12个、英文5个词级时间及实际识别文案见 [asr-probe.json](evidence/asr-probe.json)。探针首轮曾真实 `ASR_MISMATCH` 退出1，下一轮通过，显示 TTS/ASR 波动；没有偷偷调整原稿。`npm test` 34文件151项、lint、build、Python语法、顺序typecheck均通过（并发build/typecheck曾因`.next/types`竞态短暂失败，顺序复跑通过）。成片混音后ASR当时尚缺；特殊专名、听验和自动修复策略仍缺，T10不标完成。

2026-10-02 T10/T11技术合成增量：真实ASR证据生成两条SRT字幕；媒体镜像内 Noto Sans CJK SC 字形表实际44,810字符、SHA见 [subtitle-probe.json](evidence/subtitle-probe.json)。字幕编译器按实测发声+0.6秒/阅读速度取较长值并量化到帧，时间冲突直接失败。`composeVideo`实际连接画面、48 kHz旁白、烧录字幕及AAC音轨；最新20秒320×180/24fps场景输出141,704字节，另有38,001字节无旁白纯静音成片，两者均经固定镜像独立ffprobe与全片解码通过，见 [composition-probe.json](evidence/composition-probe.json) 和三个实际抽帧。媒体QA新增AAC/48 kHz检查；`npm test` 36文件158项、lint/build/顺序typecheck通过。此场景为确定性技术验证，不是模型生成用户内容、1080p正式影片或43风格基线；当时未做响度、最终音轨ASR/听验、真实预览审批/发布，T10/T11仍partial。

2026-10-02 T10成片复核增量：真实20秒AAC/H.264技术场景中提取两条音频窗口，离线ASR再次识别中文“上海的活动将在10月8日开始。”12词、英文“The event starts in Shanghai.”5词，均与原始期望核对通过；不读期望文案的识别容器和原始计划哈希/文本防篡改门槛保持。无旁白成片全程提取48 kHz PCM并实测纯静音后才标记ASR `not_applicable`。实测详情及产物SHA见 [composition-probe.json](evidence/composition-probe.json)。首次试跑因AAC解码采样与原始PCM不完全相同而报 `AUDIO_DURATION_INVALID`，仅对最终AAC解码增加最多1024采样容差，原始混音轨仍精确采样验证。该探针只有两条短句和确定性技术画面；静音成片实测960,512采样，较原轨多512；最新 `npm test` 37文件160项、lint/build/顺序typecheck和真实探针均退出0。音乐/音效、响度/真峰值、长篇语音听验、1080p、43风格基线和模型生成影片完整链路未验收，T10/T11仍partial。

2026-10-02 T10响度增量：固定媒体镜像对最终AAC运行独立`loudnorm`测量。未处理技术成片 -25.93 LUFS/-9.27 dBTP，按目标失败；仅做单级归一化 -15.57 LUFS/-1.19 dBTP仍失败。改为人声峰值压缩+归一化，合成器对有声影片在独立技术QA后强制检查 -14±1 LUFS与真峰值≤-1.2 dBTP；上一20秒技术片为 -14.41 LUFS/-1.49 dBTP并通过中英文成片ASR。静音片实际解码为纯静音后响度N/A。ASR偶发繁体“活動將在…開始”由锁定`opencc-js@1.4.1`在比较时正字归一化，原计划/期待文本保持不变，10月9日错误仍拒绝。证据见 [composition-probe.json](evidence/composition-probe.json)。配乐/音效、特殊发音听验、真实用户内容、1080p、43风格与语义QA未完成；完整 `npm test` 38文件163项、lint/build/顺序typecheck和最终真实探针均退出0，T10/T11仍partial。

2026-10-02 T05语音素材增量：固定离线ASR镜像更新为 `sha256:67786e6dbdd6b00f6177441e64272b622f844fc6c69b39970543afa92cc4895c`，新增 `auto` 语言检测，保留原指定中英文台词检查；旧ASR探针在新镜像再次通过并拒绝错误日期；20秒合成探针复跑为 -14.44 LUFS/-1.49 dBTP，成片中英文ASR仍通过。明确语音用途的上传素材由Source Worker在无网媒体镜像中探测/转换为24 kHz WAV，独立ASR识别，再把时段转录、原字节哈希、转码哈希、镜像摘要作为不可信来源持久归档；Director新加 `time:起止毫秒` 摘录核验。真实4.1秒合成WAV以HTTP字节流上传后，Worker独立处理为ready，briefVersion=1、inputPending=false，识别“上海的活动将在10月8日开始”；同样字节作为“配乐”上传则显式 `AUDIO_MUSIC_UNSUPPORTED`、pending=false，不制造音乐事实。证据 [source-audio-probe.json](evidence/source-audio-probe.json)。目前只支持0.2–30秒的明确语音用途、中文或英文；人类实录、长音频、音乐/音效、扫描PDF和图片仍缺，完整 `npm test` 39文件165项、lint/build/顺序typecheck、Python语法与真实上传/原ASR/成片探针均退出0，T05继续partial。

2026-10-02 T05长语音增量：按实测时长把≤120秒语音分成最多5个核心区间，前后各取2秒上下文，ASR后以时间中点选主区间，保留源时间与每段转码哈希；100毫秒PCM能量窗口若持续≥600毫秒有声却无转录，直接 `AUDIO_TRANSCRIPT_INCOMPLETE`，不得ready。52秒相同句子循环输入实际出现大段漏识别，Worker正确标failed、pending=false；14句不同内容拼接成56.525秒上传音频，三片ASR通过覆盖门槛并ready，按时段归档全部14句，见 [source-audio-probe.json](evidence/source-audio-probe.json)。模型仍把“黄浦”误听成“黄埔”、“晚间”误听成“万间”；覆盖不证明语义正确，重要事实需来源复核。真实人声、音乐/环境声、120秒边界及长音频听验未验收；最新 `npm test` 39文件167项、lint/build/顺序typecheck和真实56.525秒探针均退出0，T05仍partial。

2026-10-02 T09/T10媒体QA增量：独立ffprobe要求H.264 `yuv420p` 与 `color_primaries`/`color_transfer`/`color_space` 全为BT.709；MP4顶层原子解析要求`moov`早于`mdat`。1秒320×180媒体探针再次通过完整解码、运行中停止、随机画面拒绝；20秒合成技术片通过中英文成片ASR、-14.44 LUFS/-1.49 dBTP，已知背景输入RGB(24,48,74)经实际解码得到(20,45,74)，最大通道误差4，见 [composition-probe.json](evidence/composition-probe.json)。这一像素技术探针不覆盖1080p或43风格的全片色彩/视觉QA；完整 `npm test` 39文件168项、lint/build/顺序typecheck和两个媒体探针均退出0，T09/T10仍partial。

2026-10-02 T11预览包增量：`tests/video/preview.test.ts` 对缺失 `bundle.ts`/`commit.ts` 先实测退出1；实现严格预览包、内容哈希/独立预览媒体摘要、24小时有效期、节选映射校验、不可变存储与 ProjectControl CAS 提交后7项通过。测试覆盖改变音轨/脚本拒绝、换预览文件不改创作哈希但须单独核验、旧 brief/pending/取消 fence 不发布、同 previewId 不可换包。ProjectView 现可返回已提交预览的文案/事实/哈希，内部对象路径不暴露；没有真正预览制作，动作仍禁用。`npm test` 39文件172项、lint、build、构建后typecheck均退出0。T11仍partial，AT-034/035/082等真实闭环未验收。

2026-10-02 T11正式批准边界增量：`approve.ts` 缺模块测试先退出1；实现对已存且未过期预览包的严格请求校验、唯一 `preview_button` 批准记录、控制态CAS占用制作槽、持久render intent和同命令重放补队列。两个不同命令并发仅1个占槽；相同命令重复点击复用operation；错误hash/过期均拒绝。局部10项及全套39文件175项通过，build/typecheck通过；lint曾提示测试中未用变量（退出0），随后移除并复核。生产预览、对外批准route、render Worker/预算/真实QA仍缺，T11不能标完成。

2026-10-02 T12发布边界增量：`qualityGate` 必检项降为warning/重复ruleId的红灯先失败后通过；`delivery.ts` 缺模块、`results/publish.ts` 缺模块的测试分别退出1后实现。14类基础QA规则与不可变策略hash、最终文件hash绑定，`not_checked`听验/版权和缺证据均阻断；静音N/A需要单独实际解码静音证据。原子发布核对 preview/approval/result、owner、文件实际存储字节hash、操作 fence 和 consentEpoch；测试覆盖错误bundle、取消后迟到产物、文件篡改、成功指针切换及重复提交。发布测试中100字节文件仅是哈希/CAS夹具，绝不是有效MP4或真实QA；没有对外发布入口。`npm test` 40文件180项、lint、build、构建后typecheck退出0。完整渲染、视觉/听验真实证据、媒体写入与下载闭环未实现，T12仍partial。

2026-10-02 T13制作取消增量：`cancelProduction` 的新测试先因缺函数退出1；实现ProjectControl CAS先撤销制作授权、递增consentEpoch、记录cancelRequested并保留旧currentResult，再更新操作fence/状态；排队且未claim直接cancelled，运行中cancelling。重复取消不重复计数，旧操作不误伤新操作。现有取消API接入`scope=production`，AT-039迟到发布测试改为调用真实取消命令。`npm test` 40文件182项、lint、build、构建后typecheck均退出0。Docker容器停止/清理、render Worker、自然语言修改/恢复仍缺，T13部分实现。

2026-10-02 T13/T14恢复上一版增量：`results/restore.ts` 缺模块测试先退出1；实现规范路径POST `/results/:artifactId/restore`，核对前版manifest、产物记录和磁盘真实字节hash后，CAS只交换current/previous指针并递增consentEpoch，不启动媒体任务。同command重试不再次翻转，错误artifact或篡改文件拒绝；`npm test` 40文件183项、lint、build、构建后typecheck退出0。测试仍使用合成文件作存储/CAS夹具，非真实成片；只支持上一版，历史多版本选择及UI/真实片验收未完成。

2026-10-02 T11预览存储核验增量：`commitPreviewBundle` 不再信任调用方提供的实际hash；从同项目/同revision/已上传且QA通过的私有MP4记录读取实际字节再核对SHA。缺文件用例先实际返回STORE_NOT_FOUND并失败，映射为PREVIEW_ARTIFACT_MISMATCH后通过；篡改字节、换包、过期fence仍拒绝。`npm test` 40文件184项、lint、build、构建后typecheck退出0。夹具文件不是有效MP4，未冒充真实预演或风格证据。

2026-10-02 T14公开产物授权增量：本地artifact测试先证实QA标记通过但尚未成为项目指针的文件也可签URL（测试退出1）；将内部发布前检查拆为inspectArtifact，公开resolveArtifact只放行当前预览、当前结果或保留上一版指针所引用的同revision文件。预览/正式结果提交前拒绝、提交后允许；`npm test` 40文件184项、lint、build、构建后typecheck退出0。未测试真实用户播放器和完整导出，T14仍partial。

2026-10-02 T11真实AV节选增量：`preview-render.test.ts` 缺实现先失败、实现后2项通过；新增旁白完整覆盖用例先因函数不存在失败、实现后局部3项通过。`renderPreviewExcerpt` 固定媒体镜像无网络、只读源、资源限额，验证20秒源片 SHA/全片解码，再用逐帧视频、48 kHz逐采样音频剪接三段、重新编码H.264/AAC，输出后独立完整解码/BT.709/faststart/哈希检查。首轮技术探针把1秒开始的中文旁白在4秒切断，节选ASR实际 `ASR_MISMATCH` 退出1；保留原稿，延长第一段，给渲染入口加入旁白窗口不可截断规则。最终0–6秒、9–13秒、15–17秒源区间组成12秒节选，157,827字节、SHA `e5ddf6be782eba66ebd3b23f9c1622b41caa89a50092e775820c63bebd969332`；技术QA通过，节选后中英文ASR均与原文匹配、PCM音轨非静音、背景RGB最大误差4，中文/英文/空档三张抽帧人工查看位置正确。证据见 [composition-probe.json](evidence/composition-probe.json)、[中文帧](evidence/preview-caption-zh.png)、[英文帧](evidence/preview-caption-en.png)、[空档帧](evidence/preview-caption-gap.png)。全套`npm test` 41文件187项、lint、build、构建后typecheck及真实容器探针均退出0。该片为确定性320×180场景，未生成真实用户主题、1080p或任一风格基线；尚无预览Worker/API、项目产物绑定、播放器与批准闭环，T11 partial，AT-034仍未验收。

2026-10-03 T01 FilmSpec/Timeline契约增量：`film-contract.test.ts` 先因模块缺失退出1；新增严格Zod对象、完整镜头/section覆盖、显式双边crossfade、避免三镜同时重叠、cue绝对时间量化、旁白和音频事件边界、字幕及声明引用核对。`verifyFilmPackageRefs` 对持久化的7个引用重读规范JSON SHA/字节数和Timeline内容；故意CAS篡改已归档时间轴后拒绝。1微秒音频事件量化曾因错误报告误差0失败，修为真实-1微秒；三镜重叠用例曾暴露漏检，修复后通过。完整`npm test` 42文件191项、lint、build、构建后typecheck均退出0。该模块仅证明结构和给定引用集合内的一致性，未从素材/事实manifest自动派生允许引用，未调用真实创作模型或渲染，T01/T11 partial，不能据此标完整FilmSpec或C0通过。

2026-10-03 T11私有节选产物增量：合成探针先因缺 `preview/artifact.ts` typecheck退出2；实现后固定媒体容器再次独立验证已渲染节选，重算源片/映射/profile/runtime stageKey，通过临时文件+fsync+排他硬链接将实际MP4写入自托管私有对象卷，并核对目标字节SHA、不可变manifest及同ID重放。真实320×180/12秒节选本轮157,770字节、SHA `eda8dc33d7c01958e6a1db59e12d6487a0432d3d7a07edfa3c4486c2edeb7938`；实际存储字节哈希相同，指针提交前 `resolveArtifact` 拒绝；伪造源片SHA、篡改落盘字节再重放均被拒，见 [composition-probe.json](evidence/composition-probe.json)。真实容器探针、`npm test` 42文件191项、lint、build和构建后typecheck均退出0。技术项目仍无FilmSpec、预览Worker/API或用户批准，AT-034/T11未完成。

2026-10-03 T01制作包来源增量：`film-package.test.ts` 先因目标模块缺失退出1；`loadVerifiedFilmPackage` 现从存储读取七个被FilmSpec锁定的规范JSON，核SHA/字节/项目路径后严格解析Understanding、treatment、事实、Timeline、资产、源码、音频清单。Timeline引用集合由清单推导，删去允许调用方传入任意引用集合的旧包验证入口。实际持久化fixture验证正确包；改用不含镜头模块的有效清单被`TIMELINE_REFERENCE`拒绝，brief版本改变被`FILM_BRIEF_CHANGED`拒绝，虚构事实先暴露`NON_JSON_VALUE`漏映射，修复为`FILM_FACT_INVALID`，未在Understanding声明用途的素材先错误通过，修复后`FILM_ASSET_INVALID`；CAS篡改已保存Timeline被`FILM_REF_CHANGED`拒绝。首轮完整测试43文件191项通过但lint因变量`module`触发Next规则退出1；改名后全套`npm test` 43文件191项、lint、build、顺序typecheck均退出0。清单证据只覆盖静态引用与来源约束；HTML静态/运行验证、真实音频字节及版权判定、模型生成FilmSpec与预览Worker仍缺，T01/T11 partial。

2026-10-03 T11预览发布与制作包绑定增量：先把持久化测试夹具改为真实可验证的FilmSpec/七份清单；加入伪造FilmSpec引用并重算bundleHash的用例，旧`commitPreviewBundle`实际接受并将项目切到`preview_ready`，测试退出1。新增`verifyPreviewPackage`后，提交和读回均重新校验制作包，再比对脚本、事实、概要、源码/时间轴/音频与素材摘要、1080p目标profile、媒体运行时和节选镜头/旁白覆盖。合法夹具通过；伪造FilmSpec、重新签名的错误台词、错误shotId、归档FilmSpec后续CAS篡改均拒绝。因更改概要现在先被包校验拒绝，原previewId冲突用例改用仅变化qualityEvidenceRefs验证不可变manifest；过期批准夹具改成真实制作包。局部15项与完整`npm test` 43文件191项、lint、build、构建后typecheck均退出0。100字节视频夹具仅检验边界，不能当作实际MP4/真实预览；生产预览Worker/API、完整听验和用户闭环仍缺，T11 partial。

2026-10-03 T06/T11 Treatment 增量：`treatment-stage.test.ts` 首轮因缺模块退出1；`TreatmentPlan` 严格校验三项内部方案、选中方案、逐帧完整镜头、已知事实及必需事实覆盖和逐镜头文案。Director 通过真实 Mastra/OpenAI-compatible adapter 接收冻结 Understanding 与哈希固定的 STYLE 规则；本地 HTTP 假提供方仅验证请求/结构化协议，未当作真实模型质量测试。自托管 `prepareTreatmentStage` 在生产配置启用后才调用真实模型，预算预留与 effect ledger 防止不确定结果自动重试，写入不可变方案前复核 consentEpoch、brief 和 activeProduction。测试验证重复执行只调用一次、执行中授权变化拒绝落盘，以及未知外部调用不再自动重试。FilmSpec 的 Treatment 清单现在必须引用不可变方案，并与脚本、事实和 Timeline 镜头核对；故意移除关键事实被拒。`npm test` 45文件194项、`npm run lint`、`npm run build`、随后 `npm run typecheck` 均退出0。无真实模型凭据，未运行付费调用、真实创意评估或用户预览；Visual/Audio/Critic、预览 Worker/API/批准 UI 和43风格基线继续未完成，T06/T11 partial，C0/C1/C2 均未达到。

2026-10-03 T10/T11 旁白计划增量：`voice-plan.test.ts` 首轮缺模块退出1；现从已核准 Treatment 镜头帧区间计算每句毫秒时间窗，spoken/display/ASR期望文本直接沿用冻结脚本，不截断过长台词。`voiceMode=none` 生成空旁白计划，用户录音模式在尚未接通该路径时明确阻断。`npm test` 46文件195项、lint、build、构建后typecheck均退出0。当前只是计划编译，尚未把真实TTS/ASR、文件持久化和音轨接入用户预览。

2026-10-03 T10/T11 项目语音阶段增量：`voice-stage.test.ts` 首轮缺模块退出1；ASR来源错配用例先错误通过，现 `verifyNarration` 比对识别记录的语音SHA与实际待核验语音SHA。`prepareVoiceStage` 从同项目同修订版的不可变 Treatment 读取旁白计划，实际调用锁定离线 TTS 与 ASR、复核落盘 WAV 字节并保存不可变计划/核验清单；重放验证源文件，控制态版本或授权在执行期间改变时不发布阶段记录。测试以实际PCM WAV字节覆盖持久化、重放、篡改和执行中取消边界。独立 [项目语音探针](evidence/voice-stage-probe.json) 用重建的固定ASR镜像 `sha256:67786e6d…` 与现有固定语音镜像，真实完成一条中文4.1秒语音及12个词级时间，并验证同阶段重放；这是合成技术brief，不是用户预览。`npm test` 47文件196项、lint、build、构建后typecheck均退出0。还未接入预览Worker、音轨混音/字幕/声画视频，未验证特殊发音、听验或43风格，T10/T11 partial。

2026-10-03 T10/T11 项目时间轴增量：`timing-draft.test.ts` 首轮缺模块退出1，测试用真实PCM文件验证阶段绑定；`compileTimingDraft` 现在把冻结镜头帧、已核验旁白采样、字幕帧、48 kHz音轨SHA和固定字体摘要收进严格不可变草稿，并检查时段/台词/声音来源，质量状态明确为 `semantic_not_checked`。联合测试首次因字体读取返回的整份glyph Set不符合持久化schema而失败；诊断到该字段后只保存字体摘要，复跑通过。`prepareTimingStage` 仅能读取已存在的语音记录，不会代替前序阶段生成语音；重放复核实际音轨字节，测试拒绝磁盘篡改。固定语音/ASR/媒体三镜像的真实 [时间轴探针](evidence/timing-stage-probe.json) 退出0：20秒/480帧、960,000个48 kHz采样、一条完整旁白、113帧字幕、Noto CJK实际字形与相同阶段重放均通过。`npm test` 48文件197项、lint、build及构建后typecheck均退出0。该草稿仍没有画面源码、音乐/音效、最终FilmTimeline、预览MP4或真实用户主题；T10/T11 partial，C0/C1/C2均未达到。

2026-10-03 T06/T11 Visual源码增量：`visual-shot.test.ts` 首轮缺模块退出1；新增真实Mastra Visual角色输出的严格镜头契约，固定Understanding、Treatment、TimingDraft及STYLE哈希，按镜头生成自包含HTML和绝对时间`window.render(t)`，静态拒绝定时器、未种子随机、外部脚本与网络调用。`prepareVisualShotStage` 将每镜模型预算/效果记录/不可变源码绑定同修订版，并检查素材授权、操作fence与源码归档字节。测试证明本地OpenAI-compatible假提供方的结构化协议、同镜重放仅调用一次、缺生成配置拒绝、篡改已保存源码拒绝；假提供方不代表模型质量。联合测试首次超出夹具的20,000输出token预算，原因是两次Treatment加一次Visual预留合计22,000，调整测试额度后通过，生产限额未放宽。`npm test` 49文件199项、lint、build及构建后typecheck均退出0。源码阶段仍标`runtimeStatus=not_checked`；缺真实`MODEL_API_KEY`、`VIDEO_VISUAL_MODEL`与服务地址/付费授权，未进行真实Visual模型调用或渲染，T06/T11 partial。

2026-10-03 T03/T06 预算与外部效果顺序修复：新增测试先证实预算不足在未调用模型前仍把Treatment effect标成started，后来提高预算会得到`EFFECT_UNKNOWN`，实际退出1。将Director、Treatment、Visual三个调用点的幂等预算预留移到外部effect创建之前；同一操作预算失败后可重新配置并重试，而模型调用已开始后的不确定结果依然不会自动重复。局部Director/Treatment/Visual测试通过，完整`npm test`49文件199项、lint、build和构建后typecheck均退出0。

Visual上下文复核：本地模型协议测试新增断言后先失败，确认虽然输出契约要求`timingDraftHash`，提示上下文未给模型该精确值；现明确随冻结TimingDraft发送哈希，局部及完整回归通过。没有据此宣称真实模型能生成可执行画面。

2026-10-03 T09/T11 画面阶段增量：Visual 增加只读取已冻结源码的 `mustExist` 模式；测试先实际得到 `GENERATION_DISABLED` 而非预期的 `VISUAL_STAGE_MISSING`，修复后读取不调用模型或再次预留预算，并重验源码哈希、时间轴及授权。新增 `preparePictureShotStage` 将单镜 Visual 源码、TimingDraft、运行时摘要、帧范围和 consentEpoch 组成内容寻址的本地 Docker 任务；成功后由独立 `technicalVideoQa` 全片解码并把实际 SHA/字节数持久化，重放重新核对输出。单测覆盖 1920×1080 正式任务参数、重放仅提交一次及输出变更拒绝；使用注入的 executor/QA，不作为真实渲染证据。真实 [picture-stage-probe.json](evidence/picture-stage-probe.json) 以合成技术 Visual 源码完成 20 秒/480 帧/320×180 渲染，H.264/BT.709/faststart/全解码通过，输出 21,718 字节、SHA `c2a55d9d…`，同阶段重放一致。首轮探针在时间轴阶段因媒体镜像摘要/超时环境未设置，按 fail-closed 规则退出1；补齐后退出0。`npm test` 49文件199项、lint、build、构建后typecheck均退出0。该探针没有调用真实Visual模型，不支持素材字节注入，未做1080p、语义/风格QA、镜头拼接/音画合成或用户预览；T09/T11仍partial，43风格86基线仍全部 `not_run`。

2026-10-03 T09/T11 多镜画面增量：`preparePictureShotStage` 新增只读模式，缺已完成镜头明确报 `PICTURE_STAGE_MISSING`；测试先实际进入 Docker 配置失败，再修复为只读。`preparePictureSequenceStage` 从冻结 TimingDraft 按顺序重读全部镜头记录，单镜逐一复核实际媒体哈希，再用固定无网镜像按精确帧数拼接；阶段记录绑定全部输入SHA、项目/revision、运行时与consentEpoch，重复执行重验输出。独立技术QA额外要求 ffprobe 实际解码帧数，错误23/24帧测试先失败再被拒。真实 [picture-sequence-probe.json](evidence/picture-sequence-probe.json) 用两个容器各渲染10秒/240帧，再拼成20秒/480帧320×180 H.264；独立全解码/BT.709/帧数/哈希通过，输出19,057字节、SHA `8b0305e1…`，5秒中心像素 `[176,74,28]`、15秒 `[26,83,172]` 证明镜头顺序，同阶段重放一致。抽取1×1像素的首次探针因YUV420裁剪约束失败，改为2×2后退出0。项目阶段单测使用注入的合成器和QA，只验证持久化协议；真实探针没有调用项目阶段或模型。完整`npm test`50文件201项、lint、build、构建后typecheck均退出0。仍缺音轨/字幕合成接入、真实Visual模型、1080p/素材/风格QA和预览Worker/API，T11不标完成。

2026-10-03 T10/T11 项目级音画合成增量：`prepareCompositeStage` 现在重读同revision已冻结的 Voice/Timing/PictureSequence，重验48 kHz旁白轨及Noto CJK字体摘要，从字幕帧生成SRT，锁定画面/声音/字幕/style/runtime/fence合成键；固定无网镜像生成H.264/AAC，独立技术QA、响度/真峰值及最终音轨ASR均通过才持久化记录，重放再核实际MP4字节。记录保留 `qualityStatus=semantic_not_checked`，不把通用字幕样式当作43风格适配。单测先因阶段模块缺失退出1，后验证同版重放仅合成一次、改最终哈希被拒；注入执行器不是真实媒体证据。真实 [composite-stage-probe.json](evidence/composite-stage-probe.json) 从同一20秒技术项目的离线TTS/ASR、960,000采样音轨、冻结Visual、单镜拼接生成320×180/480帧成片；独立全解码/BT.709/faststart/哈希通过，本轮121,477字节、SHA `c4c73020…`，响度-14.2 LUFS/真峰值-1.5 dBTP，成片后12词ASR匹配日期，重放一致。首次真实运行遗留已退出画面容器；探针新增精确容器清理后复跑退出0，Docker按该stageKey查询无容器。全套`npm test`50文件201项、lint、build、构建后typecheck均退出0。仍缺真实Visual模型、素材渲染、配乐/音效、1080p和风格/语义/听感QA，完整预览节选及用户审批/正式生产未接通，T10/T11仍partial。

2026-10-03 T11 项目预览节选增量：新增 `preparePreviewExcerptStage`，从同revision已冻结TimingDraft与真实Composite读取完整源片，要求节选6–12秒、精确帧边界、每段落在声明镜头内、任何相交旁白必须完整覆盖；将源片/映射/运行时绑定stageKey，先持久化幂等artifact intent，再渲染、独立全解码并写入同项目私有对象卷，重放重验媒体与对象字节。项目联合测试先因模块缺失退出1；现拒错误shotId、截断旁白、同revision偷偷换节选映射、节选文件SHA变化。新增 `preview` profile：逻辑构图继续1920×1080/1080×1920，实际预览输出1280×720/720×1280。真实 [preview-stage-probe.json](evidence/preview-stage-probe.json) 用合成320×180技术项目生成9秒216帧私有节选，103,239字节，文件与对象SHA `81043e3a…`，指针提交前访问被拒；后续 [preview-720-stage-probe.json](evidence/preview-720-stage-probe.json) 实测1280×720、9秒216帧、143,214字节，SHA `06f7bc52…`，同版重放、私有字节和未发布拒访均通过。配套 [720p画面](evidence/picture-stage-720-probe.json) 与 [720p合成](evidence/composite-stage-720-probe.json) 记录20秒480帧、成片后12词ASR通过、-14.19 LUFS/-1.5 dBTP。原探针在对话中断前已完成并写入证据，复查进程终结与文件后又独立跑通720p；`npm test`50文件201项、lint、build、构建后typecheck退出0。Visual仍是注入的合成HTML；无真实FilmSpec/StylePack执行、语义/风格/听验QA、预览Bundle提交/可播放UI/用户批准，不能把私有技术产物当已开放预览，T11仍partial。

2026-10-03 T10/T11 持久旁白包增量：新增 `archiveVerifiedNarration`、`loadPackagedNarration` 与 `prepareNarrationPackageStage`，真实 WAV 按内容哈希进入私有修订目录，固定台词、音色配置、ASR 来源、逐词时间及48 kHz采样范围；合成记录升级 schemaVersion=2 并绑定旁白包哈希。FilmSpec 读取现在拒绝重签名的错误日期、缺旁白、变更逐词记录和实际 WAV 篡改。两项审查指出硬链接发布中断后 nlink=2 无法恢复，新增 OS flock 与“先核实际SHA/字节、只清理同 inode 的已知临时别名”修复；真实子进程在 link 后退出73，冷进程恢复为单链接且未知硬链接仍拒绝。归档/阶段缺模块、日期与词文本漏洞测试均先失败后通过；完整联合测试在构建/Docker并行时曾超5秒，单项改为15秒，断言未减。最终 `npm test` 51文件205项、lint/build/构建后typecheck/diff-check退出0。真实离线4.1秒/12词 WAV 删除 voice 工作目录后独立读取通过，篡改对象拒绝；最终720p合成20秒480帧、-14.18 LUFS/-1.5 dBTP及成片后ASR通过，9秒216帧节选142,284字节、SHA `e95679e3…`，提交指针前访问拒绝，容器清理完毕。详见 [验证报告](evidence/narration-package-validation.md) 与真实JSON证据。独立归档读取不等于删工作文件后整条制作链可重放；仍无完整FilmSpec生产者、音乐/音效、独立语义/风格/听感QA及用户预览发布/批准，43风格86基线仍not_run，T10/T11 partial，deployed=false。

2026-10-03 T06/T09/T10/T11 FilmSpec 制作包增量：新增 AudioAgent 原生严格计划与持久预算/effect阶段，固定STYLE、TimingDraft、节拍段、合成/用户音轨、cue/事件及MixPlan。Visual原生输出新增目的/构图/镜头/actor声明和revision seed；所有镜头统一seed，Picture记录schemaVersion=2同时锁完整Visual引用与HTML哈希。`prepareFilmPackageStage` 只读已冻结各阶段，生成1080p目标的FilmSpec与七份不可变manifest，并在阶段marker前验证完整图、实际旁白/素材字节、字幕/font、runtime与consent fence。AudioPlan和producer缺模块测试先退出1；未执行的拟音/增益、缺Visual信息、BPM/镜头/字幕重签名与素材实际字节变化被拒。规格审查发现把质量策略改成v1可走弱兼容分支，回归先错误resolved退出1，修复为未知策略立即`FILM_POLICY_UNSUPPORTED`及所有来源字段必填；审批夹具补齐严格冻结来源，未放宽断言或生产默认。两项复审无剩余发现。最终`npm test`53文件208项、lint/build/构建后typecheck退出0。真实技术探针用离线4.1秒/12词中文TTS/ASR与393,644字节私有WAV组装FilmSpec，重放与重签名篡改拒绝通过；删除voice/audio工作目录后独立包读取通过，但Voice/Timing/producer重放仍需工作文件。同项目720p成片20秒480帧、173,974字节、-14.18 LUFS/-1.5 dBTP、最终ASR匹配；9秒216帧节选142,794字节、SHA `78ca3a42…`，未发布指针前拒访且容器清理完成。详见 [制作包验证](evidence/film-package-validation.md)。计划音乐/拟音/增益未实际执行时明确`FILM_AUDIO_EXECUTION_NOT_READY`，默认原创配乐未删除。输入Visual/Audio为技术注入；14条基础策略不是质量通过报告或43风格规则。正式批准FilmSpec到render Worker绑定、真实模型、素材容器传输、音乐/录音、独立语义/风格/听感QA及43风格86基线尚缺。T06/T09/T10/T11 partial，C0/C1/C2未达到，deployed=false；无push/生产部署。

2026-10-03 T06/T10 真实模型与合成器增量：用户授权提供方接入，凭据仅存忽略的0600本地文件。真实非流/流式HTTP均200；原生Mastra Director首轮编造风格被记录，新增回归先退出1，服务端目录校验与43项上下文修复后11项通过。真实复测选择crayon-book，保留两条来源事实，用量4119输入/1663输出。原生Treatment首轮计划通过但实际TTS超时，补自然语速约束后时长通过，却在专名青禾的独立ASR核验失败（识别清和），未放宽事实门槛。失败的付费调用与工作目录保留、无自动重试。提供方实测忽略max_tokens及max_completion_tokens，不能再宣称预约即硬输出上限，见[API证据](evidence/provider-probe.json)。新增可信数据合成器先因缺模块退出1，后在固定无网Docker生成实际48kHz立体声配乐/拟音，20秒各960000采样，声像/事件外静音/哈希重放通过，见[声音探针](evidence/sound-probe.json)。还未接入音乐主混音、成片、听验、用户预览或43风格；项目仍未完成，不部署不push。

两项独立审查共同发现整轨RMS会误拒绝短轻拟音；真实Python 100ms/-30dB回归先退出1，立体声stem改为精确零PCM静音判定后相关5项通过，单声道人声阈值和最终LUFS门槛保持。首次完整回归54文件211项通过，lint退出0但有未使用import警告，已移除；build与构建后typecheck退出0。

最终复测54文件211项、无警告lint、build、构建后typecheck及diff-check退出0；审查回归夹具曾因联合类型未缩窄导致typecheck退出2，已缩窄并复验。standards/spec两项复审关闭稀疏拟音P2，无剩余发现。模型验证与声音stem实现已测试、未部署；T06/T10及整个项目继续partial。

2026-10-03 T06/T09/T10/T11 真实模型声画增量：新增固定无网FFmpeg主混音，冻结实际人声/配乐/拟音SHA、MixPlan和可信工具摘要，立体声48kHz主轨；独立220Hz频谱测量，人声880Hz技术信号出现时配乐降低9.18dB，结束后恢复，重放与篡改拒绝通过。该信号不是TTS/用户语音。AAC声道回归先错误输出mono退出1，现保留stereo；独立QA拒绝声道压成mono的回归也先失败后通过。

另开明确无旁白、继续原创音乐的真实模型用例，不修改之前青禾ASR失败的有声用例。原生Treatment/Voice-none/Timing通过，首Audio事件校验失败被保留。四次原生Visual HTTP200，首镜通过；后三镜被旧静态校验器误把JS注释当URL拒绝。Acorn语法解析回归先退出1，修复后对四份原始HTTP响应SHA重验通过，三个started effect由显式本地修复收据关联，额外模型调用0；没有改源或删除预算预约。首次真实画面暴露env未传到DockerExecutor（退出1）；传递修复后实际720p渲染，首镜曾QA abort，剩余三镜通过。一次本地并发探针互换activeProduction，fence正确拒绝；已恢复原控制操作，顺序复核全部四镜及20秒480帧拼接通过。失败证据保留。

Audio补明确采样/包络/source/cue约束，显式新operation的一次付费实验成功，旧不确定effect/预约保留；隔离项目调用额度6→7，原控制操作恢复。真实计划15个音乐事件、7个拟音、8个合成source、4个节拍段，用量7438输入/13457输出，再次超过请求12000；不能称硬token上限。七次该无声旁白用例原生调用合计41407输入/69693输出，未超过实验整体80000输出额度，但生产实际usage对账/未知消费熔断尚缺。

[真实模型成片探针](evidence/native-composition-probe.json)实际使用这些冻结Visual与Audio计划、可信合成/混音和无网Chromium/FFmpeg，生成1280×720、20秒480帧、7829730字节H.264/AAC立体声；SHA c852bb9737ce3c6f0c43a0f7f87e0b0ef7967f129696574c3573d8a5a3e4b790，独立全解码、faststart/BT.709、声道2、-14.08LUFS/-1.5dBTP通过、重放相同。四个实际抽帧见[来源清单](evidence/native-frames.json)，中途书写文字未完全出现，未把它当阅读/事实/风格质量通过。此为显式无旁白技术用例，原青禾ASR仍阻断；未接AudioExecution/FilmSpec与预览Worker/UI，不是用户可批准影片。43风格86基线仍not_run，质量仍semantic_not_checked，C0/C1/C2未达到、不部署不push。

两项独立审查中standards发现跨语言小数格式误拒绝合法voiceGainDb=0.000001；真实TS→Python有声/无声回归先2失败，修复为受限数字字面量与冻结值相等、完整固定图逐字匹配后3通过，仍拒绝改增益/追加滤镜。复审关闭P2，spec无新增发现。更新可信工具SHA后实际Docker master和原生声画探针重新通过，最终MP4 SHA相同。最终Node22验证：55文件217项通过、无警告lint、build、构建后typecheck和diff-check均退出0。新增直接依赖Acorn安装使用项目规定Node22；npm audit记录11个high依赖链告警，尚待受控修复。实现/测试增量已保存本地，T06/T09–T11与整个项目仍partial，未push或部署。

2026-10-03 T10/T11 声音执行制作包增量：音频包归档48kHz mono voice、stereo music/foley/master实际字节、Timing/AudioPlan/seed、冻结可信Python工具、runtime和执行收据。原audio-files仍20MB，新的sound-files最多64MB，沿用OS flock/同inode临时别名恢复。新增归档/阶段模块测试先因缺模块退出1；删除工作目录后独立读、改MixPlan、跨修订路径、symlink/实际WAV篡改拒绝通过。FilmSpec真实音乐绑定测试先因缺声音来源函数失败，现七份manifest包含执行包及合成recipe来源；未执行音乐仍FILM_AUDIO_EXECUTION_NOT_READY。Composite绑定AudioPlan/执行包SHA的回归先undefined退出1，现读取归档主轨、保持AAC stereo。明确无旁白且实际零voice PCM/全部合成源才能ASR not_applicable=no_narration；有声case仍必须成片后ASR。music质量策略不免听验、响度或true peak。

规格审查发现P1：合法计划/输入stageKey未绑定实际master完成marker，重签全零master可误进入silent策略。真实冷副本攻击由审查复现；新全零归档回归先resolved退出1。修复执行包schema2，核实际sound/master job字节及完成state，冻结收据并与固定input-addressed audio-run-receipts槽位比较；旧弱schema1拒绝、阶段新版本键保留旧实验。非零bus对应零master直接拒绝，质量策略按冻结音乐/拟音意图选择music。全零替换、非零替换+重签匹配收据和缺实际marker均被拒。两项复审无剩余发现；规格审查在真实冷副本重做两种攻击均拒绝，独立10项回归通过。

[真实制作包与合成证据](evidence/native-package-probe.json)：原生真实Treatment/四镜Visual/15音乐/7拟音，FilmSpec SHA50cb05ec…、声音执行包9a546c85…，全部持久JSON和WAV复制到新目录后（无voice/audio/sound/master/render工作目录）独立完整包读取通过，音乐对象篡改拒绝。首次冷复制仅复制objects漏掉FileStore项目JSON，FILM_REF_CHANGED退出1；补复制持久JSON后通过，未把此错误算能力成功。实际720p Composite使用归档master，全解码20秒480帧、7829730字节、AAC2声道、-14.08LUFS/-1.5dBTP，成片SHAc852bb97…，重放一致、额外模型调用0。1080p是冻结目标，未冒充实测结果。

此增量尚未接预览Worker/API/UI批准，未完成语义/阅读/风格/听验，原青禾ASR失败及provider忽略token cap/缺实际用量对账仍为阻断。43风格86基线not_run，C0/C1/C2未达到，T10/T11仍partial、deployed=false。首次完整56文件223项/lint/typecheck通过，build退出0但出现master.ts动态路径追踪警告；纯滤镜编译拆为独立模块，包读取不再引入Docker执行模块，随后重新验证构建和回归。

最终验证：纯滤镜模块分离后build退出0且无追踪警告；56文件223项、无警告lint、构建后typecheck和diff-check均退出0。两轴复审关闭P1、无剩余发现，容器清理完毕。仅本地提交，无push/部署，项目继续开发。

2026-10-03 T03/T06 模型实际用量对账增量：四个真实 Mastra 生成入口在请求前持久标启动，返回后先按 SDK input/output 总量结算，再校验语义，不重复加 reasoning token。保守预留不退款；超限/未知用量/已启动调用不自动重试。旧无accountingVersion计数拒绝继续消费，需审计，不自动重置。

失败→通过：对账首轮缺模块/本地HTTP协议case未标启动失败；实现后正常/超限/缺usage通过。非法风格先记实际消费再拒绝语义。旧账本断言先错误允许，修复fail-closed。Director预算中断映射及过期预约错误原为PROVIDER_UNAVAILABLE，断言失败后修正为BUDGET_LIMIT/MODEL_USAGE_UNCERTAIN并归档中断消息、SSE终态不可自动重试。两轴审查各自复现跨UTC午夜P1；三条跨日测试先失败，新增持久部署级单活跃门闩、过期预约拒绝后通过。请求前计数写失败保留占用，两份计数均已知正常结算后才解除，旧完成回执重放不清除新占用。

真实验证：Node22 node --env-file=.env.grsai.local --import tsx scripts/video/probe-model-accounting.ts --accounting。仅1次HTTP200，gemini-3.8-flash实际4103 input/2716 output，账本settled、gate.active=null，下一调用因次数上限拒绝，见 [model-accounting-probe.json](evidence/model-accounting-probe.json)。新隔离技术实验未迁移/重置旧制作账本。提供方仍忽略token参数，不能保证单次硬计费上限。最终58文件240项/lint/无警告build/构建后typecheck/diff-check退出0。整个项目继续开发，C0/C1/C2均未达到，未push或部署。

历史迁移边界复审P2：旧日/其他项目无gate legacy账本可绕过首次初始化。新增精确旧数据fixture先成功（测试退出1），修复为首次必须取得有界、不跟随symlink的所有日账本及项目budget清单；已有calls>0且gate缺失即MODEL_ACCOUNTING_MIGRATION_REQUIRED，不建active:null，不自动迁移或清零。缺清单能力、symlink清单均阻断；只允许全空新作用域初始化。升级时须停止旧worker并先审计历史占用，不能与旧版本并行写账本。新格式跨日故障/重放规则保持不变。

迁移修复最终验证：两轴独立复审关闭P2，无剩余发现；58文件243项、lint、无警告build、构建后typecheck及diff-check退出0。真实单次用量证据保留（没有因只读初始化修复额外付费重跑）。该增量仅本地提交；继续下一阶段开发。

2026-10-03 T06/T09/T12 真实抽帧 Critic 增量：新增严格 sampled_frames 合同、原生 Mastra 多模态 Agent、固定无网 FFmpeg 抽帧与持久审查阶段。真实 Gemini 请求 HTTP200，输入9384/输出10541，实际用量 settled；原报告保留且字体/style及可读性失败，不能作为质量通过。首个本地 inline PNG 解码阻断记录零提供方请求，修复后才显式运行独立技术重测，没有自动重试。复审来源绑定与缓存换帧漏洞后，桥接冻结 Timing/AudioPlan/Execution/Visual来源，并只读重算 PictureSequence/Composite 完整键与实际视频QA；抽帧v2固定输入地址回执阻止自行重签manifest换时间点。两轴独立复审无剩余实质发现；真实movie只读验证禁网通过，四帧cold-copy、字节篡改与第324帧冒充第60帧重签缓存拒绝均通过。历史付费报告与v2四帧SHA完全一致，零新增调用重新校验绑定，仍qualityPassed=false。完整回归62文件251项、lint/build/构建后typecheck退出0。详见 evidence/visual-critic-validation.md；T06/T09/T12仍partial，尚未接通用户预览/批准/正式render与全片两轮QA，43风格86基线未运行，C0/C1/C2未达到，deployed=false。

2026-10-03 T04/T06 原生聊天增量：默认Worker切换Mastra objectStream，真实delta立即持久SSE，结束后usage对账与严格语义验证；原等完整reply后拆事件路径已删除。真实Gemini HTTP200首delta8.002s、全10.646s、3片段、4110/1807 settled，零重试。缺模块、停止/错误partial、冷启动partial、长中文事件过16KiB、fsync后确认丢失均先失败后修复通过。独立取消边界探针确认制作lane保留；大片段Unicode安全1024切分，归档前重读durable log，日志不可读保持running可恢复。完整63文件258项、lint/build/构建后typecheck退出0。详见 evidence/director-stream-validation.md。T04/T06仍partial，16项完整Agent行为评估和预览到导出闭环未完成，deployed=false；无push/生产部署。

2026-10-03 T03/T07/T11 预览命令/自动节选增量：显式prepare_preview冻结brief/Understanding/consent及三个UUID；同命令重放和派发失败补队列、owner/版本/pending/busy拒绝通过。并发重复命令遇Worker已claim原先IDEMPOTENCY_CONFLICT，RED后改只比较不可变输入。自动选择真实来源6–12s最多五段，保护完整旁白/字幕窗口；分数ms、五段上限、真实整句候选、贪心卡死、<6s安全子镜头均经独立审查RED→GREEN，有界DP完成组合。真实日期+地点节选11s/264帧1280×720/3,538,702B，重放相同零模型，私有artifact未发布指针。完整65文件279项、lint/build/构建后typecheck/diffcheck均0；两轴复审无剩余实质发现。详见 evidence/preview-command-selection-validation.md。既有renderer节选转mono限制保留，未声称声音保真、全片语义QA或用户预览闭环。Worker/API/UI、批准后render、下载/修改/export与43风格86实际基线继续开发；C0/C1/C2未达到，deployed=false，无push/生产部署。

2026-10-03 T11 立体声节选增量：修复原-ac1下混；从核验Composite取channels，v2缓存键/schema2/new namespace固定源声道，源与输出实际Docker QA及artifact envelope一致性严格核验。两项RED（-ac1、stereo envelope+mono metadata未预拒）后GREEN；新真实11s/264帧/1280×720/2ch/3,562,048B节选SHA693795d7…，重放相同，旧mono实物按2ch拒绝，0新增模型。两轴独立真实Docker复审通过。完整65files281tests、lint/build/构建后typecheck/diffcheck0，详见 evidence/stereo-excerpt-validation.md。旧mono证据保留为历史，当前声道限制已关闭；不等于完整听验或用户预览发布。T11 partial，C0/C1/C2未达到，deployed=false，无push或生产部署。
