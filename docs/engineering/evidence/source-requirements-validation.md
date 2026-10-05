# T11/T12：来源验收条件的生产、独立审核与持久冻结

2026-10-05；base `bbb603699b3b4616131e2ccfdd92ac974cc47f78`，实现 `2e56e844cbe40e5b00468026f2e3d02f2be159a4`。

## 当前实现

来源 context 绑定完整 active facts、全部 sourceRefs 与 immutable Understanding SHA。候选连续切分完整原文，segment 拼接必须逐字相等，不能删句、更正来源或丢否定条件；literal/semantic/restriction 条件在创作前生成，不由成片 Critic 自己选择。代码强制保留识别出的数字、日期和引文；这不是完整命名实体识别器，普通名称、身份等仍依赖分类员和独立审核员保守判为 literal。

native Mastra 两次独立请求：Director 角色只提出来源分类；Critic 角色重新阅读完整原文、逐段审核，不能照抄分类原因当结论。任一 reject/not_checked 都不能形成已审核条件。两个输出与各自 context/proposal SHA 严格绑定，没有“少检查一点”的自动回退。

持久阶段校验当前 control、preview operation、revision、brief、Understanding、consentEpoch、operation fence；发送前和用量落账后再次校验。两个副作用分别持久化，completed 输出在回用时再 guard，unknown 不重试。配置、模型和预算准入在新 effect 标记前完成；缺配置不锁死未发出的请求。全部 source/context/proposal/audit 引用和最终条件都可只读重验，禁止底层写入的测试通过。

这个模块已可由可信 worker 调用，但**尚未接入新预览 pipeline、不可变 FilmSpec 包与正式 QA 的条件读取**。当前批准影片仍使用既有保守 literal 条件，原 Visual v1/name guard、critical_facts、听感及运动缺口保持阻断。没有将本项基础模块称作整项 T11/T12 完成。

## 测试与失败记录

Node 22.23.1，仓库根目录。

| 检查 | 实际结果 |
| --- | --- |
| 初始合同 7 项 | stub NOT_IMPLEMENTED，全部 RED；实现后 7/7 GREEN |
| 初始持久阶段 2 项 | stub RED；首次实现因把含 contextSha 的对象送入严格 input 再 RED；显式只传来源 input 后 GREEN |
| 弯单引号 `‘观察成长’` | 初始错误允许纯 semantic，RED；增加完整引文 floor 后 GREEN |
| 配置缺失恢复 | 初始 effect 错误留 started，RED；准入提前后无 effect、可补依赖继续，GREEN |
| 定向 3 文件测试 | 13 项通过，3.86 秒；之后追加 native 发送前 fence 用例，由下方全套覆盖 |
| 审查修正后的定向测试 | 3 文件、15 项通过，4.61 秒 |
| 初始 `npm test` | 129 文件、655 项通过，58.27 秒 |
| 修正后 `npm test` | 129 文件、656 项通过，60.06 秒 |
| `npm run lint` | 退出 0 |
| `npm run build` | 退出 0，Next 16.3.8 生产构建成功 |
| 构建后 `npm run typecheck` | 退出 0 |
| `git diff --check` | 退出 0 |

最终合同 8 项、持久阶段 5 项、native transport 2 项。覆盖完整原文/事实/引用绑定、独立审核拒绝、数字/日期/引文不能降级、只读零写入、unknown 审核不重试、分类期间取消、缺配置恢复及完整审核请求 preflight；native 两请求发送完整来源与独立审核输入，每次本地响应 123 input/67 output 准确 settled。发送前第二 fence 拒绝时 0 HTTP、started 用量保持 unknown，不退款。这里的响应是本地协议 fixture，**不是外部模型对真实事实作出的分类或质量判断**。

## 原真实资料的只读实核

命令：`npx tsx scripts/video/probe-source-requirements.ts --verify-source-floors`。结果见 [实际来源 floor 记录](source-requirements-floor-probe.json)。读取原 FilmSpec `2218d7f2…`、Understanding `2b6fd6be…`、完整 facts `60f3ad98…`，原文 1 项全文保留；context SHA `bb8c8b28a45f5a75ee63dbc14055db9a64742742b18cd1e07110d1efb7cd169b`。

真实原文包含“观察成长，耐心照料”引文，诊断的整段 semantic 候选被 `CONTENT_REQUIREMENTS_LITERAL_MISSING` 拒绝；保守全文 literal 候选结构有效，但未执行审核、未形成 semantic 审核证明。0 网络/模型/渲染、混音、ASR 执行；原 control、budget、两 operation、9 native 回执及旧 unknown 的 project budget/gate 不变。初次诊断错误把 journal operation ID 当成完整 operation 对象读取，报 STORE_NOT_FOUND，发生在报告准入前；改为两个实际 operation 后实核通过，没有模型请求或重置任何生产状态。

## 待完成与阻断

需要版本化纳入新预览不可变包和正式内容 QA，保留已有包哈希；之后真实运行来源分类/独立审核和语义检查。旧全片 Critic 180 秒超时，没有 raw/usage，unknown reservation 继续保留；不能借新账本冒充对账或解除原调用。

完整全片运动/听感/许可与字幕 QA、公共正式制作/修改闭环、全模态长资料、43 风格 86 横竖及公开 profiles、22 FR/92 AT/16 Agent/5 用户验收、恢复/清理/自托管运维仍待完成。C0/C1/C2 未达；本轮没有 push 或部署。

## 双轴审查与修正

两轴均发现 P2：审核请求包括完整 context 和候选 proposal，初版只在 native sender 检查完整 180000 bytes 上限；effect 已写 started，却尚未发送。合法 65 个事实、每段合法 3000 字符 reason 的 FileStore 反例先 RED：首次 CONTEXT_LIMIT，第二次 EFFECT_UNKNOWN。首个测试 fixture 缺真实配置而提前失败，补齐本地配置后复现了准确的 unknown 锁死。

修正将 `requirementsPayload` 作为同一份纯请求校验供准入和 native sender 复用，两 phase 在新预算和 effect 前核验完整载荷；预算估算使用实际 payload 字节。新 FileStore 回归两次均 CONTEXT_LIMIT，只保留一次已完成的候选 effect，无审核 effect，无 project budget。没有修改已有真实 unknown 记录。修正 commit `c965061`；全套 129 文件、656 项通过，60.06 秒，lint、生产构建和构建后类型检查均退出 0。固定快照 `bbb603699…c965061bc776dd8796e0698f50555fda9b11470e` 两轴复核均 clean。

- Spec：独立 FileStore 原 65 事实反例两次 CONTEXT_LIMIT，fetch=0、proposal 1 次，只留下已完成 proposal；相关 2 文件 13 项通过。
- Standards：独立纯内存完整超限候选两次 CONTEXT_LIMIT，预算准入 0、effect 准入 0、网络 0。

两轴结论仅覆盖该来源条件基础模块，不代表 pipeline/frozen package 或整项 T11/T12 已完成。
