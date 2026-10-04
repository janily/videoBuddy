# 当前工程交接（更新至2026-10-04）

2026-10-04 T06/T10/T11 最终混音增量：Visual ctx.reset/合成器字幕规则后四实际镜头480帧通过；Audio SDK格式拒绝前usage结算修复，真实HTTP协议RED→GREEN，safe错误分类4例持久SSE/冷读通过。首次$schema失败9048/4233原响应严格对账settled，failed/started不改。新preview五200请求38381/43296全部settled，20秒720p双声道实片SHA7c381b…10492984字节，独立全解码/−14.29LUFS/−4.05dBTP通过，最终ASR第1/3/4句pass，第2洒→撒仍阻断；未Excerpt/Critic/发布。负责人已明确确认最终AAC提取的单句WAV e768…，事实JSON绑定精确question/fullPlan/film/transcript，非正式批准，运行时final proof及同冻结影片的新operation技术继续仍待实现。105文件560测试，lint/build/types通过，两轴clean，完整引用guard已补；见 [验证](evidence/accounted-preview-validation.md)。C0/C1/C2未达到，旧failed/unknown不重置，无push/部署。


2026-10-04 T10/T11/T14 新预览与Canvas确定性诊断：单句可信复核后受限复用原已完成Treatment，新operation/revision实际通过四原WAV、字幕时序、Audio与首镜头。3新增模型请求均200/原响应归档/settled，实际23467 input+23213 output；第二镜头原可信renderer报NONDETERMINISTIC_SCENE，预览未发布。默认/software/readback复现，ctx.reset九采样SHA一致；唯一替换clearRect的派生源码另存完整5秒120帧720p真实render+全解码通过，technical_only/deliveryEligible=false，原source/失败op/control/预算在诊断不变。复用来源丢命令禁止回退，诊断原子准入/fsync/固定脚本副本及并发冷拒绝修复，两轴clean。后续接受限技术修复流程、完整预览Critic及43风格等仍待完成，C0/C1/C2未达到，无push/部署。见 [验证](evidence/reviewed-preview-validation.md)。


2026-10-04 T10/T11/T14 可信试听复核增量：负责人实际单句确认已持久化并绑定原WAV/完整plan/transcript/词时间，生产Voice阶段及冷包可区分ASR pass/trusted_review，原洒→撒识别与失败op不改；最终AAC仍独立核。原四WAV实测3匹配+1明确复核、两新增ASR completed/冷恢复归档通过，0network/provider，原control/budget/operation未改。固定确认槽防JSON迁移、取消保留历史事实、新lookup仍当前epoch、首import消环、ZIP非授权审计/无owner/chat及FilmSpec完整plan绑定已实际RED→修复，双轴复审clean。最终103文件551项、lint/build/构建后types/diffcheck通过，见 [试听复核验证](evidence/spoken-review-validation.md)。公共试听入口/完整预览后续链仍待接，C0/C1/C2未达到；不重置旧failed/unknown，无push/部署。


2026-10-04 升级语音新主题终态：独立seed-oD7Sxk / project4a5c6131…，真实Director stream与Treatment两调用settled（4993/2509、4346/3350），四原TTS完成。第1句ASR通过，第2句洒下→撒下保留ASR_MISMATCH，后两句未核；operation failed/attention/no preview。旧项目与unknown未改，不覆盖旧new-theme报告。AT079试听复核的实际原音频已准备，等待负责人判断；费用授权不代替豁免。继续独立功能，见 [新主题结果](evidence/new-theme-upgraded-validation.md)。


2026-10-04 medium生产ASR已接通并真实六句通过：原四中文/日期/英文WAV SHA不变，六completed固定stdout+冷mustExist重读一致，0network，原control/预算未改。默认small/旧cachekey保留，medium明确选型并核实际model，词时间guard不变。首镜像权限unknown保留；文件0444/目录0555非root构建RED→GREEN，最终镜像caa3fca…；102文件541单元+lint/build/构建后types、Python2测试通过，两轴clean。见 [运行时验证](evidence/asr-medium-runtime-validation.md)。正在独立root执行升级语音的新主题真实preview，尚未验收影片，C0/C1/C2未达到。


2026-10-04 medium 真实诊断：原第三句綠芽及词时间通过；原20秒完整上下文文本正确，但芽14840–14840零长度，保留 ASR_TIMINGS_UNAVAILABLE。两个持久回执completed、0network、原WAV/control/预算未改；固定模型四SHA已核，最初下载截断/官方206补齐证据保留。未提升生产ASR/发布预览，C0/C1/C2未达到；下一步固定medium运行时逐句核全部原音频。见 [medium验证](evidence/asr-medium-validation.md)。


2026-10-04 最新完整上下文诊断：原四句PCM按冻结时窗进入20秒24k轨，480000samples、四窗逐字节相同；固定盲ASR仍綠牙，保留ASR_MISMATCH。两owned持久回执completed、无遗留容器、0network、原plan/control/预算不变。归档depth10错误与恢复丢SHA的P2都已修复，实际隔离失败→只读恢复保留同SHA与原失败，两轴clean；见 [上下文验证](evidence/asr-context-validation.md)。英文日期已过、原中文四句仍3/4；下一步按04§5.2升级独立ASR模型核同一音频，不能改预期或豁免同音差异。C0/C1/C2继续未达到。

