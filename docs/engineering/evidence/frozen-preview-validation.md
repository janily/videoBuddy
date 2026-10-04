# T10/T11 冻结实片技术继续与实际 Critic（2026-10-04）

本增量在同一完整冻结 revision 上建立新 preview operation，实际推进 Composite、四句最终混音核验和 Excerpt；首次真实 Critic 返回格式不合规，预览保持未发布。负责人最终混音单句确认只适用于原 AAC 提取 WAV，不代表正式制作批准或整片验收。C0/C1/C2 均未达到。

## 实现和边界

`frozen-preview.ts` 校验原 failed/composition operation、当前 project/owner/epoch/brief/Understanding、完整 FilmSpec/Treatment/audio plan/视觉来源及 completed 创作 effect、实际影片 SHA 和 owned postmix proof。新命令绑定冻结输入 digest 和完整 request；缺 command、篡改来源或当前取消状态拒绝。保留原 revision，建立独立 operation/preview ID；源失败不重写。

`prepare.ts` 与 `pipeline.ts` 接入后端技术继续。冻结时所有已存在创作阶段强制 mustExist，缺音频/镜头/包时不得回退到付费重创作或重新生成媒体。Composite 可写新的阶段记录，但物理影片必须是冻结的原文件；Excerpt/Critic 是本次后续阶段。公共技术重试路由/UI尚未实现。

`composite-stage.ts` 对缓存结果仍执行 actual QA、冷读 postmix/proof、当前 fence，并额外核对所请求冻结影片的路径、时长和实际 SHA，防止要求影片 B 却返回缓存影片 A。

`critic.ts` 改为 SDK warn 策略，让 HTTP 返回的实际 usage 先结算；严格 VisualReview 校验仍保留，object undefined 报 MODEL_OUTPUT_INVALID，不删 `$schema`、不洗掉问题、不自动重试。unit 协议服务器只能证明格式错误结算，不能作为真实模型或画面通过证据。

## 实际执行

Node 22.23.1，忽略且不提交的环境文件加载实际 GRSAI 凭据；模型 gemini-3.8-flash。执行 `scripts/video/probe-frozen-preview.ts --technical-preview-continuation` 一次，报告永久准入，未重跑或覆盖。

- project：`4a5c6131-3842-440c-a551-7d8fcf6e7c95`。
- source failed operation：`5b25cce7-3723-4128-8fa8-b252053386e9`，本次保持不变。
- revision：`35f71e39-809d-479d-b23e-3aca60ab6e41`，完整冻结 revision 未变。
- new operation：`39b2ac82-b50d-45ca-88ff-91dcc036296a`；preview ID `6db36ee2-063a-49dd-aabf-8f97bac5ed05`。
- film：SHA `7c381b9b2f75e9a05ccaa7e542686268df18a23c02fff7dd487cabcf00312ce3`，20秒、480帧、1280×720、48kHz stereo AAC，既有10492984字节。
- 0新增 Director/Treatment/Audio/Visual/TTS/镜头生产；读取同四 WAV、视觉来源、picture sequence、FilmSpec、最终影片。Composite/Excerpt已持久化。四句最终混音为3 pass+1 owned trusted_review，原洒→撒识别保留。
- 一次真实 Critic HTTP 200，2026-10-04T11:18:37.200Z 至 11:19:23.189Z，实际9409 input / 6687 output / 16096 total。
- 原始响应 SHA `fe9e5c369f26ca18311ea7363fa9a9f0e83ba9defbc7c34dff073d9873f715ba`，私有原始字节存于 model-diagnostics。额外 `$schema` 导致旧 SDK strict 拒绝；新 operation 保留 failed/critic/PROVIDER_UNAVAILABLE，原始 Critic effect 保持 started，不重置或重执行。

正式报告：[frozen-preview-continuation-probe.json](frozen-preview-continuation-probe.json)。它保留当时 unknown 账本快照，后续精确结算见独立报告，不覆盖旧报告。

