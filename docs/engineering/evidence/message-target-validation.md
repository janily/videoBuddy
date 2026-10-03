# T13 反馈目标持久来源

2026-10-03。检查修改授权链发现：SendMessageRequest 中已有严格 FeedbackTarget，但 messages POST 归档用户消息时丢弃 target，Director 因而只得到文字。不能靠当时 currentResult 或旧播放时间补回这个来源。

改动：从已验证且已绑定幂等哈希的 canonical 请求保存原 target，ArchivedMessage 保留 optional/null/object；只把用户消息的 target 传入 Director SourceMessage，进入既有持久 director-input。目标 ID 不授予资源访问、制作或修改权限；执行修改仍须独立核对 owner、实际可访问产物、用户授权、当前基线、预算和质量门槛。

先失败：测试初次运行503源于缺少测试预算/model配置，修正本地fixture后再运行，实际202但归档 target 缺失，退出1。该缺失断言是有效行为RED；保存原值后GREEN。

新增3项使用临时真实生产 FileStore/Python CAS、路由 Request/Response 与匿名 owner cookie，验证 foreign owner404、202准入、原目标归档、冷重放、同 clientMessageId 更换目标409、GET返回原目标、只有一条用户消息、注入 Director 消费原 target且无 production。fixture heartbeat仅满足路由准入，未宣称真实Worker运行或远端模型验证；注入模型决定只有一次，0provider。另两项分别保存 null 和省略字段，不推断产物或播放位置。

相关新route/local-director共17项通过；完整89文件447项通过，lint、build、构建后typecheck、diff-check均通过，两轴复审clean。没有 UI 变更或新截图，没有媒体产生，没有修改既有真实 control/预算/未知调用。

当前浏览器 send 仍使用 target:null，真实当前/历史播放器目标选择及原命令持久绑定尚待实现；不能仅凭当前结果指针假定用户所指视频。音乐反馈仍需整片语义，无主动定位时不用旧 playhead。ChangePlan 分类/授权操作→新revision重混音→完整QA→新result发布及完整修改闭环继续未完成；本增量只关闭显式目标已到API却丢失的缺口。T13/C0/C1/C2及43风格86真实验收仍未完成，未push/生产部署。