2026-10-04 最新英文日期表示修正：只对英文月名+1–31日合法序数规范化比较，原expected与音频不改；错误日期/月份/suffix及青禾清和、绿芽绿牙继续拒绝。3新增RED→GREEN、102文件536单元与lint/build/构建后types通过，双轴clean。原六WAV/原blind transcript只读mustExist复核5通过1失败，0producer/provider/network，原source control/预算不变；旧4/2报告原样保留。原四句仍3/4，绿芽→綠牙仍blocked，未发布预览。见 [英文日期验证](evidence/asr-date-normalization-validation.md)。下一步诊断原音频上下文，不自动降低门槛。

videoBuddy 已在仓库根目录开发，原 `.git`、origin、design 与交付文档保留；未 push、未生产部署。真实模型已调用并保留历史对账与未知调用记录，费用授权不限次数/上限。当前仍是阶段工程，C0/C1/C2 均未达到。用户已将 Vercel 方案改为完全自托管；以 [自托管架构](self-hosted-architecture.md) 和 [执行计划](self-hosted-plan.md) 为当前部署依据，原规格的产品功能、SSE、持久消息、43 风格及验收范围继续有效。

最新真实新主题：独立种子发芽中文场景走实际 Director stream/原消息归档/preparePreview intent/队列/Worker/pipeline，2次远端调用两条settled，响应SHA与actual usage4992/1893及4290/4737核证。四实际TTS生成，第二句“大地”ASR成“大的”，保持ASR_MISMATCH/failed、无预览或结果。旧固定语音镜像实际phonemizer将名词“大地/土地”的地无条件转成de5。当前前端修正已完成实际RED→9个GREEN（另修GPT-4片段/连接符），应用533单元及lint/build/构建后types通过；最终镜像b145374e…构建/依赖检查/无网9tests已通过，六条真实TTS全部生成、独立ASR四通过两失败：原“大地”句修复通过；原第三句绿芽→绿牙和英文eighth→8th仍ASR_MISMATCH，不算整段旁白完成。两个APT构建失败及中间未固定构建工具的镜像记录保留。下一步处理剩余中文识别与英文序数表示差异，再继续完整新主题链路，不再只推进journal小切片。实际声音/失败记录见 [旁白验证](evidence/voice-front-end-validation.md)，最初模型链路见 [新主题验证](evidence/new-theme-validation.md)。原unknown和质量失败不变，费用不是阻断。

最新 T13/T14：正式画面拼接、合成和 postmix/ASR 接入当前项目/operation 持久 Docker journal；画面 cancel 抛错或仍 cancelling 保留 MEDIA_STOP_UNKNOWN。Spec发现缓存绕过unknown，已关闭：五缓存核sameargs completed，ASR同时核固定stdout。102文件533单元、lint/build/构建后types通过。实际隔离诊断20秒1080p stereo、两个completed回执、cold mustExist重读SHA相同、0network/原control不变，见 [正式渲染记录验证](evidence/approved-render-journal-validation.md)。此前 sound/master host SIGKILL后核同资源冷停止证据保留于 [持久资源验证](evidence/docker-journal-validation.md)。本次不是全链物理清理或正式影片QA，公共unknown标记不自动解除；旁白 postmix journal 的实际执行、detached镜头/TTS/抽帧/QA/导出全部资源覆盖仍缺。修改准入、新revision、正式新主题有旁白影片完整QA/发布、全部43风格86基线与最终验收继续未完成。下文按日期保留历史，不把旧通过计作本次验证。

已替换 Blob/Workflow/Sandbox：生产 `FileStore` 使用 Python `fcntl` 跨进程 CAS、原子写入和持久卷；本地持久操作队列与独占 Worker 执行 Director；事件日志支撑 SSE 续流；私有产物使用短期签名下载；Docker 媒体执行器使用固定镜像 ID、无网络和资源约束。本地素材 API 验证实际字节、MIME 签名和同内容重放；Markdown 与文本层 PDF 发布不可变真实文本分析，附件消息持久归档，Director 读取原文并以实际行号/页码引文验证材料来源。独立资料 Worker 在受限容器中解析 PDF；扫描件无文本层时明确失败并解除 pending。现有“添加资料”支持 Markdown/PDF 直传、明确权利确认、失败重试、刷新恢复待发附件和空文本发送。原设计与布局未重做。

近期基础验证：Node 22.23.1，`npm ci --ignore-scripts --no-audit` 退出0；此前 `npm test` 36文件158项通过，`npm run typecheck`、`npm run lint`、`npm run build` 均退出0；Playwright 17项在此前UI检查中通过；Python runner 3项通过。锁定依赖的固定 Docker 镜像 `sha256:75ffd41e…` 已构建，1秒中文2D/H.264最小探针、无网络、运行中停止、随机画面拒绝和容器清理测试通过；独立技术 QA 复核文件哈希、元数据及完整解码；PDF 实际上传/受限容器解析/来源发布与扫描件失败实测通过，见 [pdf-probe.json](evidence/pdf-probe.json)。原媒体探针文件仍记录上一镜像，最新镜像复测命令退出0；这不代表真实用户视频内容、完整QA或风格基线完成。

