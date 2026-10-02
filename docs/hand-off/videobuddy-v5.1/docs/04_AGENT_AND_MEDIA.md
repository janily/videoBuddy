# 04｜Agent行为、素材理解和完整媒体流水线

## 1. Mastra接入与上下文

复用模板`src/utils/model-provider.ts`的provider选择思想，为Director/Visual/Audio/Critic配置独立模型ID与capability。不使用上游文章模型称谓作为真实API ID，不强制改网关。网关可能分别使用chat-completions与Gemini-format文档理解；同baseURL不等于同协议。[R01][M01]

四类角色不是四个常驻服务：Director负责理解与影片方案；Visual负责生成当前style实际代码；Audio负责音色/配乐/动作声音计划；Critic只读实际产物与证据。按需要调用，不每轮强制四次。Mastra原生storage/memory不用于保存业务真相；外部持久上下文由Blob的Understanding与消息快照注入。

模型上下文顺序：不可越权策略 → 当前已确认用户意图/事实/跳过项 → 当前消息与真实资料摘要 → 当前stage所需规则 → 小量相关历史。按context budget压缩普通聊天，事实、冲突、授权与必须出现项不得被摘要丢失。用户资料中的指令、链接与代码视为不可信内容，不覆盖工具权限。

初次可读轻量43风格索引；选定风格后只加载该STYLE、DIRECTOR必要章节和相关TECHNIQUE。先产出新Treatment再开放DEMO代码参考；不把43份风格文档和所有demo每轮塞进prompt。[R02]

## 2. Director对话协议

一次对话输入：project/briefVersion、最新消息、asset-analysis refs、已有facts/askedTopics/skippedTopics、当前生产状态、当前可播放artifact。输出 `GuidanceDecision`：

```ts
type GuidanceDecision = {
  action: 'ask'|'suggest_preview'|'acknowledge'|'status'|'change';
  reply: string;
  question?: {topic:string; text:string; required:boolean; reason:string};
  understandingPatch?: UnderstandingPatch; // 字段操作见02，必须携带语义基线和来源
  recommendedStyleId?: string;
  executionIntent?: 'prepare_preview'|'classify_change'|'none';
  evidenceMessageIds: string[];
};
```

UnderstandingPatch固定为 `{baseBriefVersion, operations}`；operations使用add_fact/supersede_fact/set_preference/set_asset_use/mark_topic_skipped/mark_topic_asked/resolve_conflict/replace_summary的判别联合，每项携带sourceMessageIds，用户原文和已有事实只能追加更正不能无证据删除。未知操作或偏好字段拒绝。

reply可以流式显示，但具有写作用的结构化意图只有完整校验并核对用户授权后才执行。没有权限的tools根本不注册到该角色；不能靠prompt一句“请勿越权”保护正式制作。

### 2.1 下一问规则

优先：必须澄清的事实/授权冲突 → 会改变内容的受众/用途 → 高价值可选素材 → 可合理默认的风格偏好。每轮通常一个决策主题；最多3轮可选澄清，之后给可见默认值并建议预览。必要事实核对不受三轮硬截断。

已提供的信息不再索要；用户说没照片/你决定记入skippedTopics。信息完整直接总结并准备预览（有明确执行请求时），否则显示“先看效果”而不自动大量计费。没有名字/价格/日期时可不采用，不能虚构。资料用途不清时一个问题，不硬问商店照片给知识科普用户。

### 2.2 最小对话评估集

`acceptance/agent-cases.json`固定包含：一句模糊需求、完整brief、仅上传、无照片、拒绝可选项、关键事实冲突、问进度、模糊停止、明确小改、风格大改、在途补资料、提示注入。单元测试用结构化mock；真实provider评估另跑并报告原始输出，不能用字符串包含“好”作为正确性标准。

风格/文案质量通过rubric而非死板短语；硬性安全项为0容忍：编造必需事实、没有来源却说读过资料、把“可以”当正式批准、把引用文档指令作为用户授权、擅自更换风格。

## 3. 素材上传与理解

先申请upload intent预留额度，生成精确object key和短时上传能力，浏览器直传到Private Blob。上传完成回调与客户端complete均可能重复，以assetId+hash幂等。服务端验实际元数据后才uploaded，再在conversation lane排分析。UI在原附件消息原位更新，不另刷多条日志。

Markdown直接按内容理解；PDF优先文本层或可用文档模型，对扫描页需要支持图像/PDF的模型真实读取；无法读取明确失败，不默认无限OCR。图片实际送图像模型（受大小和隐私限制）识别元素与文字；有源文件证据。音频先探测和ASR，询问/识别用作旁白还是配乐；音乐不能被ASR假装转成事实。

