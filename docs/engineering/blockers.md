# 当前阻断（更新至2026-10-04，自托管架构）

2026-10-04 语音前端增量：复合词词典声调修正、实际规范化后英文片段发现与型号连接符/负数区分，实际9项前端测试通过；应用102文件533项与lint/build/构建后types通过。两个APT构建明确失败（直连80、主机代理拒绝），最终构建使用ASR同digest固定Python base和原Node stage，最终固定工具镜像b145374e…已构建，无网9tests/pipcheck通过。六条真实TTS生成后独立ASR四通过、原绿芽→绿牙与英文eighth→8th两失败，原大地句修复通过，原control/预算不变、0network，不能将前端音素测试计为发音或全片验收。见 [前端验证](evidence/voice-front-end-validation.json)。

2026-10-04 新主题真实验证：2模型响应/用量已完整核证settled，无新增费用unknown。种子发芽四镜头TTS后第二句“润湿大地”识别成“润湿大的”，Worker保持failed/ASR_MISMATCH且不发布。旧固定镜像phonemizer实际确认“大地/土地”末字地错误de5；本轮新镜像已修复且原第二句ASR通过，但原失败Worker不重写，新剩余两项失败见上方最新记录；不是缺云凭据或额度，不能改预期文案掩盖。见 [新主题验证](evidence/new-theme-validation.md)。后续原特殊人名、全片质量/正式改稿/全部风格验收继续缺。

2026-10-04 正式拼接/合成/postmix/ASR journal接线与缓存unknown绕过已修复，102files533单元及构建检查通过；实际20秒1080p stereo诊断两completed冷回执不变，0provider。见 [正式渲染验证](evidence/approved-render-journal-validation.md)。这不是完整资源清理：detached镜头/TTS/抽帧/QA/导出协调和公共unknown解除仍缺，旁白postmix journal还须实测；全片QA/正式改稿/newrevision/43风格86真实基线和用户验收仍未过。费用不是阻断，旧未知模型尝试保留冻结。

2026-10-04 持久资源更新：sound/master已接启动前journal及warm/cold真实终态核验，实际宿主SIGKILL后同容器仍running，cold核验stop/removed成功；100文件520单元及构建检查通过。见 [资源验证及失败记录](evidence/docker-journal-validation.md)。下方历史段落中的“持久handle未实现”仅保留为当时记录：当前基础能力已经实现，但图像/TTS/ASR/合成/导出资源的全面接入、自动恢复协调和公共unknown解除仍未完成，不能算T14整体清理通过。0provider/原control账本未改，无push/部署。

最新：模型凭据与无限费用授权已具备，追加费用不是阻断。全片 Critic 首次真实请求120秒超时，没有原始响应、供应商任务ID或 actual usage，unknown 保持冻结，不能猜测查询或自动重试。99文件505单元与构建检查通过；T13/T14 sound/master阶段授权、公共未知停止归档与断电防重执行已接，见 [音频撤销验证](evidence/audio-production-cancellation-validation.md)。持久容器 handle 查询/核实清理仍未实现；实际探针仅完成后撤销，没有 live-stop 证据。正式改稿、新 revision、全片视听/许可 QA、发布、43风格86真实基线及最终用户验收仍待完成。以下表为2026-10-02历史快照，最新状态以本段及后续日期增量为准。

2026-10-03 最新模型预算授权：用户明确允许后续正式全片和43风格验证“不限次数和费用上限”。追加测试费用不再等待确认。历史只读审计定位全部7次预约，5次原始响应/2次历史报告，3次超预约共1,879输出token；见 [只读审计](evidence/legacy-model-audit-validation.md)。历史缺证据及旧格式运行兼容仍须实现，不清空计数、不将旧质量失败算通过。

Vercel Blob、Sandbox、Workflow 凭据不再需要。用户已要求完全离开 Vercel，历史阻断记录见 Git 历史与 task-ledger.md；当前仍未 push 或生产部署。