离线声音增量：固定 `sha256:831c0ff8261e75468b3a6868ca29f5b3fd1eee6b222031912eff4e13071e6e64` 语音镜像在无网络、只读根目录的容器中，以两条新输入实际生成 24 kHz 中英文 WAV；受限媒体镜像将旁白放在 1 秒与 8 秒位置，输出准确 960,000 采样/20 秒的 48 kHz 轨，并验证发声与静音窗口、空旁白意图、同 stage 重放，见 [voice-probe.json](evidence/voice-probe.json)。独立离线 ASR 固定镜像 `sha256:c0238dfb63f981905ddd4a13d1658fc5e2915d339bc1ad25036fd2ca79ba5fa4` 只读声音和语言，不读预期文案；中文“十月八日”与识别出的“10月8日”按日期数值核对，两种语言均有实际词级时间，见 [asr-probe.json](evidence/asr-probe.json)。一次真实探针因模型输出不匹配而退出1，随后新生成的音频通过；此波动必须保留为制作风险，不能更改预期台词掩盖。当时 `npm test` 34文件151项、lint/build/Python语法及构建结束后的typecheck均退出0；并发build/typecheck曾因 `.next/types/routes.js` 生成竞态暂时退出2，顺序复跑通过。未做特殊人名/生僻字听验、配乐音效、响度母带或完整成片QA，不代表T10完成。

字幕与合成增量：`compileSubtitles` 使用实测语音时长、词时间、阅读速度和24/30/60 fps帧边界；从锁定媒体镜像查询 Noto CJK SC 实际 44,810 字形后才输出 SRT，见 [subtitle-probe.json](evidence/subtitle-probe.json) 和 [SRT](evidence/subtitle-probe.srt)。`composeVideo` 在隔离容器中合成画面、48 kHz旁白和烧录字幕，输出 AAC/H.264并经独立ffprobe/全片解码核验。20秒、320×180、24fps技术场景及无旁白纯静音成片均实测通过，见 [composition-probe.json](evidence/composition-probe.json) 及中文、空档、英文三个抽帧。抽帧可见字幕只在对应时段出现。当时增量回归 `npm test` 36文件158项、lint/build/顺序typecheck退出0。这是技术链路证据，不是模型生成的用户成片或43风格基线；1080p、风格字幕样式、配乐/音效混音、听验与发布门槛仍未过。

成片音轨复核增量：从合成后的真实 AAC/MP4 中提取两条语音窗口，离线 ASR 再次识别，中文12词、英文5词均与不可变预期文案相符；无旁白成片解码全程48 kHz PCM 后，实测为纯静音才返回 `not_applicable`。成片哈希、提取音频哈希和结果记录在 [composition-probe.json](evidence/composition-probe.json)。静音成片实际解码得到960,512采样，比20秒原轨多512采样；首次严格按 PCM 原轨采样数检查 AAC 解码，因这一编码帧差异退出 `AUDIO_DURATION_INVALID`；现仅在成片复核允许最多1024采样差，原始轨仍精确检查。当时 `npm test` 37文件160项、lint、build和构建后的typecheck均退出0，真实合成/复核探针退出0。此结果只证明两句短语音和一个静音技术场景，不覆盖音乐/音效、特殊发音、听验或真实用户影片。

响度门槛增量：固定媒体镜像对最终AAC独立运行FFmpeg `loudnorm` 测量。未归一化技术成片实测 -25.93 LUFS，失败；仅加单级归一化仍为 -15.57 LUFS/-1.19 dBTP，失败。合成器现先压缩再归一化，并在独立技术QA后硬性检查 -14±1 LUFS 与真峰值≤-1.2 dBTP；上一20秒样本实测 -14.41 LUFS/-1.49 dBTP，通过。纯静音成片实测后标记响度 `not_applicable`。中文最终ASR有时输出繁体，固定 `opencc-js@1.4.1` 仅在比较时做简繁正字归一化，原始期望文案不可修改，错误日期仍拒绝。见 [composition-probe.json](evidence/composition-probe.json)。这只覆盖旁白技术混音，不覆盖配乐、音效、听感或43风格；`qaStatus` 仍是 `semantic_not_checked`。最终代码完整回归 `npm test` 38文件163项、lint、build、构建后typecheck和真实合成/复核探针均退出0。

