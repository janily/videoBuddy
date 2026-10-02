# Codex开发入口｜VideoBuddy v5.1（空仓库）

## 直接执行的任务

在我当前的 **videoBuddy 空仓库根目录**从零初始化应用，按需参考presentationBuddy的工程组织和可复用模块，按照本包实现**完整、可部署到Vercel的视频Agent应用**。用户已批准Easy Companion 2.1视觉与交互。不要重新生成视觉方向、恢复专业工作台或删除右侧聊天。

本包为唯一开发基线，不需要再读取历次v1–v4。`docs/`是规范，`design/`是已批准外观参照；存在解释冲突时以本包业务规则和明确的schema为准，记录解决方式，不能自行改产品目标。合同例子不代表SDK原生API。

**目标仓库就是当前videoBuddy。** 不需要用户先手工复制模板；不更改origin、不覆盖.git、不在交付文档目录里另建应用。参考仓库不等于现有代码。

## 先读这些

1. `README.md`、`docs/00_EMPTY_REPO_BOOTSTRAP.md` 与 `docs/01_PRODUCT_AND_UI.md`：空仓库起点、范围和不可变交互。
2. 浏览器打开 `design/preview.html`，看 `design/screens/02_collect_desktop.png`、`03_preview_desktop.png`、`06_mobile_chat.png`；保留现有颜色、排版和单输入结构。
3. `docs/02_DOMAIN_AND_STATE.md`、`03_RUNTIME_STORAGE_SECURITY.md`、`04_AGENT_AND_MEDIA.md`、`05_API_AND_SSE.md`：真实服务规则。
4. `docs/06_IMPLEMENTATION_PLAN.md`、`07_ACCEPTANCE_AND_DEPLOYMENT.md`：按任务与证据执行。
5. `contracts/public.schema.json`、`examples/`、`acceptance/`：对齐接口、非法输入和测试矩阵。

合并的 `VideoBuddy_Codex_Development_Spec_v5_1.md` 与上述章节内容一致，适合总览，不要再自行组合旧文件。

## 不得改变

- 桌面左结果、右常驻聊天；一个文字输入；Agent逐步帮助收集和理解资料，不是填写长问卷。
- 默认没有左导航、内容标签、步骤条、镜头轨道、常驻版本号或一堆参数；已确认视觉不再推翻。
- 先看效果→一次“就按这个做”的正式制作确认；内部故事校验不伪装成用户审批。
- Safe direct小修改关联用户明确消息、限预算且可撤销；大改先看新效果；不覆盖旧产物。
- Vercel Workflow负责持久执行，Mastra负责Agents/tools/结构化结果，Sandbox负责隔离媒体；不重复两套DAG。
- 不增加数据库、ORM、Redis、用户表、登录或订阅；Private Blob、匿名访问保护、预算与持久消息必须实现。
- SSE和消息系统不能替换成定时轮询；网络断开不取消任务；停止回复不取消制作。
- 全部43风格是交付范围，不能只有图鉴或Swiss兜底。运行性能与GPU能力必须实际验证。
- 原型计时器、固定回复、8秒无声样片和概念图不得进入真实生产返回值。
- 不将密钥放浏览器/工作流参数/生成代码沙箱；输出工程不包含字体文件、模型权重或私密素材外的多余数据。
- 不reset/覆盖未提交代码，不擅自push远程main或Production部署。

## 实施方式

先执行T00-A：读取已有Git/README/交付文件，识别缺少package/src/lockfile并在原仓库根目录初始化；接着T00-B建立测试、参考复用与兼容性；T00-C执行已授权云探针。首次生成lockfile之后才能npm ci；不能把不存在旧测试当成错误，也不能把未接入服务伪装成功。沿T01–T21依赖逐项推进。**不要在完成T00–T02、一个静态页面或第一个风格后就把整个任务标完成。** 四批风格在基础接口稳定后可并行，但修改同一数据契约需要协调。

每任务先写失败测试，执行确认失败，再实现最小正确行为，再验证与相关回归。保存可审查的本地commit；报告具体文件、运行命令、实际结果、截图/视频和未完成项。按实际可用的superpowers执行/TDD流程；没有子代理工具就自己顺序执行，不以工具不可用为由跳过测试。

付费模型/云测试只有项目负责人已提供凭据并授权测试消耗时执行；配置缺失不伪造结果，也不因此放弃其他独立任务。将精确阻断、需要的配置和可运行的后续命令写入 `docs/engineering/blockers.md`。真实QA未通过时保留预览但不冒充最终交付。

当前是新空仓库：所有项目直接采用preview_first；没有旧PPT项目要迁移，不创建双审核兼容层、旧路由或旧存储。后续接续开发若已有代码，增量实施并保护用户改动。

## 每次停下时交付给人看的报告

本次完成的任务ID、改动文件、失败→通过测试记录、实际界面/媒体证据、当前完成层级C0/C1/C2、阻断项。把implemented/tested/deployed分开写。下次可从任务记录继续，不依赖一次无限长对话。

## 最终完成标准

达到C2：完整小白闭环、全部22功能要求、92条基础验收、16项Agent行为评估、43风格86条横竖基线及所有公开profile检查、Vercel Preview真实验收、恢复/安全/预算/清理/回滚说明。不能用文档包的静态自检替代软件测试。

---

### 可复制给Codex的一段话

我当前打开的是独立的videoBuddy空仓库，不是presentationBuddy，也没有旧应用代码。请从本目录的CODEX_START_HERE.md和docs/00_EMPTY_REPO_BOOTSTRAP.md开始。先在当前仓库根目录初始化Next.js/React/TypeScript/Tailwind/Mastra工程，保留.git、origin和已有文档；presentationBuddy仅作外部参考，选择性复用，不整仓复制，不创建旧PPT业务，不在交付目录里再建一个项目。然后按T00–T21完成本包的Vercel视频Agent：保留design/已批准视觉和右侧聊天，逐步理解资料，SSE与持久消息，真实效果预览后一次确认，全部43风格、质量检查、下载和自然语言修改。不加数据库或登录，不拿原型固定回复/视频替代真服务。先完成可启动工程与本地测试，再验证已授权云资源。缺凭据记录阻断并继续可独立工作。不要在一个风格跑通后宣布完成；未经授权不push、不生产部署。