| 范围 | 实际状态 | 下一项可验证条件 |
|---|---|---|
| 本地文件 CAS / Worker / SSE / 私有下载 | 局部测试通过；公开下载已要求项目当前预览/当前结果/上一版指针，未发布产物不能提前签发；未做完整故障与压力演练 | 冷启动进程、HTTP 跨进程续流、备份恢复和崩溃注入 |
| Docker 媒体镜像 | 锁定依赖的固定镜像 `sha256:75ffd41e…` 已构建；最小1秒中文2D/H.264、无网络、运行中停止、随机画面拒绝、容器清理及独立 ffprobe/全解码、yuv420p/BT.709/faststart技术 QA 和单个已知RGB像素探针通过；正式流水线未接入 | WebGL、配乐/音效、完整预览/正式制作、语义/字幕/听感 QA 与异常崩溃恢复 |
| T05 素材 | Markdown 与文本层 PDF 的实际字节分析、不可变来源、行号/页码引文验证、附件消息和浏览器直传流程局部通过；明确语音用途的4.1秒与56.525秒上传技术素材经离线ASR与时间引用归档，52秒机械重复语音漏识别被覆盖门槛拒绝；配乐意图明确失败并解除pending；扫描 PDF 实测失败并解除 pending | 扫描 PDF/图片视觉解读、配乐/环境声与用户长音频实录、超长资料分段检索及全模态验收 |
| 真实模型 | 缺 `MODEL_API_KEY`、`VIDEO_DIRECTOR_MODEL`/`VIDEO_VISUAL_MODEL`/`VIDEO_AUDIO_MODEL` 的真实模型 ID、服务地址及付费调用授权；Treatment/Visual/Audio 的本地假提供方只验证协议，未运行真实模型案例 | 配置选定模型及按提供方需要的 `MODEL_BASE_URL` 后执行真实 Director/Treatment/Visual/Audio/Critic 和16行为案例 |
| T10–T14 视频闭环 | 中英文离线TTS、48 kHz旁白轨、独立ASR、按帧SRT/真实字体字形、烧录字幕与AAC/H.264技术合成在20秒320×180场景通过，中文/空档/英文抽帧已目视检查。两句短文案的最终AAC ASR及旁白成片响度/真峰值通过；无旁白成片解码为纯静音。T11不可变预览包、唯一批准记录、同revision私有预览文件字节hash与版本/取消/并发竞态边界测试通过；T12策略哈希、必检报告、真实存储字节hash、取消后的结果指针CAS局部测试通过；T13生产取消API已撤销授权并阻断迟到发布；T13/T14上一版恢复可原子切换且拒绝篡改文件。发布/预览存储测试用短字节夹具，仅测边界，绝非媒体证据。运行中媒体容器清理/终结、真实用户预览/对外批准入口/render Worker/独立完整QA尚无。模型曾有真实不匹配，流程正确阻断。音乐/音效及其混音母带、1080p/43风格字幕、听验、模型生成内容的完整预览/正式制作/发布/修改/导出未完成 | 逐项实现并通过真实新主题横竖视频测试与听验 |
| 43 风格86基线 | 全部 not_run；目录与规则不等于可执行风格 | 每风格新主题横竖渲染、视听检查、2D/3D/GL 及许可证据 |
| 最终验收 | 22 FR、92 AT、5人观察、备份恢复、生产安全与运维尚未全过 | 所有证据完成后才可声明 C2；生产部署仍需单独授权 |

这些阻断中，缺模型凭据只影响依赖该服务的真实调用。其余大量项目是未完成的开发与验证，不应归咎于凭据。`VIDEO_GENERATION_ENABLED` 保持默认关闭，不用固定回复、计时器或样片冒充生产能力。

T11 节选更新：现已从真实合成的20秒确定性技术片剪接出12秒同步AV节选，经独立全片解码、节选中英文ASR、非静音音轨、背景色像素与三张字幕抽帧复核。首轮剪断中文旁白被ASR阻断，已在渲染入口加入整句发声区间覆盖校验。此结果不解除模型内容、实际项目预览Worker/API、1080p、43风格和用户批准闭环的阻断；证据见 [composition-probe.json](evidence/composition-probe.json)。

