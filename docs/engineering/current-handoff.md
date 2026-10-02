# 当前工程交接（2026-10-02）

这是阶段交接，不是 T21 最终完成报告。当前 C0/C1/C2 均未达到，未部署、未 push，未执行付费模型或云调用。

应用已在 videoBuddy 根目录初始化。`.git`、main、原 origin 和交付文档保留。参考 presentationBuddy 的指定 commit 后独立实现 provider，未复制无许可证源代码。43种风格采用固定上游 commit 的规则与 MIT 声明；没有拷贝示例视频、字体或权重。原设计文件通过 SHA256 回归检查，新增界面截图放 engineering/screens。

已实现：严格公共请求/SSE契约、理解patch与语义审批保护、匿名访问、生产Private Blob CAS、不可变持久消息、幂等命令/claim/effect、真实Director Workflow及SSE路由、启动/断流恢复、回复取消保护、草稿与IME、响应式单输入布局、43风格知识目录、最近项目鉴权查找、媒体SDK接口与可信runner、时间轴/预览映射/QA/修改/导出访问策略。

仍未实现的部分与缺配置必须分开看。素材直传与全模态分析、Visual/Audio/Critic链路、TTS/混音、完整预览/正式渲染及发布工作流、真实QA、safe-direct执行、播放器/工程ZIP、资源清理、43风格执行适配都尚未完成；补凭据不会自动补齐这些代码。逐任务细表见 task-ledger.md。

## 最新实际验证

Node 22.23.1、唯一 package-lock.json。每条 current-* 日志保存完整输出：

- `npm ci`：T00阶段已实际通过，908包、0 vulnerabilities；后续没有新增依赖。
- `npm test`：19文件、107项通过，包括真实已安装Mastra SDK对本地HTTP协议服务器调用。不是云模型评估。
- `npm run typecheck`、`npm run lint`、`npm run build`：退出0。Workflow实际构建注册由 `scripts/video/verify-build.ts` 另外检查；不是只检查源码存在。
- `npm run test:video:e2e`：14项浏览器测试，包含360/390/768/960/1024/1280/1440/1920、IME、请求中编辑不丢草稿、手机切页/刷新、风格弹窗、最近项目列表。测试中的API fixture只用于前端错误和草稿回归，不作为生产响应。
- Python runner：3项通过，覆盖完成/失败marker与崩溃后未知状态不重启。
- 缺真实模型/Blob/Sandbox凭据、固定运行镜像、预算与测试消耗授权；doctor输出具体名称且不输出任何值。
- 实际视频：0；43风格86基线全部 `not_run`；公开profile能力声明为空；16模型评估、92基础完整验收、5人观察及Preview部署未执行。

## 已发现并修复的问题

审查与回归证明 hot128 receipt淘汰会重启旧操作、断流会覆盖完成归档、启动409停止重连、迟到取消覆盖终态、preclaim取消卡住通道。现已保护durable receipt、final archive、启动退避恢复、CAS通道/终态和preclaim立即取消。新增预算先预约后计费，输入保守上界与输出硬限额，模型重试为0，未知效果不退款不自动重试。已知run失败可释放自己的聊天通道，无法核实状态则保留占用。详细失败→通过日志包括 budget、runtime-crash、preclaim-cancel、reconcile、recent。

## 继续开发入口

先补 T05 素材直传/分析与 T06 其它代理，再完成 T09可信固定镜像与素材传输、T10真实声音、T11复合预览及批准、T12真实QA发布，随后T13/T14完整操作。不得拿当前policy单元通过当成媒体闭环。T15–T18必须在统一执行接口和QA成立后逐风格生成新主题横竖证据；当前STYLE目录不算执行适配。T19–T21最终验收全部未完成。

本地启动与命令见根README；精确云条件与尚未实现探针见 blockers.md。默认 `VIDEO_GENERATION_ENABLED=false`。真实云测试和部署必须遵守用户授权范围，本次没有请求或执行生产部署。