T05 语音素材增量：固定 ASR 镜像更新为 `sha256:67786e6dbdd6b00f6177441e64272b622f844fc6c69b39970543afa92cc4895c`，保留原中英文台词复核，并新增对上传语音的自动语言识别。新版ASR镜像下20秒技术片再测 -14.44 LUFS/-1.49 dBTP、中英文成片ASR通过。Source Worker 对明确语音用途、0.2–120秒的上传音频先用受限 FFmpeg 探测/转换（声明支持 WAV/MP3/M4A，此轮仅实测 WAV），再运行独立离线 ASR，将时间段、原文件哈希、解码 WAV 哈希、镜像摘要与不可信转录原文持久归档；Director 只能用 `time:起止毫秒` 与实际段落摘录引用事实。真实4.1秒离线TTS WAV作为上传技术素材，Worker 独立处理后 `ready`、briefVersion=1、inputPending=false，识别上海与10月8日；同字节但标“配乐”的上传明确失败 `AUDIO_MUSIC_UNSUPPORTED` 且解除 pending，不把音乐误作语音事实，见 [source-audio-probe.json](evidence/source-audio-probe.json)。进一步实测52秒机械重复语音被识别器漏掉大段，声音覆盖门槛以 `AUDIO_TRANSCRIPT_INCOMPLETE` 阻断；14条不同句子拼成56.525秒语音，三片带2秒上下文重叠的ASR均覆盖有声时段并归档为ready，见同一证据。该转录仍将“黄浦”听成“黄埔”、“晚间”听成“万间”，因此仅作为不可信素材，关键事实需用户核实。尚未验证用户实录、音乐/环境声或图像内容。最新 `npm test` 39文件167项、lint/build/构建后typecheck与56.525秒真实处理探针均退出0。

媒体技术 QA 增量：独立 ffprobe 现在硬性核对 H.264/yuv420p 与 BT.709 色彩三元组，MP4 顶层原子扫描确认 `moov` 在 `mdat` 前；1秒媒体探针、停止与随机画面拒绝仍通过。20秒320×180技术场景第7秒左上角已知背景 RGB (24,48,74) 解码实测 (20,45,74)，最大通道误差4，见更新的 [composition-probe.json](evidence/composition-probe.json)。这些检查只覆盖一个已知颜色和容器格式，不能替代全片色彩/视觉/字幕检查。最新完整 `npm test` 39文件168项、lint、build、构建后typecheck、1秒媒体探针与20秒合成探针均退出0。

T11 预览基础设施增量：`createPreviewBundle` 将 FilmSpec、完整脚本与事实、源码/时间轴/音轨/素材/字体摘要、输出 profile、运行时和质量策略锁入规范 JSON 的 `bundleHash`；预览文件摘要单独校验，过期时间与预览文件不参与内容哈希。`commitPreviewBundle` 先持久化不可变 manifest，再通过 ProjectControl CAS 核对 briefVersion、inputPending、consentEpoch、制作槽和阶段，旧任务不能将过期预览发布为当前预览。ProjectView 只暴露用户需看的文案、关键事实与预览标识，不暴露内部存储引用。预览包/持久化测试先因模块缺失退出1，随后7项通过；全套 `npm test` 39文件172项、lint、build、构建后typecheck均退出0。其后 `approvePreview` 的缺模块红灯退出1，新增唯一 `preview_button` 批准记录、可重试命令凭据、原子制作槽及持久队列意图；同命令重复点击、不同命令并发、过期和错误哈希局部测试共10项通过，完整 `npm test` 39文件175项、build/typecheck退出0。lint退出0但先提示一个测试变量未使用，已修正并单独复核。当前仍没有真实创作预览、用户批准入口或 render Worker；UI主按钮继续禁用，T11仍partial。

T12 发布边界增量：通用 `qualityGate` 已拒绝将必检项降为 warning 或重复同一 ruleId；`validateDelivery` 强制14类基础报告、锁定的质量策略摘要、最终文件摘要，未听验/未核版权/缺证据均阻断；静音 N/A 需额外 `decoded_silence` 通过且留证。`publishResult` 核对不可变 preview/approval/result 的 hash 和 owner、实际存储文件字节 SHA、操作 fence/consentEpoch，再以 ProjectControl CAS 切换结果指针；ProjectView 可投影当前/上一结果。局部测试先因缺模块和 warning 漏洞退出1，随后通过；全套 `npm test` 40文件180项、lint、build、构建后typecheck均退出0。发布测试中的100字节“媒体”只是验证 CAS 与哈希拒绝路径的夹具，绝非真实影片/真实 QA；本模块尚无对外发布入口，真实渲染、独立视觉/听验报告来源、完整产物写入与下载闭环未接通，T12仍partial。

T13 取消制作增量：现有 `/operations/:id/cancel` 已支持 `scope=production`；服务先通过 ProjectControl CAS 撤销活跃制作槽、递增 consentEpoch、记录 cancelRequested，再改变操作 fence/状态。排队未 claim 的任务会直接取消，运行任务进入 `cancelling`；重复请求不重复递增，旧操作不能取消新操作或原结果。AT-039 从模拟控制态变化改为实际调用 `cancelProduction`，迟到发布被拒。`npm test` 40文件182项、lint、build、构建后typecheck均退出0。运行中媒体容器的停止/清理和状态终结仍待 render Worker 集成，T13仍partial。