T10/T11 项目语音阶段已用离线固定镜像完成真实TTS、ASR、WAV字节复核与不可变记录，见 [voice-stage-probe.json](evidence/voice-stage-probe.json)。仍未在预览Worker中与混音、字幕和画面合成，也没有用户录音旁白路径、完整听验或正式结果音轨；该技术探针不解除视频闭环阻断。

T10/T11 项目 TimingDraft 已把冻结镜头与真实48 kHz旁白轨、字幕帧、固定字体摘要绑定；20秒技术brief及相同阶段重放实际通过，见 [timing-stage-probe.json](evidence/timing-stage-probe.json)。仍未生成或验证Visual源码及最终FilmTimeline，也未有实际预览MP4与音乐/音效/用户听验；不能把TimingDraft当作媒体成片。

T09/T11 画面阶段已能只读取冻结Visual源码，并用固定Docker镜像渲染单镜全部帧；20秒/480帧/320×180技术场景经独立MP4全片解码、BT.709与文件哈希检查，见 [picture-stage-probe.json](evidence/picture-stage-probe.json)。这不解除真实Visual模型、已上传素材送入隔离容器、1080p、43风格视觉QA、音画合成、预览Worker/API或用户审批的阻断；含素材源码当前明确失败，不能静默漏用素材。生产画面任务的已退出容器清理/崩溃恢复仍待Worker接入。

T09/T11 两镜头技术拼接已实际通过20秒480帧全解码、逐帧计数、输入哈希、前后抽帧像素及重放；项目持久阶段只读已完成镜头，见 [picture-sequence-probe.json](evidence/picture-sequence-probe.json)。底层真实探针与项目阶段注入测试还未组成同一次真实项目流程；音轨/字幕、预览发布和正式渲染Worker仍未接通，不解除视频闭环阻断。

T10/T11 同一技术项目现在已把真实离线TTS/ASR、48 kHz旁白、冻结画面、字幕与固定Docker合成器串成20秒H.264/AAC文件，最终全解码、响度、真峰值和成片后ASR通过；见 [composite-stage-probe.json](evidence/composite-stage-probe.json)。这消除了“项目阶段未接音画”的局部缺口，但输入Visual仍是合成HTML，320×180仅作技术探针；音乐/音效、1080p、43风格、语义/听感QA、真实预览节选和批准发布仍未完成。探针容器已清理，生产Worker的跨崩溃容器恢复/清理仍缺。

T11 已在同一技术项目中生成并私有落盘9秒真实AV节选，320×180与1280×720均经独立全片解码、帧数/哈希及重放检查；720p产物未发布前公开访问被拒，见 [preview-720-stage-probe.json](evidence/preview-720-stage-probe.json)。此结果解除“项目级AV节选尚未生成”的局部缺口；输入Visual是合成HTML、质量状态仍为`semantic_not_checked`，完整批准Bundle与正式渲染绑定、真实预览发布Worker/API、播放器和明确批准尚缺，不能对用户宣称预览已可用。

T10/T11 持久旁白对象已用真实离线TTS/ASR验证：删除原voice工作目录后可凭冻结引用独立读取，WAV/ASR篡改及错日期拒绝；硬链接发布中断可在OS锁下按实际SHA/字节核验恢复，未知链接仍阻断，见 [验证报告](evidence/narration-package-validation.md)。Voice/Timing阶段本身仍要求工作文件，正式生产链恢复仍待实现。

T06/T09/T10/T11 新增真实 FilmSpec 组装器、AudioAgent 严格计划/预算阶段与统一 revision seed；未知质量策略不能降级，完整来源、字幕和实际素材字节均校验。明确无配乐/拟音的技术项目已冻结制作包，删除 voice/audio 工作目录后独立读取仍通过，见 [制作包验证](evidence/film-package-validation.md)。默认原创配乐保留；音乐/拟音/非零增益未执行时明确 `FILM_AUDIO_EXECUTION_NOT_READY`，这是尚未实现的本地执行部分，并非凭据问题。真实 Audio/Visual 模型、用户录音、素材送入容器、独立语义/风格/听感 QA 与正式批准渲染Worker仍缺，43风格86基线仍全部not_run，不标C0/C1/C2完成。

