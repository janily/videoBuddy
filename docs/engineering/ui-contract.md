# 已确认界面的实现约束

视觉依据继续使用 `docs/hand-off/videobuddy-v5.1/docs/01_PRODUCT_AND_UI.md` 与同包 `design/`。本文只记录实现归属，不重新设计；颜色、间距、字体、左右分区和手机页签均由既有 globals.css 与设计令牌决定。项目为面向普通用户的 consumer-product，不是管理后台。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | style-picker.tsx 的 native select | 项目 preferences | 浏览器原生键盘和手机选择器 | companion.spec.ts |
| Form | ChatComposer | useDraft 与 useProject | 固定高度、resize-none、中文输入法、Shift+Enter | companion.spec.ts |
| Scrollbar | globals.css 和浏览器原生滚动 | work/chat-messages 容器 | 手机页签切换、独立结果与对话滚动 | downloads.spec.ts |
| Toast | 当前功能区域的 status/alert | 真实请求与终态回执 | 就地状态，不新增全局浮层 | downloads.spec.ts |
| CRUD | useProject 与 recent-projects | 鉴权后的 ProjectView | 既有最近项目对话框 | companion.spec.ts |

成片与效果片段共用 PreviewPlayer，成片存在时优先保留可观看、可下载的成片。ResultDownloads 复用 primary-action/text-button/preview-script，以原生 details 展开“更多”，不新建下拉组件；键盘 Enter/Space 可展开，手机单列按钮至少44px。

异步导出在提交前保存 input-bound command ID；只保存请求，不保存短期下载链接或令牌。刷新重放同一命令；失败终态后的再次点击才创建新命令。导出使用制作 SSE 通道空闲时的连接，加上聊天最多两个。离开页面只中止请求，不取消后台任务；只有“停止导出”提交明确取消命令。HTTP/SSE 不确定时显示重新连接，真实终态决定成功/失败，无计时进度或完成轮询。

核对 UI 的浏览器测试使用明确协议夹具，不能证明媒体 QA 或最终用户验收。封面由同一已发布影片的冻结首镜头中点抽帧，保留实际横竖尺寸并走私有PNG导出；制作质量门槛和正式批准入口保持原有阻断。

上个结果由 ResultHistory 在既有“更多”中显式展开，复用 PreviewPlayer；只在展开历史时显示“这是上一个结果”，不常驻内部版本号。历史播放器展开后占满结果区可用宽度，恢复按钮沿用 text-button。只有 ready 且没有制作任务时可恢复；制作中仍可观看历史，不增加历史导出或第三条 SSE。

恢复命令由 useRestoreResult 在 POST 前持久化 UUID/项目/目标；确认丢失、确认后 ProjectView 不可用或版本小于确认，均保留同一命令并显示重新连接。达到确认版本后才清除请求，ProjectView 接收保留更高 controlVersion，不覆盖草稿。聚焦、恢复可见和同项目严格 BroadcastChannel 提示只触发真实快照 GET；跨标签收到已恢复结果时提示“当前结果有更新”，不用完成轮询。验证归属 restore.spec.ts 和 restore-client-contract.test.ts。

反馈对象由 useProject / revisions/client-contract.ts 管理，播放器显式聚焦、点击及打开/收起历史时选择对应 artifact/revision。自动续签和恢复播放不改变选择；输入提示只标“整片”，不自动使用旧播放时间。首次输入冻结默认对象，刷新后若对象已不可识别，保留草稿并要求重新选择。current/previous/preview 使用同一规则，不新增定位控件。

发送前在 Web Locks 下持久保存完整原请求（两项 UUID、文字、附件、目标）；存储失败不派发。未知请求显示既有 text-button“重发上一条”，只重放捕获的原身份。普通发送选择不同目标时要求明确重发，另一标签页已清除/替换记录时旧重发不得新建身份。确认只删除匹配的命令；同文字草稿也要目标一致且可识别才清除。协议验证归属 feedback-target.spec.ts 与 feedback-target-client.test.ts；不增加 SSE、媒体权限或修改授权。