T13/T14 恢复上一版增量：`restoreResult` 依照规范路径 `/results/:artifactId/restore` 接入服务端；核对前一版 manifest、已保存产物授权及磁盘文件实际 SHA 后，通过 ProjectControl CAS 交换 current/previous 指针并递增 consentEpoch，旧修改计划因此失效。同一命令重试不会再次交换；错误目标或文件被篡改会拒绝。未重渲染，局部测试因缺模块先退出1，随后通过；全套 `npm test` 40文件183项、lint、build、构建后typecheck均退出0。当前只支持上一版，历史多版本恢复、UI入口和实际用户成片恢复验收仍缺。

T11 存储闭环增量：`commitPreviewBundle` 不再接受调用方传入的“实际hash”；必须找到同项目、同revision、已标记上传和QA通过的私有MP4记录，再从卷读取真实字节核对 SHA 后才能 CAS 发布 `preview_ready`。缺产物、同ID换包或字节篡改均拒绝。测试先对缺文件得到错误 `STORE_NOT_FOUND`，改为明确 `PREVIEW_ARTIFACT_MISMATCH` 后通过；全套 `npm test` 40文件184项、lint、build、构建后typecheck均退出0。测试中的短字节文件只验证持久化与哈希边界，未通过实际媒体解码；真正预览仍待真实创作链和QA。

T14 产物访问增量：公开 `resolveArtifact` 现在要求产物同时被当前预览、当前结果或保留的上一版指针引用；内部 `inspectArtifact` 用于发布前核验，不能签发外部URL。此前仅 QA 标记通过就能签发同项目未发布产物的测试实际失败，改为指针绑定后通过；预览/正式结果在提交指针前拒绝、提交后可解析。`npm test` 40文件184项、lint、build、构建后typecheck均退出0。实际播放与导出体验仍未完成。

T11 真实节选渲染增量：`renderPreviewExcerpt` 从已独立验证 SHA/完整解码的20秒源片，按帧和48 kHz采样区间剪接三段，生成同画面同声音、带烧录字幕的12秒 H.264/AAC 节选，再独立核验 MP4 faststart、BT.709、帧率/时长、文件哈希和全片解码。首轮把中文旁白在4秒切断，节选ASR实际 `ASR_MISMATCH` 退出1；未改预期文案，改为保留完整句，并加上任何被选中的旁白窗口必须被单个片段完整覆盖的拒绝规则。最终320×180技术片节选157,827字节，SHA `e5ddf6be…`，中英文节选后ASR均通过，解码音轨非静音且已知背景像素误差4；中文、英文、无字幕空档三张预览抽帧已目视检查，见 [composition-probe.json](evidence/composition-probe.json) 与 [预览抽帧](evidence/preview-caption-zh.png)。`npm test` 41文件187项、lint、build、构建后typecheck、真实20秒合成与12秒节选探针均退出0。仅证明确定性技术场景的复合节选，不是模型生成的新主题预览；节选还未存为项目产物，也没有预览Worker/API、真实用户审批和43风格基线。

2026-10-03 T01 制作契约增量：新增严格 FilmSpec/Timeline Zod 契约和交叉校验，覆盖1920×1080/1080×1920 目标profile、43目录中的风格版本/commit、20–120秒统一帧采样时钟、完整section/shot覆盖、明确双边crossfade且不得三镜重叠、cue绝对时间量化、旁白/音效/字幕边界与声明引用。`verifyFilmPackageRefs` 从本地持久存储重新读取7个不可变JSON引用并核对规范JSON字节数/SHA及Timeline内容；真实CAS篡改后拒绝。1微秒音频事件现在记录实际48 kHz采样误差，不再虚报0。新增测试先因模块缺失、伪造量化误差、三镜重叠等分别失败，再修复；最终`npm test` 42文件191项、lint、build、构建后typecheck退出0。当前引用集合仍由可信调用方传入，尚未从实际素材/事实manifest派生，模型尚未产生真实FilmSpec，也未接入预览Worker；这是契约基础，T01/T11仍partial。

2026-10-03 T11 自托管节选落盘增量：新增 `stagePreviewArtifact`，只接受与固定媒体运行时及节选stageKey对应的实际文件；对源片标识/节选映射/目标profile重算stageKey，复跑独立MP4全片解码与技术QA，核对SHA/字节数后用临时文件、fsync和排他硬链接写入私有对象卷，再持久化不可变artifact manifest。真实20秒技术片本轮生成12秒节选157,770字节，SHA `eda8dc33…`；同ID重放相同哈希，提交项目预览指针前公开访问拒绝，伪造源片哈希及篡改私有字节均拒绝，见 [composition-probe.json](evidence/composition-probe.json)。真实容器探针、`npm test` 42文件191项、lint、build和构建后typecheck均退出0。该临时技术项目没有生成FilmSpec或公开预览，仍未接通项目预览Worker/API、用户批准和正式视频。