## 2026-10-03 实际模型接入更新

MODEL_API_KEY、MODEL_BASE_URL 与四角色模型现已由用户提供并授权本地真实验证，旧“缺模型凭据”记录为历史阻断。当前提供方 gemini-3.8-flash 在非流/流式HTTP和原生Mastra Director/Treatment均返回200；不是Vercel服务，也不需要Blob/Sandbox。

实测 max_tokens:1 返回352 completion_tokens，max_completion_tokens:1 返回297；当前提供方不执行请求输出限制。默认生产生成开关仍关闭。人工授权探针限制HTTP总次数、时间、零重试并记录真实usage，但不能保证硬token计费上限。后续需提供方支持可验证硬上限，或明确接受该风险并接入实际usage对账/超限熔断；不能只把请求参数称为硬上限。

真实20秒创作第二轮台词可容纳，独立ASR把青禾识别为清和，ASR_MISMATCH正确阻断。当前需专名发音验证策略/更强识别证据，不能篡改期待台词或自动用模型改正识别结果。失败记录见 evidence/real-creation-duration-failure.json 与 evidence/real-creation-probe.json；ignored .video-local/real-creation/ 保留实际工作文件。声音合成器已生成真实立体声WAV，音乐主混音/用户音轨/最终听验仍未完成。

### 本轮真实声音与画面后续

可信stems和主混音已在固定无网Docker实跑；实际Native Treatment/Visual/Audio的20秒720p AAC立体声技术片通过全解码和响度。旧缺真实Visual/Audio调用的阻断已消除；AudioExecution schema2已归档四条实际PCM、冻结完成收据与固定输入寻址执行槽；FilmSpec producer/独立loader和Composite schema4已接入归档立体声master。未执行音乐、输出替换及弱旧schema1仍拒绝，不能用技术片绕过发布门槛。声音听验、逐镜事实/阅读时间与风格QA、1080p、真实预览/批准/渲染/导出、43风格86基线仍缺。

Node20直接npm install被engine-strict拒绝，采用本机Node22.23.1匹配工程>=22.13<23后安装Acorn8.15.0成功。当前npm audit实报11个high：braces/http-cache-semantics及传播依赖，主要经eslint-config-next/@swc工具链；不能用建议的Next14降级或force自动修复。后续需核实可用补丁/替代及生产依赖影响，安全验收未通过。

模型对账更新：四个原生生成入口已接SDK实际usage、不可变receipt与跨日持久部署门闩；已知超限冻结，未知用量冻结，旧日未用预约拒绝。未知消费不因新UTC日/新项目消失；旧无版本计数必须审计，不自动迁移或清零。真实单次探针HTTP200/4103input/2716output/settled，见 [model-accounting-probe.json](evidence/model-accounting-probe.json)。此前缺实际usage对账的开发缺口已消除，但提供方仍不执行硬token限制，对账无法阻止单次已发请求的额外收费。生产生成默认仍关闭；独立Critic、完整预览和制作Worker/API/UI及剩余验收继续开发。

历史迁移边界复审P2：旧日/其他项目无gate legacy账本可绕过首次初始化。新增精确旧数据fixture先成功（测试退出1），修复为首次必须取得有界、不跟随symlink的所有日账本及项目budget清单；已有calls>0且gate缺失即MODEL_ACCOUNTING_MIGRATION_REQUIRED，不建active:null，不自动迁移或清零。缺清单能力、symlink清单均阻断；只允许全空新作用域初始化。升级时须停止旧worker并先审计历史占用，不能与旧版本并行写账本。新格式跨日故障/重放规则保持不变。

2026-10-03 Critic实测：真实模型看到所选蜡笔绘本画面中字体不符合手写规范、第324帧地点尚未完整显示；保持预览证据，禁止当最终质量通过。事实pass目前要求一帧中的完整原文（仅忽略标点/空白），对“活动时间为…”这类描述前缀较保守，可产生未通过，尚需来源固定的显示片段契约；不靠白名单/改写事实放宽专名日期。四帧静态审查不代表全片两轮覆盖、0.2秒关键动作、阅读停留或听感通过。缺的不是Blob/Sandbox凭据：当前真实无网Docker链可运行，仍需完成生产Worker/API/UI、真正聊天增量、风格修复及全部验收。

