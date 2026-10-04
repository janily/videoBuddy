# T10/T11/T14 单句可信试听复核（2026-10-04）

项目负责人已明确回复“读音正确，确认这句试听复核”。该回复只适用于原句“洒下适量的水，润湿土壤。”及原 WAV SHA `3c9f907ed0e6af737c4d2a21c709e1306c784f32759f1eeeb08a0c25a25a6c02`；不是正式制作确认、影片听验或同音字通用豁免。原识别“撒下适量的水,润湿土壤。”和原失败 operation 均保留。

实现：真实确认归档为所属项目的 user message，固定 message→challenge 确认槽、不可变 proof、按 consent epoch/完整 plan/WAV/runtime/transcript 绑定的 lookup。冷读取核对原消息索引、固定确认槽、SHA/bytes 与 owner/live；模型 JSON 无法构造带私有 Symbol 的能力。生成阶段仍遵守当前 fence/epoch，历史单 WAV 试听事实不会因取消后续制作而被抹除。旁白、字幕/时间计划、归档包和重建路径保存 `trusted_review` 与原识别词，不改 expected。FilmSpec 再核完整冻结旁白计划；最终 AAC 的 postmix 校验不复用原 WAV 确认。

源码 ZIP 保留源 JSON 的原始字节/hash，仅额外导出非授权的 `audit/speech-reviews/<confirmation-sha>.json`；原私有确认引用是外部 authority，不能从 ZIP 审计取得新的复核能力。未递归导出 ownerKeyHash、私有确认消息或聊天。现有 UI 未增加重新设计或参数面板；公共试听确认入口仍待接入，当前仅实际负责人回复经受控脚本归档。

## 实际证据

- [确认原文](new-theme-spoken-review-confirmation.json)、[实际持久确认](new-theme-trusted-review-probe.json)。`record-spoken-review.ts --confirmed-workspace-reply` 实际退出0，读既有 TTS/ASR 必须存在，0 network/producer/model 调用，原 operation/budget 不变；控制态只由实际用户消息归档/ordinal/留存时间更新。
- [四句原音频复查](new-theme-reviewed-narration-v2-probe.json)、[冷恢复](new-theme-reviewed-narration-v2-probe-recovery.json)。两命令实际退出0，四原 WAV 不重新合成：line_1/3/4 实际 medium ASR match，line_2 仅 trusted_review；实际第三/四句 ASR 两个 owned completed 固定 stdout，冷恢复不启动 producer。四句均归档实际 WAV 并通过独立 FileStore 冷读取。0 network/provider，原 failed operation/control/budget 未改，未发布 preview/result。
- [第一次诊断错误](new-theme-reviewed-narration-probe.json) 原样保留：我将 journal 写到不支持的 diagnostic-speech-checks namespace，首句缓存读取的 journal key 校验即被拒，包装错误为 MEDIA_STOP_UNKNOWN。该 namespace 实际不存在，没有 invocation/容器启动；修正脚本后使用独立、合约有效的 operations namespace 执行 v2。没有重试或重置历史 unknown。

## 测试与审查

新增行为实际 RED→GREEN：可信复核贯穿完整计划和冷包、lookup、固定确认槽拒重签 JSON 迁移、取消保留历史事实、ZIP 兼容/脱敏、异完整计划拒绝、首导入 ASR 冷进程、mustExist 不能生成新声音。生产 stage 追加可信复核的完整协议路径，发现撤销后仍进入 ASR 的窗口，已增加生成与识别前后 fence 检查；实际 RED ASR_MISMATCH→GREEN PREVIEW_STALE。协议测试使用合成 PCM，不能算真实发音/听验。ZIP 入口将内部拒绝统一为 PREVIEW_PACKAGE_INVALID，测试断言已修正并保留初次失败结果。

最终实际完整检查：`npm test` 103文件551项通过（52.11秒）；`npm run build`、构建后 `npm run typecheck`、`npm run lint` 和 `git diff --check` 均退出0。此前547项通过只是中间记录，后续新增四个边界测试已计入当前551项。相关目标两文件27项通过。

Standards：独立只读审查先发现冷 proof 未查固定确认槽及 ProjectStore runtime 循环 import；均通过实际攻击/首 import RED→修复验证关闭，最终 clean。

Spec：独立只读审查先发现旧影片 epoch 冷读与 ZIP 兼容问题，并核完整 plan 绑定；均通过实际失败→修复关闭，最终 clean。未把包校验/源 WAV 复核算作影片 QA。

本次为 implemented/tested 增量，deployed=false。T10/T11/T14 整项及 C0/C1/C2 未完成。下一步通过新的合法预览 operation 复用原实际模型生成且已冻结的 Treatment，避免重新创作使单句原音频确认失配；继续真实音画合成、独立 postmix/Critic 与预览闭环。公共试听入口、T05 图片分析、正式制作/修改/导出闭环与 43 风格/完整验收继续执行；未经授权不 push/生产部署。
