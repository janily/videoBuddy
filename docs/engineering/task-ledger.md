# 开发任务与证据

> 2026-10-02 架构变更：以下早期 Vercel/Blob/Workflow/Sandbox 记录仅保留为历史证据，已由 [自托管架构](self-hosted-architecture.md) 与 [执行计划](self-hosted-plan.md) 替代，不再是待索取的凭据。当前仍按原 T00–T21 产品范围验收；C0/C1/C2 未完成。最新本地结果：`npm ci --ignore-scripts --no-audit` 退出0、`npm test` 36文件158项通过、`npm run typecheck` 退出0、`npm run lint` 退出0、`npm run build` 退出0、Playwright 17项此前通过、Python runner 3项通过；原交付包独立校验通过，22任务/22需求/92验收/43风格/86基线目标和60份未改设计文件均匹配。T09 最小 Docker 2D/中文探针通过，真实1秒H.264/320×180/9,249字节、无网络、运行中停止、随机画面拒绝及独立 ffprobe/全解码技术QA证据见 [media-probe.json](evidence/media-probe.json) 和首帧；随后真实语音、字幕与20秒技术合成证据见文末增量记录。付费模型评估、T05 全模态分析、43风格86基线未运行。自托管存储、队列/Worker、SSE、私有下载、本地素材字节 API 与 Markdown/文本 PDF 解析及附件消息已开发并各有局部测试；不能据此标整项 T05/T09/T21 完成。

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

模型预算是保守预约上界：输入按UTF8字节数+4096开销预留、输出2000tokens硬上限；daily先预约，project失败时不自动返还，未知计费不会重试。该行为可少用预算，不会放宽上限。媒体/TTS尚未接入收费入口，不能声称这两类预算已运行。

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