2026-10-03 聊天incremental缺口已修复并真实提供方验证：objectStream首片段在终态前到达，停止/错误/冷启动保留片段，未知paid effect不重跑。仍未接通用户准备预览、批准、正式render、导出与自然语言修改的完整制作通道；不能将流式聊天成功等同完整产品完成。

2026-10-03 prepare_preview持久命令与真实自动6–12s节选已独立实现/测试，尚未公开API/UI或接入production Worker。真实11s private artifact已生成，质量仅technical，既有renderer仍强制-ac1导致立体声源变单声道，接通发布前须将声道数纳入stage key并保存实际声道。自然语言修改/正式render/export及43风格86基线继续开发。

2026-10-03 stereo节选限制已关闭：新v2真实节选保持源2ch，旧mono按2ch实际QA拒绝，stage key/record/artifact均固定channels。当前未完成的关键通道仍是preview Worker/API/UI发布→一次正式批准→render/独立完整QA→结果/下载/修改/export，以及43风格86基线和完整验收；现有字体/readability Critic失败仍保留。


2026-10-03 预览入口更新：预览Worker/API/UI不再是未实现项，但尚未跑新主题完整模型Worker。技术诊断片实际播放通过，不代表Critic质量通过；历史风格/可读性失败仍保留。正式制作仍缺批准后只消费冻结素材的1080p渲染器、完整QA及最终发布；不得放宽preparing_preview阶段fence来伪装正式流程。云Blob/Sandbox无需凭据（已自托管）；实际仍需配置固定VIDEO_MEDIA_IMAGE_REF/runtime/timeout，以及有旁白时voice/asr镜像。预检现在在模型前拒绝缺失配置。GRSAI实测忽略输出token上限，不能声称硬费用封顶；旧usage未结算/未知结果必须审计后才能继续付费，不能重置原ledger。43风格86真实基线、全片听验/视觉QA、16行为评估和五名用户观察尚未完成；生产开关关闭，未部署。


2026-10-03 T12更新：批准后的冻结1080p画面与已归档立体声配乐/音效已实际合成为20秒双声道AAC电影，全解码、响度与冷重放通过；正式来源回执与音频后验取消已实现。此轮无旁白变体只证明实际归档零voice的ASR不适用。仍缺正式旁白/字幕路径实测、至少两轮完整视觉检查与真实听验、render Worker/最终发布/清理；旧Critic及专名错误仍fail，不能当作最终视频。详见 evidence/approved-composition-validation.md。