AnalysisResult：摘要、可引用事实、素材用途建议、无法确认项、source locator、usage/model/时间。只提取素材中有的内容。Logo和必需数字由用户输入/原素材核对；品牌字体不会从工具机器无授权拷贝。平台/模型数据处理路径用轻量说明告知，不增加冗长注册流程。

上传失败、解读失败与无法证明事实分开。asset ready不意味着所有陈述真实；新消息明确更正仍优先且保留来源。上传槽超额返回限额原因，不把10文件合计上限放在客户端独自检查。

## 4. 预览制作workflow

`preparePreviewWorkflow(projectId, operationId)`只从授权后的operation读取输入，不相信请求携带源码/owner。步骤如下：

| 步骤 | 主要产物 | 关键阻断 |
|---|---|---|
| freezeInput | immutable Understanding+事实+素材manifest | 未解冲突、必需资料还在读取 |
| planTreatment | 3案内部比较、选定方案、镜头/声音表 | 事实不覆盖、靠换样片名冒充原创 |
| prepareVoice | 台词、逐句音频、ASR、词级时间 | 读错重要词、时长冲突未解决 |
| compileTimeline | 单一Timeline+profile | 超出用户时长、字幕阅读不够 |
| createPicture | scene模块/角色/相机、可执行代码 | 任意网络/目录/依赖、NaN/无READY |
| createAudio | score/ambient/foley/stems/mix plan | 音色不符、动作无声未说明 |
| probeAndReview | 全片稀疏帧、关键动作条、角色表 | 明显技术失败或风格偏离 |
| freezeBundle | FilmSpec、源码/声音/字体/资源hash | 包不完整或依赖不能重建 |
| renderPreview | 6–12秒真实AV节选、excerptMap | 节选不是当前代码/音轨 |
| commitPreview | PreviewBundle+control pointer | brief已变/取消fence/预算不足 |

默认节选9秒（3个约3秒片段），可连续或调整到6–12秒，选能代表关键画面/声音的段落；短预演不是全片，UI明确“节选”。不强制每个故事都是6镜头，以可读时间和表达决定。用户预览前系统自己审查完整结构，不向小白露三个方案或逐镜头复选框。

预览之前生成该版完整源包而非只有首镜头；按场景拆代码可减少单次模型输出，所有文件都需要manifest和静态/运行验证。不在批准之后又让模型补一半未见代码。

## 5. 渲染契约和声音

### 5.1 画面

适配上游`window.READY / DUR / render(t) / EV / TEXTS(t)`，必要参数明确加载。render(t)应在固定seed和依赖下任意顺序调用，不能依赖前帧、Date.now、未seed随机或requestAnimationFrame推进。需要仿真的效果先预烘焙/存checkpoint，再从绝对t恢复。[R02]

所有profile用目标1080逻辑构图，预演帧从相同逻辑构图采样后等比缩为720；不能通过改变viewport引发字体断行和位置重排。最终1080依然再做可读/遮挡检查。横竖版各自布局，不能居中裁切。按风格保留低频角色动作与平滑摄影机，不把fps简单降到12。

PictureAdapter接口：`validateSource(bundle): Report`；`renderFrames(job: RenderJob): JobRef`；`renderClip(job): JobRef`；`exportEvents(bundle): ObjectRef`。RenderJob携带逻辑尺寸、输出尺寸、fps、startFrame/endFrame、bundleHash、runtimeDigest、seed、attemptId、fence。跨frame chunk可复用仅当所有输入hash完全匹配；本版不强制实现精确单秒缓存引擎。

### 5.2 旁白和字幕

VoiceProvider输出每句WAV、duration、word timings、provider/model/voice/hash与使用权信息。英文可适配Kokoro本地，中文可先对上游edge-tts验证，但公网产品应核查实际服务许可、稳定性和网关支持；商业SLA不能从上游demo推断。Provider实现必须真实跑通，不能只保留接口或用测试音频。[R02]

displayText / spokenText / expectedAsrText分开；数字显示与读法不同。每句ASR核对后才能编译最终时长；expectedAsr不允许执行Agent为通过而随意更改。专名识别疑问可以升级模型或让用户试听确认，并记录豁免。最终混音再ASR/截断检查，单句通过不代表最终听得清。

字幕默认烧录+SRT。字幕停留目标至少max(1.8秒,发声长度+0.6秒)；标题基线4秒；屏幕文字参考中文4.5字/秒、拉丁15非空字符/秒+1.5秒。时间冲突先减文字/改叙述再预览，不盲目加速和截断。风格特定短命令字卡需要明确rule override与视听证据，不能全局取消阅读检查。

### 5.3 配乐与混音

AudioAgent输出可验证事件和MixPlan，可信Python工具执行。优先使用已许可采样、合成和物理建模，保留所用乐器/曲目许可；用户音乐另标来源，不声称都是AI原创。音乐段落、Foley、环境声来自同Timeline事件，按动作材质取声音，不把钢琴+弦乐用于全部43种。