2026-10-03 T01 制作包来源增量：新增 `loadVerifiedFilmPackage`，从七个项目/修订版不可变引用读取规范JSON、重算SHA与字节数，再严格解析理解、处理方案、事实、素材、源码及音频清单；可引用的镜头模块、演员、字幕样式、声音来源与bus全部由这些存储清单推导，不接受调用方直接传白名单。事实必须与冻结的Understanding逐项一致且有用户消息/已声明素材来源；上传素材必须出现在Understanding的assetUses中，并核验分析记录ID与权利来源。缺源码模块、虚构事实、过期brief、未授权素材和CAS篡改后的时间轴测试均拒绝。旧外部白名单包校验入口已移除。新测试先因模块缺失失败；首轮lint发现局部变量名触发Next规则，修正后`npm test` 43文件191项、lint、build、构建后typecheck退出0。此处核对清单结构与持久化来源，不证明模型创作、HTML安全可执行、真实素材版权或音频可用；预览Worker还未消费该包，T01/T11继续partial。

2026-10-03 T11 预览发布绑定增量：`commitPreviewBundle` 和 `readPreviewBundle` 现重读真实FilmSpec及七份清单，再把项目/revision/brief、完整文案、事实文本、概要、源码/时间轴/音频摘要、素材hash、输出profile/媒体运行时、节选所指镜头和实际旁白窗口与预览包核对。改FilmSpec摘要并重算预览包hash曾实际让旧实现将控制态切到`preview_ready`，新增失败用例后修复；同样拒绝重新签名的错误脚本、无效shotId，以及提交后归档FilmSpec被CAS篡改再读取。过期与唯一批准用例改用真实持久制作包fixture；文件哈希/并发/取消测试保持。完整`npm test` 43文件191项、lint、build、构建后typecheck退出0。测试里的100字节“MP4”只检验存储/状态边界，不是媒体QA；真实模型制作包、实际预览Worker/API、可操作批准UI仍未完成，T11 partial。

主要缺项：T05 扫描 PDF、图片、配乐/环境声及长音频用户实录的可靠解读，超长 Markdown/PDF 的分段检索；Visual/Audio/Critic 及16行为评估；T10 的特殊词发音复核、可靠字幕对齐、配乐音效与完整声音 QA；真实预览、审批、正式制作、独立QA与发布；修改/取消/导出完整闭环；43风格86条真实视听基线；备份恢复、安全/故障演练和5名新用户观察。图片仍仅到 `uploaded`，不会被当作已分析的事实；语音只有真实ASR与有声覆盖检查通过才会 `ready`。精确现状见 [阻断记录](blockers.md) 和 [任务记录](task-ledger.md)。

2026-10-03 T06/T11 Treatment 增量：Director 已有严格 TreatmentPlan 输出与冻结 STYLE/Understanding 输入；FilmSpec 的 Treatment 清单强制引用不可变方案，并与脚本、事实和逐镜头 Timeline 核对。自托管 Treatment 阶段使用预算预留和持久 effect ledger，验证重复调用、执行中版本变化和未知模型调用的处理。测试先因缺阶段模块失败，完成后全套 `npm test` 45文件194项、lint、build、构建后typecheck退出0。本地假提供方仅验证 Mastra 适配协议；缺真实 `MODEL_API_KEY`、Director 模型 ID/服务地址与付费调用授权，未验证模型产出的创意或质量。预览 Worker/API、Visual/Audio/Critic、正式渲染和43风格基线仍缺，C0/C1/C2未达到。

T10/T11 新增冻结 Treatment 到旁白时窗的纯编译器；台词和ASR期望保持原文，过长明确失败，`none` 不发声，用户录音未接通时报错。真实预览尚未调用这个编译器或离线TTS/ASR。

2026-10-03 T10/T11 更新：`prepareVoiceStage` 现读取持久化 Treatment 与 Understanding，经实际离线TTS和ASR核验后才写入不可变旁白计划及清单；重复执行复查实际 WAV 字节SHA。新增ASR语音来源哈希核对，错误来源测试先失败再通过；阶段测试拒绝文件篡改与执行中授权撤销。固定ASR镜像重新构建为 `sha256:67786e6d…`，一条中文台词真实项目阶段探针通过，见 [voice-stage-probe.json](evidence/voice-stage-probe.json)。全套 `npm test` 47文件196项、lint、build和构建后typecheck退出0。音轨混音、字幕、画面、预览Worker/API仍未接通；此探针不证明真实预览。

2026-10-03 T10/T11 时间轴更新：新增 `prepareTimingStage`，从已冻结Treatment和已经核验的语音阶段实际生成48 kHz旁白轨、读取锁定Noto CJK字形、编译字幕帧，并把镜头/采样/字幕/音轨哈希写成不可变 TimingDraft。仅通过已存在语音记录的读取模式运行，重复执行复验实际音轨字节。联合单测检测音轨篡改；真实三镜像 [timing-stage-probe.json](evidence/timing-stage-probe.json) 记录20秒480帧、960,000采样、113帧字幕与重放一致。完整测试结果见任务记录。仍无Visual源码、FilmTimeline最终源引用、预览视频与用户入口，草稿状态为`semantic_not_checked`。