2026-10-03 T20 依赖复核：npm audit仍11 high（两个根包及传播依赖）；npm registry最新braces=3.0.3、http-cache-semantics=4.2.0。对应 [braces公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 与 [缓存公告](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) 均列Patched versions=None，当前没有可直接锁定的官方修复版本。未force修复或降级Next14；安全验收继续blocked，需要受控补丁/替代及兼容性验证，而非伪造0漏洞。

2026-10-03 T12全片QA更新：两轮全片抽帧与正式Critic执行/聚合代码已接通；真实104+124帧、29批及只读冷复核通过，未调用模型、不算视觉质量通过。原批准诊断项目预算calls=7、accountingVersion缺失、无部署门闩；精确占用副本确认MODEL_ACCOUNTING_MIGRATION_REQUIRED，原ledger未改。实际历史用量/原外部响应仍需审计，不能靠空新账本或改阈值继续付费。仍缺真正全片Critic结论、连续运动/听验、正式旁白字幕实测和发布/修改/导出/清理/全部风格验收。详见 evidence/approved-visual-validation.md 与 approved-visual-budget-probe.json。

2026-10-03 T12正式任务更新：批准HTTP API、冷render队列/实际Worker、冻结生产者与原生Critic、完整质量候选、私有MP4与原子结果发布生命周期已接通并通过协议/恢复测试，之前“render Worker/对外批准入口尚无”限制在服务层关闭。正式UI仍disabled：运动/听验/字体/许可缺独立证据时默认完整报告保持not_checked，严格QA拒绝正式交付；缺真实最终新主题/含旁白字幕完整链。0新增模型，旧账本阻断不变；不以合成正向QA/非视频fixture作为真实质量证据。详见 evidence/render-operation-validation.md。

2026-10-03 下载界面已接通已发布currentResult的MP4/五种异步导出、同命令恢复与独立取消，373单元及26浏览器通过；真实原项目仍没有通过所有mandatory checks的published currentResult。UI协议夹具不能替代该媒体验收，不放开正式按钮/质量门槛。poster继续CAPABILITY_UNAVAILABLE并明确禁用；修改/恢复产品入口、清理与43风格86实测仍待完成。原模型对账门闩不变；本增量0模型调用、原control未改，未push/部署。证据：evidence/download-ui-validation.md。

2026-10-03 封面阻断更新：poster能力已接入统一Worker/SSE/私有PNG和产品入口，原CAPABILITY_UNAVAILABLE/按钮禁用缺口关闭；真实1920x1080第59帧PNG提取/独立CRC及像素行检查、600/nlink1/拒覆盖与冷恢复通过，源项目仍无qualified final result，公开导出仍RESULT_STALE。379单元/27浏览器通过不替代真实全片QA/公开用户下载闭环；旧模型账本、修改/恢复UI、清理、竖屏媒体与43风格86实测继续待完成。0模型/0付费、原control/ledger未改，未push/部署。证据：evidence/poster-validation.md。

2026-10-03 无上限验证策略已实现并实测迁移：项目/全部历史日完整清单、不可变原快照/计划、historical真实来源、只加正超预约、同计划冷恢复、未知冻结仍生效；诊断副本七次历史project/daily已完整保留，原源账本/control未改。用户追加测试次数/费用无限授权已落地，不是缺凭据。实际全片第一批gemini-3.8-flash多模态调用120秒超时，没返回可核usage，计为unknown，不自动重试，29批未完成、仍无QA通过/结果发布。超时和未知effect恢复是当前独立阻断，见 evidence/approved-whole-critic-probe.json 与 unlimited-validation.md。默认生成开关关闭，未push/部署。

2026-10-03 恢复入口缺口关闭：更多可显式查看历史并调用已有restore，原命令持久重连、确认后视图最低版本、跨标签/focus/visible刷新已实现。396单元与37浏览器通过，截图保留已确认视觉；仍没有真实合格成片可用于完整恢复媒体验收，协议夹具不代替QA。模型第一批超时unknown、自然语言修改/清理及43风格86真实基线仍待完成，0新增模型，本增量未改真实control/ledger，未push/部署。见 evidence/restore-ui-validation.md。

2026-10-03 T14 删除增量：原命令持久回执、即时授权撤销、操作取消、冷Worker扫描及Director付费启动期间删除竞态已验证。85文件411项单测及构建/lint/typecheck通过，0新收费调用。物理文件/全局缓存/容器停止证明、未知effect处理和30天过期清理仍缺；接口明确保持 cancelling，不能把 AT-045 计为整体通过。详见 [删除验证](evidence/project-deletion-validation.md)。无限费用授权已持久保存，不再是缺少额度授权；真实全片请求超时unknown仍保留原门闩。

2026-10-03 T14 过期增量：100 control页/冷游标与恢复协调、本人的410和跨owner404、后台不续期、用户首次准入活动、迟到取消/消息不复活、同UUID冷归档不续期已验证；两轴复审clean。详见 [过期验证](evidence/project-retention-validation.md)。保留50,000 entry库存上限和扫描时效限制；物理数据/缓存/容器清理、运行任务超时协调仍未完成，不能宣称完整留存运维已交付。

2026-10-03 未知模型请求只读调查：官方 GET /v1/api/result 文档要求供应商任务ID，图片/视频分类，没有说明凭本地请求或时间查询文本聊天用量；现有全片超时没有响应ID，未发送猜测查询。全片诊断期限现默认600秒，并完整保留正文超时证据，437单测及构建等检查通过；本增量0真实模型调用，不绕过旧unknown门闩。无限额度授权继续有效。详见 [超时诊断验证](evidence/model-probe-recovery-validation.md)。

2026-10-03 T13 制作期间反馈/冷恢复缺口关闭：更正不再改变正在制作的brief，持久原输入保留预算与授权基线，取消后只保留not_started旧反馈；442单元及构建等检查通过。safe_direct真正修改音乐gain并混音/QA/新result、preview_required 新效果闭环仍未实现，不将此次归档当作完成改稿。0真实模型请求、旧unknown门闩保留；见 [反馈验证](evidence/pending-feedback-validation.md)。

2026-10-03 T13 音乐gain生产者已实际实现/验证：原真实归档音乐和音效独立重混音−3dB、全样本误差6.26e-9、冷重放/原预算control不变通过，444单元及构建等检查通过。仍缺含实际旁白变体/响度听验/ASR、授权改稿operation→新revision包→完整QA→新result发布；不能将内部音轨当用户完成的视频。见 [音乐重混音验证](evidence/music-remix-validation.md)，0模型/网络，旧unknown冻结保留。

2026-10-03 T13 API反馈target丢失已修复：canonical原目标归档/Director/冻结输入、同消息ID不能改目标，447单元及构建检查通过。浏览器仍未提供实际当前/历史播放器目标，修改授权和正式执行不因UUID自动成立。完整改稿链未完成，0provider/原账目不变；见 [目标验证](evidence/message-target-validation.md)。

2026-10-03 T13 浏览器实际target:null缺口已关闭：播放器/历史/预览选择和草稿绑定、完整原命令持久重发、跨标签身份保护经449单元/45浏览器与两轴复核通过。见 [UI反馈目标验证](evidence/feedback-target-ui-validation.md)。截图是404媒体协议夹具，不是合格成片；ChangePlan授权→真实新revision/QA/发布继续缺，旧unknown账目门闩未改，0新模型调用，费用授权不限且继续有效。

2026-10-03 T13 修改候选可冻结真实来源/基线并冷核验，455单元及构建等检查通过，见 [候选验证](evidence/music-change-draft-validation.md)。此候选无已批准语义、无预算预约、无执行权限，不解决正式改稿；待接模型分类、原音乐证明、幂等准入/混音/完整QA发布。0新模型/真实control账目未改，旧unknown门闩保留、不限费用授权有效。

2026-10-03 Director/Worker音乐候选接入缺口已关闭：本轮原话、当前整片目标、冻结分类上下文、固定server计划ID与op指针、relative/absolute意图保持及冷恢复经465单元/构建等检查验证；本地真实SDK协议不是远端语义验收，0provider。见 [Director候选验证](evidence/director-music-change-validation.md)。候选not_started/nullbudget，正式语义/原音乐增益/操作准入/混音完整QA发布未完成；旧unknown用量门闩保留，费用授权不限继续有效。

2026-10-03 实际原音乐/增益读取缺口已关闭：新增v3归档和真实断网−3dB混音/冷恢复通过，469单元及构建等检查通过，见 [增益归档验证](evidence/music-gain-package-validation.md)。本切片无用户修改准入权限、无新revision/全片QA/发布；原片零旁白不能代表有旁白验收。最终合成的loudnorm可能抵消sole-music降幅，需实际测量并处理质量/意图冲突，不放宽强制响度或冒充可听修改成功。旧unknown门闩未改，0新模型/原control预算不变；不限费用授权有效，整个项目继续未交付。

2026-10-03 混音callback/owned停止错误基础能力已实现并通过481单元/构建与两轴复审；实际默认音乐SHA不变，4次探针仅completed_before_return，尚无真实master运行中停止证明。见 [混音撤销验证](evidence/music-master-cancellation-validation.md)。prepareAudioExecutionStage未传callback、sound仍旧裸spawn，公共render/preview失败处理仍可能按取消标记收口unknown，须继续接入并保留不确定性；物理清理、修改准入/新revision/全片QA发布仍未完成。0provider、原control/账目不变，未push/部署。
