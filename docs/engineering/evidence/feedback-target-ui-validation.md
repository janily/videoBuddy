# T13 浏览器反馈目标与原消息恢复

2026-10-03。接续 message-target-validation.md：浏览器现在保存明确的当前/历史/效果片段 artifact 与 revision；首次输入冻结默认目标，显式打开/聚焦播放器才能改变，自动续签/播放不改变。整片反馈 sourceTimeMs=null，不带旧播放位置。新结果移除原目标后保留草稿并要求重新选择。

POST 前在 Web Locks 下持久保存完整 SendMessage 原请求。未知响应或刷新后“重发上一条”只使用原文字、附件、目标和两个 UUID。正常发送不得将不同目标的选择隐式重放为旧请求。原请求已由其他标签页确认/被替换时，旧重发按钮拒绝创建新命令。成功确认仅清除相同身份；清草稿同时要求实时选择可识别、目标和文字匹配，保留后来输入（包含同文字但新目标）。存储失败不派发。无需第三条 SSE；没有修改 CSS 或确认视觉。

失败→通过：辅助模块初次缺模块 RED 后两单元通过。独立复核发现迟到 A ACK 删除 B intent，加入 Web Locks 与双身份条件清理后跨标签实证通过。两个仓库浏览器测试分别先 RED（选择 B 后普通发送仍 A；其他页确认后旧重发生成新 UUID），修复后 GREEN。第三 RED 为原请求 target=null、等待期间新结果出现并选择后，同文草稿被旧 view 清除；排除 stale 选择后 GREEN。两轴最终独立复核 clean，SPEC 独立4项浏览器及2项单元通过，Standards 独立迟到ACK复现通过。全部复核0 provider。

实际命令及结果：

- `npm test`：首次与浏览器并行时447通过、2项15秒文件存储测试超时（voice-stage、export-operation）。单独完整重跑90文件449项通过，42.55秒；没有放宽期限或删除测试。
- `npx playwright test --output=/tmp/vb-feedback-full-green`：45项通过，8.7秒。前一次43通过/1失败为跨标签测试文本同时匹配 textarea 与已归档 paragraph；定位明确为 paragraph 后完整重跑通过。新增反馈测试8项。
- `npm run build`：首轮暴露 optional target 的 TypeScript 参数类型错误，修正后退出0、无追踪警告。构建后 `npm run typecheck`、`npm run lint`、`git diff --check` 均退出0。
- strict `audit_project.py`：0 findings，见 feedback-target-ui-audit.json。本文与 ui-contract.md 是已有 canonical contract 的增量，不新建设计方向。

截图 [桌面](feedback-target-desktop.png)、[手机](feedback-target-mobile.png) 经实际查看，保持既有分区/单输入/手机页签；390宽无横向溢出。截图是明确的 UI 协议夹具，媒体地址刻意404，不是样片或质量通过；没有将固定视频/回复放进生产服务。

0新模型请求、0媒体生产、0既有真实control/账本修改。浏览器目标缺口已关闭，但目标 UUID 不授予素材权限或改稿授权。ChangePlan 分类/授权、operation→新revision混音→完整QA→新result发布、大改新效果仍待完成。原全片 unknown 对账门闩保持；不限费用授权有效。T13/C0/C1/C2和43风格86真实基线未完成，未push/部署，项目目标继续。