2026-10-03 T06/T11 Visual增量：新增镜头级Visual Mastra适配器、严格HTML源码契约及持久化阶段；输入只取冻结Treatment/TimingDraft/STYLE，外部模型调用有预算与不可自动重试的effect记录，源码归档复读SHA，控制态变更拒绝迟到结果。本地假模型验证协议与持久化边界，静态源码校验通过不代表运行时画面或风格质量；阶段状态为`not_checked`。缺真实Visual模型配置与付费调用授权，尚未做真实模型输出、媒体探针和43风格执行适配。

T03/T06 修复预算拒绝后的错误未知效果：Director、Treatment、Visual 均先执行幂等预算预留，再创建可能调用外部模型的 effect 记录。新增失败→通过测试证明预算不足且模型尚未调用时，调整限额可安全重试；真正未知的外部调用继续阻断自动重试。

下一步继续 T05 素材分析，并将真实媒体执行器接入预览与正式制作，完成音频、独立 QA 和取消清理。生产总开关默认关闭。不要把最小探针、技术节选、单测、目录规则或交付原型视频当作完整媒体验收。

2026-10-03 T09/T11 画面阶段：`prepareVisualShotStage` 现可只读取和重验已归档 Visual 源码，不触发模型调用。`preparePictureShotStage` 用已冻结源码与 TimingDraft 派生逐镜、按 consentEpoch 隔离的 Docker 任务；实际 MP4 经独立全解码/BT.709/哈希QA 后才保存阶段记录，重放再验磁盘文件。真实技术探针以合成HTML渲染 20 秒480帧、320×180 画面，21,718字节、SHA `c2a55d9d…`，见 [picture-stage-probe.json](evidence/picture-stage-probe.json)。首次因媒体运行时环境未设置而拒绝；修复探针配置后通过。完整测试 49文件199项、lint/build/typecheck通过。此阶段尚未拼接镜头与音轨、生成真实项目预览，也未运行模型生成源码或任何风格基线；含素材的Visual源当前明确 `VISUAL_ASSET_RUNTIME_UNAVAILABLE`，避免把无素材画面算通过。

2026-10-03 T09/T11 多镜头更新：新增自托管 `picture-sequence` 媒体合成器和项目持久阶段，只读取同revision已校验的逐镜产物，要求时间轴无帧缺口/重叠，输出再次做独立全片解码与精确帧数检查。两个不同颜色的真实10秒容器片段已拼接为20秒480帧技术片，前后抽帧像素、SHA及重放证据见 [picture-sequence-probe.json](evidence/picture-sequence-probe.json)。单测首次缺模块失败；抽1×1像素的首轮探针因YUV420裁剪失败，改为2×2后通过。完整50文件201项、lint/build/typecheck通过。项目阶段本身仅用注入QA测试，真实探针只覆盖底层合成器；尚未把旁白轨、字幕、预览节选和UI接上，也没有模型生成画面/43风格验收。

2026-10-03 T10/T11 合成阶段更新：`prepareCompositeStage` 已把项目级冻结 Voice/Timing/PictureSequence 连接到本地真实 `composeVideo`，最终文件要同时过H.264/AAC/帧数/全解码、响度和成片后ASR才能保存；重放核对落盘字节。真实技术brief的320×180/20秒项目跑通离线旁白、字幕烧录和成片后12词ASR，-14.2 LUFS/-1.5 dBTP，证据见 [composite-stage-probe.json](evidence/composite-stage-probe.json)。探针已经验证其画面Docker容器退出后被清理。完整50文件201项、lint/build/typecheck通过。此产物标记`semantic_not_checked`，没有模型生成新主题、风格QA、完整预览/审批或用户交付。

2026-10-03 T11 私有预览阶段更新：`preparePreviewExcerptStage` 已从同项目完整音画与TimingDraft生成按帧精确、不中断旁白的6–12秒节选，并以持久intent固定artifactId，独立QA后保存实际私有MP4；重放复核磁盘与私有对象。720p profile采用1920×1080逻辑构图、1280×720实际文件。真实技术brief的[720p节选证据](evidence/preview-720-stage-probe.json)为9秒216帧、143,214字节、SHA `06f7bc52…`，对应720p完整音画的成片后ASR与响度亦通过；未提交项目预览指针前，公开访问正确拒绝。局部测试覆盖错镜头、截断旁白、同revision换map、文件篡改；全套50文件201项、lint/build/typecheck通过。仍缺真实FilmSpec、质量报告、预览发布Worker/API及可播放/批准UI，43风格/1080p/素材/模型验收也没有完成。

2026-10-03 T10/T11 持久旁白包：旁白现按实际字节SHA进入私有对象卷，来源JSON与逐词时间可直接用于FilmTimeline；`prepareNarrationPackageStage` 读取已冻结Voice/Timing、核对fence并归档，Composite schemaVersion=2锁定其哈希。FilmSpec读取要与冻结台词及实际WAV/ASR记录一致，错误日期/遗漏声音/篡改文件均拒绝。OS锁保护发布与恢复；实际子进程在link后退出73，冷读取核验哈希后清理同inode临时别名，未知硬链接仍拒绝。真实4.1秒中文TTS/ASR删除原voice目录后独立读取通过；720p合成与9秒私有节选亦复跑通过，见 [验证报告](evidence/narration-package-validation.md)。最终51文件205测试、lint/build/typecheck通过，两项审查无剩余局部发现。工作目录删除后的Voice/Timing阶段重放未实现；下一步应从实际Treatment/Visual/Timing/旁白包组装FilmSpec，补真正Audio计划、音乐/音效与独立QA后接预览发布Worker/API/UI，不得以默认无音乐或虚构bpm/镜头描述填补计划。仍未达到C0/C1/C2，生产开关关闭，未push/部署。


