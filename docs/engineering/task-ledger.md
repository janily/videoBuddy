# 开发任务与证据

唯一规格：docs/hand-off/videobuddy-v5.1。依赖按 T00–T21 执行。

Pre-flight：T01→T02 的控制态由 project CAS 发布；T02→T03 重试纯变更不放宽语义基线；T03→T04 committed 必须在归档提交后；T04→T05 pending 上传不能永久锁审批；T05→T06 来源决定 patch 授权；T06→T07 服务端 action 决定主操作；T08→T15–18 43 slug 与分类不可变；T09→T10–12 媒体隔离/统一时钟/bundleHash/fence 不可弱化；T12→T13–14 不变产物与恢复只切指针；T15–20→T21 真实证据决定支持，不允许默认通过。

Ruling：本文计划用 T00 标题，不符合技能脚本 Task N 的提取格式；按原任务标题读取并在本 ledger 留存证据，不改交付规范。
Ruling：T00-C 缺凭据不阻断后续纯本地开发；所有依赖真实服务的门槛继续 blocked。

T00：in_progress；初始化创建过程见 bootstrap-report.md，没有虚构旧测试失败。

T00-A/B：implemented/tested locally。npm ci 成功；build、typecheck 成功；T00 5个配置/design测试通过；Playwright 10通过（首次浏览器缺失、随后隐藏status的测试定位修正，均保留实际记录）；最小 Mastra 本地协议测试见 model-adapter.log。T00-C blocked；整体不是 complete。
T01：18通过，T01-red.log 为缺目标模块，T01-green.log 为实现后的实际行为；纯契约可用。
T02：9通过，本地文件测试 adapter 在 tests/，生产默认仅 Private Blob；真实冷云实例/CAS blocked。发现 local lock 早返回导致读到未初始化，修正后重跑通过。
T03：5通过，本地 claim/effect/receipt；SDK start 集成与云故障测试待做。
T04：7通过，纯解析/reducer；归档与实际 Workflow SSE route 待接入。
T05：5通过，预约/幂等/UTF8 Markdown 本地逻辑；全模态 probe/真实分析与直传端点待做，partial。
T06：6通过，纯引导/来源/patch策略；真实 Mastra评估与16行为案例未跑，partial。
当前未达到 C0/C1/C2；deployed=false。继续 T07/T08 与后续可独立任务。
