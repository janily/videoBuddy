# 同源旁白授权复用与冻结回执（2026-10-04）

T10/T11：按负责人实际原话“读音正确，音频这快就全部通过，不需要每一个影片都来验证”，新增独立 `same_verified_narration` 长期策略。原话保留在私有 owned 用户消息；server 动作绑定完整原计划/verified SHA，策略核 owner、当前 consent epoch、消息索引、固定确认槽、完整 ObjectRef、原实际 WAV/源 ASR 与源试听 proof。普通聊天/Agent 不能附加私有权限，ProjectView/messages GET 不输出动作字段。策略不授正式制作批准，不冒充逐片人工试听。

预览与正式影片的真实 postmix verifier 接入。忽略原 WAV 与工程归档的路径差异，音频字节、运行时、原词时序、计划等仍必须一致；验证实际新影片/提取 WAV 哈希，保留新 ASR 原文。有限同长度替换返回 `trusted_policy` 和策略引用，缺字/加字、明显内容改变、截断边界/异常词时间拒绝。原来单句 `trusted_review` 优先，策略不是可 JSON 复制的 capability。

[真实四句报告](narration-reuse-policy-probe.json)：实际 SHA c84f066a5a875650c2fa0a2e75215688de512779c88d3f49abb8988563dc0cf7，四句分别 pass/trusted_review/pass/trusted_policy；第4句仍原样“观察成长 内心照料”，没有改为“耐心”。冷结果相同，0新model/0新native，原failed operation和budget不变，正式批准与交付资格false。此前失败报告不覆盖，无追加试听问题。

第一次同冻结影片新operation到composition失败，0模型请求，原任务不改，见 [继续报告](book-frozen-preview-continuation-probe.json)。只读 overlay 诊断 v1/v2 将 create 碰撞错当写禁，MEDIA_STOP_UNKNOWN 未证明真实根因；v3 正确模拟既有键 StoreConflict，准确复现 BOOK_CAPTION_PRODUCER_UNKNOWN。新operation不能以本任务的空 journal证明原alpha/电影producer。新增 compositionMediaJournal 只从持久 operation marker 和完整验证的 FrozenPreview command解析来源，读取原 completed 回执；当前新operation fence保持，不复制记录，不放宽started/stopped/unknown。缓存/Excerpt同样解析已冻结来源。修复后 [v4只读诊断](book-frozen-composition-diagnosis-v4.json)完成技术核验及四句混音，到首次 Composite stage提交才被诊断写禁拦截，原state/native journal不变。

测试 RED→GREEN：policy模块缺失及journal模块缺失分别实际退出1；策略正/负识别、owned policy冷读/角色/索引/槽/源WAV变化/引用篡改/当前epoch/不可JSON复制/公开剥离/归档路径/换runtime负例，以及原Composite regression通过。最终116文件598测试59.62秒通过，lint/build及构建后typecheck退出0；最终固定514f1eb…df8cc7a双轴clean，未发现剩余实质P1/P2。

同冻结影片v2已完成Composite/Excerpt及真实Critic：一HTTP200，9411 input/4223 output原响应SHA4996d43…精确settled。Style/readability通过；frame409字体末字“料”被识别为“科”，critical fact fail和blocking observation令 PREVIEW_QUALITY_BLOCKED，未发布。已查看实际frame409，末字有手写辨认歧义，不能更改原review或跳过门禁。见 [实际Critic对账](book-preview-critic-audit.json)。下一步修正字幕字形清晰度并重新核验，再推进公共制作闭环、正式制作/修改及全部43风格基线/完整验收。项目目标仍 active；C0/C1/C2未达，未push或部署。