`reconcile-frozen-preview-critic-usage.ts --reconcile-captured-critic-usage` 一次退出0。核原始字节 SHA、model/finish/完整 token 总数、请求时间、唯一预算 reservation、实际 FilmSpec/影片/四 PNG hash、Critic context/stageKey 和 started effect，再结算 actual usage。该项目12调用现全部 settled；原 control/operation/effect hashes不变，未接受不合规 review、未发布预览、未退款、未增加 model/native producer。见 [精确结算](frozen-preview-critic-usage-reconciliation.json)。历史其他项目 unknown 不因此解除。

## 真实画面问题和字幕单位诊断

原回复并非合法 VisualReview，以下仅作待核实问题线索：frame51/405字幕为现代黑体白字粗黑描边，违反 crayon-book §4 手写/轮廓色/纸底规范；frame405遮挡根系；关键事实 fact-seed-sprout-flow 被标为 not_checked。实际查看原影片抽出的 frame51/405，确认粗大字幕及根系遮挡，不能以修复 JSON 后重跑来获得通过。

固定媒体镜像 `sha256:75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919` 无网、只读、非root诊断：直接转换原实际 SRT，原生 FFmpeg 输出默认 ASS PlayResX=384/PlayResY=288。在1280×720纸色诊断背景上比较当前 force_style 与额外 `PlayResX=1280,PlayResY=720`；两次都用 FontSize=54/MarginV=48/Outline=3，同第一句原文。

| 设置 | 白色字形包围盒 | 宽×高 |
|---|---|---|
| 默认288画布 | (85,495)–(1138,580) | 1053×85 px |
| 显式720画布 | (418,630)–(839,664) | 421×34 px |

实际大小比例约2.5，验证字号单位问题。两张 PNG 已真实查看，原 SRT SHA `a2aa6def31aa3ec631cc188559bfbf8cd65b035224d4f00955bbdfb9e56e31cd` 前后不变、0 model calls。见 [诊断及实际 filters](caption-units-diagnostic.json)、[原单位](caption-units-implicit-288.png)、[显式单位](caption-units-explicit-720.png)。这是尺寸诊断，未更改生产合成器或原影片，不能算风格、根系遮挡、全片字幕、事实或语音 QA 通过。后续需要版本化合成规则与风格字幕实现，并以新不可变影片重新核验；旧 film-bound postmix proof 不自动继承到新 AAC。

## RED→GREEN 与工程检查

冻结来源3条 admission/storage 测试先对旧 prepare 实际 RED（分配新revision、接受未知视觉effect、丢command/变化film来源），恢复实现后 GREEN。Critic HTTP协议用例旧 strict SDK RED（用量丢失且错误未分类），warn后 GREEN（MODEL_OUTPUT_INVALID，真实返回usage结算）。这些夹具是合成字节/协议，非物理影片验收。

Spec复审指出缓存提前返回漏 frozenFilm 身份检查。新增 SHA/path/duration 三冲突回归，trusted=true 实际 RED，错误为 promise resolved；补 actual QA 后 frozen 身份 guard，small/medium/trusted 三参数全 GREEN。相关 voice-stage/frozen-preview/visual-critic-transport 三文件9项通过。

最终 `npm test` 107文件568项，退出0，50.92秒；`npm run lint`、`npm run build`、构建后 `npm run typecheck`、`git diff --check` 均退出0。构建页面与API路由成功。本次未宣称公共 retry/review、生产影片批准UI或全项目用户测试通过。

独立双轴复审固定 base `f2516cd` / head `dd59af1`：Standards clean；Spec原P2关闭，独立离线确认三冲突拒绝、匹配接受，最终clean；无网络/producer。修改为本地 commit `28c0151`、`dd59af1`，未push/部署。

## 继续项

先修复尺寸和 crayon-book 字幕/安全区以及关键事实证据，再创建新不可变 preview 与完整新AAC QA，保留本次失败、收费和原冻结片。公共可信试听与技术重试入口、完整正式worker/批准UI、素材多模态/OCR/配乐、自然语言修改全链、全部43风格86条实测、92验收/16行为/用户测试、自托管部署与恢复安全验收继续未完成。范围见 task-ledger/blockers；费用不是阻断。