2026-10-03 T11/T07/T14 预览入口增量：页面按钮→幂等POST→持久preview队列→Worker实际阶段→Critic阻断门槛→冻结包/真实字节发布→私有播放器已接通。配置预检先于付费；失败结果先控制态CAS再固定归档/持久SSE，可承受fsync前后ACK丢失而不重跑模型。冷队列恢复遗失enqueue，损坏队列记录不阻塞健康任务；冷页面按brief/consent读取最新失败说明。播放续签保留同一DOM及暂停/播放位置，playsInline已验证。完整单测67文件295项，浏览器18项，lint/build/构建后typecheck通过，两项独立审查无剩余实质发现；证据见 [预览验证](evidence/preview-publication-validation.md)。真实11秒/720p/双声道MP4通过桌面与手机实际HTTP解码播放；续签错误事件为明确注入，媒体/授权仍走实际服务。新增模型调用0，原真实项目control未修改。此诊断发布为technical_only、deliveryEligible=false，不能算新主题完整模型闭环或历史Critic失败通过。正式制作按钮仍disabled；T12正式1080p渲染/全片QA、T13修改、T14导出/清理、T15–18全部43风格86基线及T21验收继续未完成；C0/C1/C2未达到。未push/部署。


2026-10-03 T12 冻结批准画面增量：新增独立approved-inputs与pictures阶段，正式running operation逐项绑定owner/approval/command/revision/bundle/Understanding/fence/consent；只编译冻结HTML为1080p任务，不放宽preparing_preview fence、不重新调用创作模型。真实隔离项目完整画面1920×1080/20秒/480帧/16,695,765字节/SHA c2a7ff0d…，独立全解码与冷重放通过，0新增模型调用，currentResult未发布。单镜timeout/inspect/fence错误均尝试停止同handle并保留unknown；拼接每500ms核授权，先核唯一容器label/image/ID再stop。实际拼接取消容器removed，5822ms。完整68文件300测试通过，两项审查无剩余实质问题；详见 [批准画面验证](evidence/approved-pictures-validation.md)。产物无音轨、technical_only；正式1080p音画/字幕、全片QA、真实听验和最终发布未完成，页面正式按钮继续disabled；后续导出/修改/清理/43风格86基线继续未完成，C0/C1/C2未达到。

2026-10-03 T12 冻结批准音画增量：正式合成读取冻结1080p画面、已归档音轨/字幕和旁白字时间，不重新调用模型。真实20秒/480帧/1920×1080/双声道AAC成片SHA b1c9e6c6…，独立全解码、−14.08 LUFS/−1.5 dBTP及冷重放通过，控制态未改、未发布。正式v4生产容器核输入SHA并原子写实际输出回执；无回执unknown，交换AAC左右声道拒绝。提取/ASR贯穿授权检查并停止唯一所属容器；真实ASR撤销3160ms、无转录归档，拼接撤销6088ms，两容器removed。合法采样小数时长向外取整；旧v3协议保留。完整70文件304测试、lint/build/构建后typecheck通过，两项独立复审无剩余实质发现，0新增模型调用。详见 [批准音画验证](evidence/approved-composition-validation.md)。本片是原已归档无旁白配乐/音效变体，不证明正式旁白/字幕路径、全片视觉/听验或最终发布；正式UI仍disabled。修改/导出/清理/43风格86基线继续未完成，C0/C1/C2未达到，未push/部署。

2026-10-03 T12 全片视觉证据增量：批准成片按冻结时钟生成两轮错开总览，保守覆盖所有镜头约0.2秒动作条，并纳入字幕边界/可读起点。实际1920×1080/20秒成片解码104+124帧记录、29批，来源/PNG回执与冷只读复核一致，控制态未改、未发布、0模型调用。正式Critic分批effect/预算及完整两轮聚合已接，协议测试覆盖漏批/错影片/未知事实/事实warning矛盾强制fail；只读缺stage/PNG/音频证据拒绝，不重生产。effect写盘后与模型记账前后均复查批准，撤销0请求；unknown不重试或退款。完整73文件314测试、lint/build/构建后typecheck通过，两项独立审查无剩余实质问题。详见 [全片视觉验证](evidence/approved-visual-validation.md)。真实VLM判断未执行：原项目7次旧格式预算缺actual usage对账/部署门闩，精确占用副本实证MODEL_ACCOUNTING_MIGRATION_REQUIRED；原账本未改。visualQualityPassed=false，不证明连续运动/听验/最终交付；正式旁白字幕实测、worker/发布/修改/导出/清理/43风格86基线仍未完成，C0/C1/C2未达到。未push/部署。
