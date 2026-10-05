# T10/T11 整组混音验证与清晰字幕真实预览发布

2026-10-05。implemented/tested；未部署，未正式制作批准，未全片QA或完整项目交付。

## 实现

新增不可变 `completed_postmix_verification`：完整绑定原 failed composition、项目/owner/当前 consentEpoch/brief、FilmSpec ObjectRef、实际影片、plan/verified refs、media/ASR runtime、downmix、结果SHA和精确native回执引用。实读冻结影片包、原已核验WAV及完整plan，并与冻结timeline的音频SHA/采样窗口核对。

严格冷验证必须读取实际 completed 的四提取/四ASR回执；missing不按legacy降级，unknown/stopped不接受，验证store禁止create/CAS。提取和ASR mustExist；慢读后再次核owner/epoch/完整身份。原识别保持 pass/trusted_policy/pass/pass，不再询问已授权同源发音。

FrozenPreview新增整组ref，与旧单句reviewRef互斥；无旁白不能挂此证明。持久command/operation完整身份及原创作effects的existing准入不变。Composite从validated command解析原compose/字体journal和另一个精确completed postmix journal；不复制回执，不接受调用方journal替换，不重启原失败operation；结果及全部回执引用冷重核。

## 失败→通过与程序检查

新严格journal测试先模块未找到，补签名后实际两项行为失败：missing返回STORE_NOT_FOUND、foreign/empty验证意外接受；实现后两项通过。另测started拒绝、writes拒绝、foreign UUID拒绝、普通存储missing语义保留。冻结互斥/无旁白证据准入拒绝且control不变；相关3文件7项通过，voice/composite回归4文件10项通过。

首次新continue脚本typecheck遗漏env类型，未执行模型；加Environment类型修复。该轮118文件611项61.16s全部通过，lint、Next16.3.8生产build、构建后typecheck退出0。新增只读published审计script独立lint/typecheck通过。复核额外发现诊断ZIP固定目录可能跟随预置symlink导致私有路径逃逸，P2已关闭：root叶链接拒绝、直接真实root下独占mkdtemp目录、wx0600文件、file/dir/root fsync后才成功报告；真实文件系统2项RED→GREEN，含重复导出隔离/外部无写入。最终119文件613项51.95s、lint/build/构建后typecheck全部通过。最终固定代码快照 `541c29e5b1577fbbaeea4e6f106ef56a3aafa366`（base `0992e26355f963b5f969406f8a11685729e98acd`）Standards/Spec分别clean；实际v3在复核后完成并另存证据。

初始published审计误用operation明文前缀查以canonical hash为key的accounting，报CLEAR_ACCOUNTING_CHANGED，保留 [初次审计](clear-published-preview-validation-probe.json)；不是模型用量异常。v2按真实Critic effect stage推导精确reservation id，并比raw usage与settled实际token，通过，无重试模型或媒体。独立ZIP检查首次期望`long-cang`，实际catalog id为`longcang`；只修诊断断言，ZIP字节未改。

## 真实证据

[整组探针](completed-clear-postmix-verification-probe.json)：ref SHA `907efe22b9110a7e18c7c7da28f6c8107b9acb8494beeab37da08b259d32e4a9` / 4299bytes，8真实completed完整引用；persist后独立FileStore冷读及Frozen准入通过，换film SHA拒绝，原control/budget/failed operation及两个native journals均不变，0新native/模型。

[真实技术继续](clear-frozen-preview-continuation-probe.json)：新operation `f08efd63-86da-4144-98a7-c5788e95340c`，同revision `4838f74b-4b34-4156-9511-0629ec18cb78`；Composition→Excerpt→Critic→publication成功，currentPreview `92d99397-4787-4760-8292-47e1099eb819` / preview_ready，原failed `7abd57da…` 原样保留。没有新增Treatment/Audio/Visual/TTS创作请求；复用同MP4 SHA `ceaa9448…`。

真实1次 gemini-3.8-flash Critic HTTP200，9427 input/6471 output，raw响应SHA `ad9c610c8d8c14b98e6e1a10cb19a4079ac9ab4c0088ccc00c83276510940259`，原始响应实际存在、hash/usage一致，与精确新reservation settled逐项核对。scope仅sampled_frames，四帧55/235/355/409，style/readability pass，无blocking；frame409正确观察“观察成长，耐心照料。”。已目视该实际PNG，字形可区分，根部/留白样本见实际文件；不把一帧观察当全片通过。事实 `fact-seed-sprout-flow` 仍not_checked：抽帧没有完整显示那段流程/禁止承诺文字；该状态按预览合同允许，不等于正式事实QA通过。旧字体料→科的原Critic失败记录保留，不改其判断。

[发布冷读与账目验证](clear-published-preview-validation-v2-probe.json)：readPublishedPreview独立FileStore实读包/实际私有MP4字节通过；整组证明再次冷核一致；原current control/预算/两个operation未改。公开预览artifact SHA `03db0648e8880f36726e4f464f274d99277c017dccac04529d91ad57cb8286b0`，9.5秒/228帧/720p/立体声，由同20秒影片真实AV剪接，四source区间具精确excerptMap。不是示例视频或最终全片交付。

真实工程 ZIP 28556759bytes，SHA `194c086fe2dac056d77f75186dafba12750768b7d7cbf67b1d81dac72bc3b63c`，位于 `.video-local/new-theme/seed-oD7Sxk/delivery-diagnostics/clear-preview-source/source.zip`。独立 [ZIP审计](clear-source-zip-audit.json) 核CRC/80文件及79个manifest entry全部SHA/bytes、Long Cang/Patrick锁及新renderer正确身份；无字体/模型二进制、env/chat/整组授权文件，无旧renderer混入。旧ZIP保留；路径P2修复后 [v3实际冷审计](clear-published-preview-validation-v3-probe.json) 在真实root下新独占目录再次生成相同SHA/bytes ZIP，0model/native，控制/预算/原operation不变。[v3独立审计](clear-source-zip-v3-audit.json) 再核CRC/全部entry、root边界/0700目录/0600单硬链接文件/与v2字节相同。只生成私有诊断ZIP，未绕过正式结果导出/下载准入门槛。

## 后续完整范围

下一步接实际新1080p正式流水线与全片两轮质量；事实QA仍须解决流程语义与文字证据的区分，不能把当前not_checked改写为通过。完整听感/连续运动/字幕可读时长/字体与许可检查、正式确认公开入口、修改/取消清理、素材全模态与长资料、43风格86横竖真实基线、全部22FR/92AT/16Agent/5用户验收与自托管运维仍未完成。C0/C1/C2均未达。目标保持完整项目；无push/生产部署。
