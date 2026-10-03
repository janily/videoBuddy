# 成片下载界面验证（2026-10-03）

基点 `cb5ef5b06d194f198d472d1a0af34a63266aa78b`。该增量接通已合格发布成片的客户端界面；不改变正式制作、质量策略、发布、鉴权或模型预算。

## 实际实现

- ResultStage 优先展示 currentResult；现存 currentPreview 或新版本制作/失败不能遮住旧成片。成片/片段共用原 PreviewPlayer，保留播放器和聊天输入，不重新设计。
- 主按钮真实 POST exports(mp4)，校验同源/项目/返回 artifact/purpose/短期有效期/文件名/MIME 后，浏览器原生下载；每次点击重新取访问地址。
- “更多”使用原生 details，包含字幕、文案、来源与许可记录、质量报告、工程包。封面明确禁用并说明未开放，不用示例文件替代。
- 导出请求在 dispatch 前持久化同一个 clientCommandId 与输入；刷新和连接不确定时重放，不生成替代命令。只有已验证失败后的用户再次点击才开启新尝试。存储不含签名 URL/token；localStorage 不可写时不发送无法恢复的异步任务。
- 202 后短读 operation 获得实际 status/epoch，之后通过原 SSE parser/reducer 跟踪真实事件，无完成轮询。冷失败/预认领取消无 stream 的情况以 operation 状态收束；成功后等待用户明确点击下载，不后台自动下载。
- 聊天保留独立连接；生产占用通道时暂缓导出 SSE、保留任务，生产结束接续回放。最多两个 SSE。导出不调用 conversation recover。
- 只有“停止导出”发送 scope=export。cancelCommandId 在发送前持久化，丢失响应后刷新重放原取消命令；页面关闭只中止客户端网络请求，不取消后台工作。
- 异步生命周期使用同一挂载 AbortSignal，旧挂载响应不会更新新界面。正在进行的 MP4 下载不会覆盖另一项持久导出状态。其他标签页修改恢复记录不替换当前界面的活动请求。

## 实测证据

- 修改前完整单元基线：78 文件 / 371 项通过。
- TDD：新增边界模块缺失先失败；新增下载页面 2 项先失败（原页面无成片/更多），实现后通过。
- client boundary：2 项，拒绝跨项目恢复、过大/多余字段记录、外站/javascript/play/过期/错误 artifact/非法文件名链接。
- Playwright 下载专项：8 项通过。实际 Chromium 原生 download 事件、同命令 SSE 完成、刷新/503恢复、终态失败新命令、390px键盘操作/无横向溢出/生产期间≤2连接/独立取消、实际 SSE 错误原因/旧成片优先、丢失取消响应恢复、A旧终态查询迟到不覆盖B新任务。
- 初轮 StrictMode 恢复请求次数测试失败（开发模式重新挂载会重放相同命令），改为检查命令身份与明确重连新增一次请求；网络请求允许幂等重放，未放宽身份或持久要求。
- 手机/桌面截图：`.video-local/ui-downloads-mobile.png`、`.video-local/ui-downloads-desktop.png`，人工查看手机端控件/留白/文案和布局。测试播放器 URL 故意404，不作为真实播放或质量证据。
- 设计严格静态审核第一次发现既有 native select 决策缺失及 textarea resize 归属缺失；在 premium-ui.json 记录原生选择器，在既有 textarea 加等价 resize-none 类，未改变视觉。最终 strict 报告 0 findings（`/tmp/vb-ui-audit.json`）。UI 维护约束见 `../ui-contract.md`，原 design/ 仍为视觉依据。

- STANDARDS 独立发现旧 A 导出 GET 迟到覆盖新 B 的 P2：确定性门闩测试等待 B 首次 GET 完成后释放 A，先失败（私密资料错误替代活动任务）；按挂载信号、captured commandId、activeOperation 三项检查修复后通过。复审的独立 React/Chromium 探针确认 B 保持 pending、更多禁用、停止按钮存在；MP4 期间收到终态的竞态也通过。
- 最终完整回归：79 文件 / 373 单元测试、26 浏览器测试、lint、build、构建后 typecheck、diff-check 全部退出0。两轴独立审查无剩余实质发现。
- 一次完整浏览器运行因独立审查与主测试并发写相同 test-results，出现3个 ENOENT（trace产物缺失）；隔离 --output 后完整26项通过，未跳过任何行为断言。

## 限制

浏览器路由使用明确的协议夹具和 attachment 字节；不是真实 MP4/ZIP 的公开质量发布证据。后端已有真实冻结文件验证，但当前原诊断项目无合格 currentResult，未伪造质量报告或改其控制态。仍需实际合格成片→用户下载闭环，以及封面、修改/恢复产品入口、清理、43风格86个真实基线和整体验收。原 MODEL_ACCOUNTING_MIGRATION_REQUIRED 阻断不变。本次0模型请求/0付费、未push/部署，C0/C1/C2未达到。
