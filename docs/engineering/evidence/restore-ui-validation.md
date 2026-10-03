# 上个结果与版本恢复界面

2026-10-03，T13/T14。ResultHistory 在已有“更多”中显式展开上个结果，复用 PreviewPlayer；只在查看历史时标“这是上一个结果”。恢复调用已有服务器 CAS/真实文件验证接口，不重新渲染，不改变聊天草稿、已有下载或制作授权规则。制作中和非ready状态禁止恢复，但保留历史观看。

useRestoreResult 在请求前保存项目/目标/原命令UUID，不存令牌或下载地址。POST确认丢失后刷新/重连重放同一命令。服务器确认后，只有 ProjectView 达到确认 controlVersion 才清除记录；暂不可读或旧版本继续保留原命令并禁用重复恢复。较高controlVersion不会被迟到旧快照替换。聚焦、恢复可见和严格同项目BroadcastChannel触发真实GET及“当前结果有更新”提示，不增加历史SSE或完成轮询。

失败→通过：初始页面缺入口失败，持久输入边界缺模块失败；独立SPEC P2确认200后GET503仍显示旧视频且已丢恢复路径，503/旧版本两项RED后保留原命令及最低视图版本校验GREEN。peer/focus缺刷新RED后GREEN；手机历史播放器300px未占满可用342px，RED后用原生更多的有播放器变体补齐宽度。构建前空notice可空错误和初始effect同步状态lint均修正后通过，没有压制规则。

最终83文件396单元、37浏览器（其中10项恢复）、lint、无警告build、构建后typecheck、diff-check均通过，设计strict audit零finding。两轴独立复审P2已关闭。浏览器命令使用独立/tmp输出；一次并发浏览器审查关闭临时开发服务器造成connection refused，重用本轮持有的dev服务器后原断言正常RED/GREEN，未算功能失败通过。测试输出NO_COLOR/FORCE_COLOR冲突为工具配置提示。

实际 Chromium [桌面](restore-ui-desktop.png) 和 [手机](restore-ui-mobile.png) 截图保留既定视觉，手机键盘展开/无水平溢出/历史播放器全宽/制作禁恢复通过。测试使用明确ProjectView/REST协议和不可播放媒体夹具，证明交互和恢复协议，**不证明真正合格视频恢复、最终媒体QA或新主题完整用户闭环**。原真实全片Critic超时unknown/历史质量失败不变，本增量0模型调用，原诊断control和账本未改。

正式视听QA/旁白字幕/许可与修复、自然语言修改、清理、43风格86真实基线和最终验收继续未完成，C0/C1/C2未达到。仅本地提交，未push或部署。