混音做人声压缩、音乐duck、主要动作避让、合理低频和真峰值控制。默认最终目标-14 LUFS±1 LU、true peak≤-1.2dBTP，按有声音成片profile检验；这是产品目标，不是所有平台唯一标准。纯静音按明确intent跳过响度而非伪造数值。音频48kHz，视频H.264 yuv420p、AAC、BT.709目标颜色与faststart；实际色彩路径由探针验证，不能只写标签导致范围错误。

### 5.4 字体与工程

CJK字符覆盖必须根据实际脚本检查，文字变了要重新生成字体子集；READY等字体加载真正完成。不运行时依赖外部Google Fonts/CDN。字体资源下载和许可在可信构建阶段处理；源码ZIP不分发本机字体，附font-fetch-manifest与合法获取路径。

## 6. 正式制作与发布

renderApprovedWorkflow：claim → 读取并验证preview approval及bundleHash → 领取资源与预算 → 真实frame渲染 → mix/master → 独立QA → 上传不可变文件 → 再验fence/owner/approval → 一次project CAS发布result与消息ref →终结事件 → 释放资源。

生成代码不能自己写currentResult，也不能跳过QA。输出存在不等于成功，render/encoded/qa_passed/published分开。源码生成模型不是QA判定者；Critic不能修改合格线。

## 7. 质量、修复与证据

| 检查族 | 必做项 |
|---|---|
| 输入与内容 | 必需事实覆盖、来源冲突、禁用素材、脚本与旁白一致 |
| 编译运行 | 无脚本异常、必要资源均就绪、字体覆盖、无NaN、固定环境随机抽帧一致 |
| 时间 | 帧数/总时长、镜头接缝、字幕与声画同步、关键事件量化误差 |
| 最终媒体 | ffprobe、完整解码、音轨/画幅/帧率、响度/峰值、无截断 |
| 视觉 | 全片每1–2秒总览至少两轮、关键动作0.2秒抽帧、遮挡/裁字/风格语法 |
| 特殊风格 | alpha阴影、景深、角色身份/姿态、DOM元素位置、像素网格、复合媒介一致性 |
| 听感 | 实际声音检查或音频能力模型/人工听验；不能用静帧模型声称听过全片 |

QualityReport含ruleId/result=`pass|fail|not_checked|not_applicable|waived`、severity、范围、evidenceRefs、原因、waiver actor。必要技术项fail/not_checked阻断交付；N/A必须匹配intent；waiver不能用于解码损坏、缺素材或越权。审美warning可发布但记录，不给虚构“满分”。不能强迫小白审读技术报告，缺听验能力时用真正试听与有限反馈，不宣称全自动全感官验收。

针对上游工具补齐：图片/字体404只警告改为必需资源阻断；readcheck退出2为未检查；readcheck不覆盖SRT则单独检查；mux退出0但响度警告不能视为通过；intentionalBlack/Silence与检测对照。风格缩小主体/短命令不能被统一通用阈值错误判定。[R02]

每stage最多2轮创作修复，记录根因与diff；复测受影响项和回归项。改变批准创作的修复回新预览；取消后任何修复都不能再发布。

## 8. 全43风格工程化

`acceptance/style-matrix.json`包含固定43个slug和9类；全部状态初始化not_run。每StylePack保存规则hash、engine family、特殊要求、supportedProfiles、需要的素材/字体/音频库、determinism与质量测试、真实样片引用、runtimeDigest。

开发阶段可以逐项验证，产品完整交付前每项至少一个**非demo的新主题**横竖1080结果与对应真实预演。即至少86个基础render证据，不能只跑86次同主题Swiss。中文与英文各有测试集；基线可按风格分布两种语言，其它公开profile必须另测。20秒与120秒边界每个技术族覆盖；全部43均需正常时长测试。

六个实现族：图形/数据；绘画材质；2D角色；DOM产品演示；3D/2.5D；跨媒介。不得把上游九艺术分类改掉。microgame的内部多媒介是自身要求，不能作为单风格限制借口移除。用户所选能力不可用时明确说明，在修好之前不标该风格已交付。

## 9. 播放、导出和修改结果

默认只显示视频下载，更多提供poster、SRT（有字幕时）、TREATMENT、CREDITS、quality、source ZIP。Zip包含源码、timeline、允许分发的用户资产与重建说明、依赖锁、许可manifest，不含cookie/keys/临时signed URLs/字体二进制/模型权重/缓存。重建可能需要安装与按许可取得资源，文案不要声称下载即离线可运行所有模型。

读取媒体用经过owner验证的短期签名URL；过期后重新签发并恢复currentTime、暂停状态，不重新挂载视频。支持HTTP Range/快进、移动playsInline、禁止自动有声播放。currentResult只指向完整最终文件；预览下载需要明确标节选，不能保存为final.mp4混淆。
