# T14 过期协调与用户活动验证（2026-10-03）

实现范围：项目期限到达后的持久 tombstone、撤销授权和操作取消；每页最多100个 control，维护游标保存在本地状态，冷启动继续；恢复按钮采用相同协调逻辑。尚未删除文件、全局缓存或容器；返回 cancelling，不把 operationsPending=0 当作物理清理证明。整体 AT-045/T14 仍未通过。

本人访问已过期项目返回410，其他 owner 返回404；主动删除仍返回404。过期标记不会因重复扫描再次增加 consentEpoch/controlVersion。CAS重核当前 expiresAt，用户在扫描期间延长期限时保留项目。期限定值畸形时 owner 失败关闭，其他 owner 不可见；单项目异常记录失败并继续健康项目。维护阶段没有模型调用。

活动来源：首次聊天命令准入、首次预览/批准/恢复结果、上传准入和上传完成、首次取消以及显式导出/恢复请求。准入 control CAS 内重新验证当前删除/期限；冷重放不续期。导出及恢复的活动使用不可变原命令时间戳、命令 namespace 的 hash 绑定和单调 control 更新。用户消息归档、资料分析、Worker heartbeat、GET、SSE及冷恢复均不记录新用户活动。后台资料分析改为保留原期限；过期项目不会发起新的 PDF/ASR 分析，Director 在付费入口前仍核期限。

失败→通过与独立审查：

- 过期模块缺失首轮失败；幂等 tombstone、操作取消、owner410/foreign404、100项目页游标冷恢复、用户活动竞争、ACK丢失及坏期限隔离通过。
- 三种后台 Markdown/PDF/音频分析原先全部延寿30天，过期PDF还发起抽取；四项RED后修复。上传首次准入活动遗漏RED后修复，重复请求不续期。
- SPEC P2：用户接受新预览仍保留旧期限，随后被扫描取消。新预览活动测试RED后修复，prepare/approve/restore及取消的首次CAS记录活动。独立原复现转 retained。
- SPEC P2：初始access过期、并发活动延寿，协调已retained但recover仍抛旧410。改为重新检查owner并继续；独立原复现现200，route注入测试通过。
- STANDARDS P2：取消请求初始access通过、CAS前到期，活动touch复活项目。两项RED后在所有首次活动CAS内核当前期限；本人请求410且control不变，restore/exportcancel共用同一检查。
- SPEC P2：聊天初始access通过、后续写入前到期，消息归档复活项目。真实路由独立复现关闭；新chat准入、序号预约与user归档均检查当前期限。ACCESS/EXPIRED不转换为可重试START_FAILED。
- 两轴P2：聊天首次准入后、归档前崩溃，隔一天恢复同UUID却二次延寿。新真实FileStore+Date.now测试RED后把归档改为仅持久化/核有效性，首次chat准入负责活动。两轴独立冷恢复自动延寿0毫秒。

目标五文件53项通过（retention、commands、project API、delete/recover route、Director），类型检查与lint通过。最终完整单测、构建及构建后类型检查结果见本文件末尾验证记录。没有新增UI，未增加截图或浏览器计数。现有浏览器/媒体证据不能替代上述真实新主题全片验收。

新收费模型调用0，所有故障注入均在临时根目录，未改动真实诊断项目、媒体或 unknown 用量。两个审查轴最终clean。源文件与函数接口改动是T14增量，C0/C1/C2未达到，deployed=false，未push/生产部署。

限制：本地目录库存有50,000条entry安全上限，分页只限制每次control读取/协调数量，不声称支持无界目录。维护每60秒处理一页、可能延迟或失败；访问权限依赖实时期限校验而不是扫描准时性。文件/缓存/容器证明与清理、最长运行任务预算协调、运维恢复及实际Linux验证继续开发。

最终验证：`npm test` 86文件433项通过；`npm run build`、构建后`npm run typecheck`、`npm run lint`、`git diff --check`均通过。最后新增的冷聊天恢复测试包含在433项内。两个轴分别独立复核，均无剩余实质发现。
