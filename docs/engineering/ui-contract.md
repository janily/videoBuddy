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

核对 UI 的浏览器测试使用明确协议夹具，不能证明媒体 QA 或最终用户验收。封面能力尚缺，入口禁用并说明原因；制作质量门槛和正式批准入口保持原有阻断。
