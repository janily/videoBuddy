# T13 Director 结构化音乐候选接入

2026-10-03。接续 music-change-draft-validation.md，候选现在接入原生 Director 和 Worker 的持久聊天流程，不再只供内部手工调用。没有正式修改操作准入、混音或结果发布；候选仍 execution=not_started、budgetReservation=null。

GuidanceDecision 的可选 musicChange 只记录单一整片配乐解释：源消息、artifact/revision、原文引句、增益值及 relative/absolute 模式。必须 action=change / effect=pending_followup / executionIntent=classify_change，不同时改 brief。本轮 completed 用户消息、evidenceMessageIds、原话子串、显式整片目标和冻结当前结果必须一致；旧用户/assistant来源、伪造引句、旧版本或局部播放时间不成立。制作期间只记既有 pendingFeedback，不创建该音乐候选。没有关键词 if(text.includes(...)) 的自动执行分支，也没有固定生产回复。

本轮消息ID与当前结果的 classificationContext 在预算和模型 effect 前持久冻结。旧输入没有此域时不从新 control 回填，保留原请求字节/预算成本。服务端 plan UUID 在 operation 中先持久保存，模型不能指定；完成的结构化决定通过已验证的草稿服务落盘，op保存同一 musicChangeDraftRef。原消息hash、brief/epoch/result、任务状态及最终 control CAS 再核验，失效不启动制作。缓存 completed 决定也重新严格解析/guard，缺字段或来源不符拒绝，不补推断或重跑模型。

增益语义：『调小/再调小』的内部候选是 relative −3 dB，而不是不断设置 absolute −3 dB。明确设到某值保留 absolute；relative 必须小于0，absolute可为0。候选操作原样保留 valueMode。旧草稿省略模式仍代表旧绝对增益含义，不自动填字段、改哈希或预算。原音乐总线存在/原增益尚待核验，相对值不能直接传给 master 的绝对 musicGainDb；最终增益超出可直接修改范围时须另行处理，未声称完成该编译或执行。

失败→通过：新协议首次2个测试因schema不支持musicChange失败：正例无法解析，原话断言收到Zod错误而非授权错误；接入后GREEN。真实FileStore流程首次返回interrupted（缺分类上下文/候选链）而非succeeded，接入冻结与落盘后GREEN。相对操作首次被CHANGE_PLAN_INVALID拒绝（有效RED），扩展严格模式合同后GREEN；无默认迁移。所有较早测试失败保存为实施事实，不把缺模块或协议fixture当真实模型语义证明。

新增证据：

- guard 4项：本轮/当前结果/原话、旧或assistant来源/伪造引句/播放时间拒绝、禁止同时改brief/制作意图、absolute0与relative0边界。
- FileStore/Python CAS 流程4项：实际候选落盘、正常冷重放零第二决定；指针fsync后确认丢失并模拟所有读取POWER_LOSS，冷恢复同plan UUID/ref、决定1次/预算calls1；解释期间consent变更无候选指针/制作；旧冻结输入按原预算字节恢复、不推断新分类上下文。
- 本地HTTP协议服务器→真实Mastra流/对象解析→guard→真实FileStore用量结算：新增音乐case精确核返回整个musicChange含gainMode；拆分UTF-8 emoji、首delta先于结束、1请求、合成usage50 input/25 output settled。仅localhost、unit-only凭据，绝非grsai实际调用或语义评估。
- 新relative草稿模式1项及既有6项：冷读取保持模式，拒绝相对0；旧省略模式的同ID冷重放继续稳定。

相关4文件18项通过；完整93文件465项单元通过，44.11秒。lint/build/构建后typecheck/diff-check均退出0，两轴最终只读复审clean。没有UI改动或新增截图；此前浏览器45项证据仍见 feedback-target-ui-validation.md。本轮未重复宣称它证明远端模型或影片。

所有影片内容明确为协议字符串夹具，不是解码影片或质量证明。没有0→fake样片的生产降级、没有新模型/媒体、没有既有真实control/预算改变。原全片unknown门闩保留，用户不限调用次数/费用授权有效。本次没有执行任何外部provider请求，不能计16项真实Agent评估通过。

T13仍缺已验证音乐来源/增益、正式分类语义、预算预留和原子操作准入、可取消混音/新revision工程、完整QA/新result发布与大改新效果。C0/C1/C2和43风格86条真实基线未达到；未push/部署，完整项目目标继续。
