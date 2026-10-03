# 当前阻断（2026-10-02，自托管架构）

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
