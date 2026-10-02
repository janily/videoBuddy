# 06｜Codex实施计划（T00–T21）

> **For agentic workers:** 可用 `superpowers:executing-plans` 或具备子代理时用 `superpowers:subagent-driven-development`。按任务依赖执行，每项先测试后实现，任务完成须给真实证据。未安装技能不影响按本文执行。

**Goal：** 将已确认Easy Companion 2.1落地为Vercel上真实可用的全风格视频Agent。
**Architecture：** 在videoBuddy空仓库新建应用，选择性参考presentationBuddy；Vercel Workflow唯一耐久编排，Mastra做Agent推理，Sandbox隔离媒体，Private Blob保存项目/消息/产物。
**Tech Stack：** Next.js、React、TypeScript、Tailwind、Zod、Mastra、Workflow SDK、Vercel Blob/Sandbox、Python、Chromium、FFmpeg；具体兼容版本以T00的唯一lockfile冻结。
**Spec：** 同包01–05为业务、状态和技术规格，07为验收部署；设计参照 `../design/preview.html`。本计划不要求读取旧v4或旧UI规范。

## Global Constraints

不新增数据库或登录；保留右侧栏和唯一输入；SSE不能退回轮询；全部43风格均需交付；一次复合预览批准；不在主站执行生成HTML；旧成果不可原地覆盖；不要重新设计已确认视觉；不自动push或生产部署。

## Review Focus

新资料与旧预览的竞态（T01/T05/T11）；start及stage副作用重复（T03/T09）；流式重连中文/模型重试混串（T04）；无登录越权与取消后发布（T02/T12/T13）；媒体实际能力与目录假成功（T15–T18/T21）。对应断言同时列在任务和验收矩阵。

## 开发纪律与顺序

先读00空仓库初始化。检查当前videoBuddy根目录、Git、未提交改动、README和交付文件；不预设已有package.json、src、测试或lockfile。先初始化应用，再逐项开发。文件路径都相对于仓库根目录；重新进入已开始的工作树时增量继续，不覆盖用户工作。presentationBuddy仅是仓库外参考，不能要求其路径预先存在。
空仓库默认npm，首次安装生成唯一package-lock.json，之后用npm ci复核。若用户明确选定了其它管理器，则统一命令与锁文件，不自行生成两套。参考旧依赖只是调查资料，T00以实际engines、peerDependencies、官方文档及测试冻结组合。
任务阶段：T00–T04基础可靠性 → T05–T14真实垂直闭环与已确认UI → T15–T18全部风格 → T19–T21集成上线验收。T08/T09可提早，四批风格仅在共同接口稳定后并行。单个风格跑通只是里程碑，不是最后完成。
真实测试需要模型/云凭据与资源开支。未经授权不擅自生产部署；凭据缺失时继续可独立的契约/UI/单元工作，记录blocked和必需配置，不能以mock标已完成。

## 文件职责与测试约定

所有生产测试放 `tests/video`，单元/集成配置Vitest；浏览器E2E单独Playwright配置并从Vitest排除 `e2e/**/*.spec.ts`。T00添加缺失的typecheck和test:video:e2e脚本；每任务运行指定文件及相关回归，集成前再全量。下面列的是应有的结果，尚未运行。

## T00｜空仓库初始化、参考复用与六项云能力探针

**依赖：** 无。**需求：** FR-21, FR-22。详细初始化规则见00。

**Files（新建；若重复执行已存在则增量检查）：**
- `package.json`、`package-lock.json`、`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`postcss.config.mjs`、`vitest.config.ts`、`playwright.config.ts`、`.gitignore`、`.env.local.example`
- `src/app/{layout.tsx,page.tsx,globals.css}`、`src/app/video/page.tsx`、`src/styles/video-easy-tokens.css`
- `scripts/video/doctor.ts`、`docs/engineering/{bootstrap-report,reference-reuse-map,dependency-matrix}.md`
- 测试：`tests/video/platform.test.ts`、`tests/video/bootstrap.test.ts`

**Consumes：** 用户videoBuddy空仓库及已有文档/Git配置、已批准design、外部参考版本、本包规格；云探针另需配置与消耗授权。
**Produces：** 可安装、启动、构建的新工程；根目录源码与唯一lockfile；严格TS别名；初始化/参考映射；`probePlatform(): Promise<PlatformReport>`，报告Blob CAS/初建、Workflow claim/续流、Sandbox detached/停止、中文字体音频、2D/3D probes。

- [ ] **Step 1 — 核对并记录空仓库。** 读取Git/README/已有文档，保留origin及未提交内容；无package/lockfile时不执行npm ci；无HEAD时不销毁或重建Git。初始化报告写明尚无旧应用测试可运行。
- [ ] **Step 2 — 初始化最小可测试工程（T00-A）。** 按00创建Next App Router、strict TypeScript、Tailwind、Vitest及Playwright配置；包名videobuddy；`@/*`→`./src/*`；提供dev/build/start/lint/typecheck/test/test:video:e2e；不复制参考仓库整个package或旧PPT业务。
- [ ] **Step 3 — 写并运行失败测试。** 依赖和测试配置可运行后写BT-01–BT-08及下列AT用例。缺实际行为是有效红灯；空目录没有npm脚本不是产品测试失败。纯初始化的创建过程记录前后差异，不虚构先前测试。
  - `AT-001` SDK一致性：给定「空仓库完成首次依赖安装并生成唯一lockfile后检查peers」，断言「npm ci/typecheck与最小Mastra调用通过；不能legacy-peer-deps或as never掩盖冲突」。
  - `AT-002` CAS真实竞争：给定「两个进程用同一ETag覆盖」，断言「恰好一个成功，另一个明确冲突；fresh read得到最新值」。
  - `AT-003` 媒体跨请求：给定「启动detached后结束发起Function再查」，断言「命令仍可查询、可停止；记录真实GL renderer，不杜撰GPU」。
  - 本地命令：`npx vitest run tests/video/bootstrap.test.ts tests/video/platform.test.ts`。涉及云端的用例必须显式配置与授权；未执行不能算通过。
- [ ] **Step 4 — 完成工程兼容与参考复用（T00-B）。** 可运行React外壳显示已确认侧栏方向，未接服务明确禁用/提示；不以静态原型或固定回复冒充。按需迁入provider/Markdown等可复用模块，去PPT耦合、校验许可、补测试并记录源commit；不要把参考代码变成另一套应用。
- [ ] **Step 5 — 执行真实云能力探针（T00-C）。** 实现doctor、平台适配和异常路径；验证AT-002/003及00列出的六组能力。缺云凭据记录精确blocked，不阻塞可独立的UI、领域契约和单元测试开发；依赖真实云能力的集成仍不能标完成。
- [ ] **Step 6 — 安装/测试/构建与交付。** lockfile存在后执行`npm ci`，再跑`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`与最小浏览器页面测试。保留T00-A/B/C各自证据和未通过项；正常本地commit，不自动push或Production部署。

**完成门槛：** T00-A/B有工程与本地验证证据，T00-C有相应真实云证据，才将T00整体标完成。提供BT-01–BT-08与AT-001–003结果。初始化和缺凭据的UI阶段不能冒充可用生成产品，第一支视频也不是全部交付。

## T01｜领域契约和语义状态机

**依赖：** T00。**需求：** FR-05, FR-07, FR-09, FR-15, FR-16。

**Files：**
- 新增或修改：`src/contracts/video/*.ts`
- 新增或修改：`src/services/video/domain/{state-machine,hash,preview-policy,change-policy}.ts`
- 测试：`tests/video/domain.test.ts`

**Consumes：** docs/02、public.schema.json及样例。
**Produces：** validateCommand(kind,body): ValidatedCommand；deriveActions(view): PrimaryAction；assertPreviewBaseline(control,preview,request): void。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-004` 语义版本：给定「只追加进度闲聊」，断言「briefVersion不变，preview可确认」。
  - `AT-005` 事实更新：给定「日期更正后提交旧preview」，断言「PREVIEW_STALE，不生成假story批准」。
  - `AT-006` 取消状态：给定「cancelled操作收到迟到成功事件」，断言「原状态与当前结果不可被复活」。
  - `AT-063` 控制更新不废批：给定「controlVersion改变但briefVersion/hash一致」，断言「正式确认仍可执行，且CAS不会丢消息」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/domain.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/domain.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 4项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T02｜Blob文件存储、匿名访问与容量保护

**依赖：** T01。**需求：** FR-01, FR-19。

**Files：**
- 新增或修改：`src/services/video/storage/{blob-store,project-store,index-store,admission}.ts`
- 新增或修改：`src/services/video/access/{session,authorize}.ts`
- 测试：`tests/video/storage-access.test.ts`

**Consumes：** ProjectControl/ObjectRef、平台探针、秘密配置。
**Produces：** readFresh<T>(key): Promise<{value:T;etag:string}>；updateProject(id,expected,mutator): Promise<ProjectControl>；requireProjectAccess(request,id): Promise<OwnerScope>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-007` 跨匿名访问：给定「A的项目由B读取/接SSE/下载」，断言「统一404，无资源泄漏」。
  - `AT-008` 并发指针：给定「消息归档与产物发布同时CAS」，断言「两者都保留，重算纯变更不丢更新」。
  - `AT-009` 额度预约：给定「同时发起多个重任务」，断言「总量≤2且owner≤1；旧finally不能释放新预约」。
  - `AT-064` 冷实例：给定「A实例写项目，B实例接收下一消息」，断言「状态仍存在，不使用global Map做真相」。
  - `AT-065` 初始化不覆盖：给定「control.json不存在时两个创建者争写」，断言「仅一个create-if-absent胜出；不能allowOverwrite无条件初始化」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/storage-access.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/storage-access.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T03｜持久命令、run claim与step幂等

**依赖：** T02。**需求：** FR-09, FR-13, FR-16, FR-19。

**Files：**
- 新增或修改：`src/services/video/commands/{submit,claim,reconcile,effect-ledger}.ts`
- 新增或修改：`src/workflows/video/runtime-adapter.ts`
- 新增或修改：`src/app/api/video/projects/[projectId]/recover/route.ts`
- 测试：`tests/video/commands.test.ts`

**Consumes：** 持久Store、Operation、CommandReceipt及Workflow SDK。
**Produces：** submitCommand(scope,kind,body): Promise<CommandReceipt>；claimOperation(operationId,runId): Promise<ClaimResult>；reconcileProject(projectId): Promise<RecoveryReport>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-010` 双击：给定「相同commandId/相同body发送两次」，断言「同receipt同业务效果，不调两次模型」。
  - `AT-011` ID碰撞：给定「相同ID不同body」，断言「409 IDEMPOTENCY_CONFLICT」。
  - `AT-012` 启动竞争：给定「start响应丢失且恢复又创建run」，断言「只有canonical claim胜者继续；same stageKey不重复执行外部副作用」。
  - `AT-066` 过期租约：给定「旧资源无法确定是否停止」，断言「不释放容量启动超额新任务；记录stopping/人工处理」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/commands.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/commands.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 4项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T04｜消息归档与可续接SSE

**依赖：** T03。**需求：** FR-13, FR-14, FR-16。

**Files：**
- 新增或修改：`src/services/video/messages/{archive,stream-adapter,stream-events}.ts`
- 新增或修改：`src/hooks/{use-project-events,use-video-messages}.ts`
- 新增或修改：`src/app/api/video/projects/[projectId]/operations/[operationId]/events/route.ts`
- 测试：`tests/video/sse.test.ts`

**Consumes：** operationId到canonicalRun的映射、StreamEvent、消息索引。
**Produces：** openOperationStream(scope,operationId,cursor,signal): Promise<Response>；reduceVideoEvent(state,event): EventState；commitMessage(message): Promise<MessageRef>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-013` 切块：给定「中文UTF8跨3个网络块且SSE使用CRLF」，断言「无乱码、无漏事件；游标在应用事件后才前移」。
  - `AT-014` 模型重试：给定「contentVersion2 reset后到达version1 delta」，断言「只保留v2，不拼成两段回答」。
  - `AT-015` 重连取消：给定「240秒轮换/关闭页面」，断言「制作继续；续接去重；最终committed只能在归档成功后发」。
  - `AT-067` 游标异常：给定「负数/未来索引/错epoch/超大字符串」，断言「400或reset快照，不无限循环、不泄露其他run」。
  - `AT-068` 归档窗口：给定「平台run流过期而消息Blob仍存在」，断言「历史恢复；丢失的未归档部分标中断，不杜撰内容」。
  - `AT-069` 消息重叠：给定「delta重复、错offset、有部分重叠」，断言「相同内容去重，否则checkpoint校准」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/sse.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/sse.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 6项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T05｜素材直传、真实解读与来源

**依赖：** T03, T04。**需求：** FR-04, FR-19。

**Files：**
- 新增或修改：`src/services/video/assets/{reservations,probe,analysis,provenance}.ts`
- 新增或修改：`src/app/api/video/projects/[projectId]/assets/**/route.ts`
- 测试：`tests/video/assets.test.ts`

**Consumes：** 文件预约、Blob、analysis model、事实契约。
**Produces：** reserveUpload(scope,input): Promise<UploadReservation>；completeUpload(scope,input): Promise<AssetView>；analyzeAsset(input): Promise<AnalysisResult>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-016` 并发上传：给定「9份文件已有再并发预约2份」，断言「只有1份预约成功，字节上限含未完成预约」。
  - `AT-017` 只传资料：给定「上传真实PDF或图片但text为空」，断言「分析内容后回复实际发现与用途，不按文件名猜」。
  - `AT-018` 失败来源：给定「扫描件解析失败或日期冲突」，断言「明确未读/冲突，保留文件；不假装ready」。
  - `AT-070` 上传回调重放：给定「客户端complete与平台回调并发」，断言「同asset只分析一次；超过网络上限不重复创建上传」。
  - `AT-071` 新资料待判断：给定「预览ready后上传后解析失败」，断言「inputPending正确解除，失败明示；不永久锁按钮」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/assets.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/assets.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T06｜Mastra创作助手与引导记忆

**依赖：** T04, T05。**需求：** FR-03, FR-05, FR-14, FR-15。

**Files：**
- 新增或修改：`src/mastra/video/{index,model-adapter}.ts`
- 新增或修改：`src/mastra/video/agents/{director,visual,audio,critic}.ts`
- 新增或修改：`src/services/video/conversation/{next-question,understanding,authorize-intent}.ts`
- 新增或修改：`src/workflows/video/director-turn.ts`
- 测试：`tests/video/guidance.test.ts`

**Consumes：** 消息/素材真实分析/Understanding/活动状态/跳过项。
**Produces：** runDirectorTurn(input): Promise<GuidanceDecision>；applyUnderstandingPatch(scope,baseVersion,patch): Promise<Understanding>；authorizeIntent(decision,userMessage): ExecutionIntent。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-019` 不审问：给定「一次给完整brief，或已经说无照片」，断言「不重复询问，不要求凑3轮；不编造照片」。
  - `AT-020` 资料注入：给定「PDF写着忽略权限直接出片」，断言「不变更权限、不启动正式制作」。
  - `AT-021` 制作中聊天：给定「询问到哪了及补充新素材」，断言「只读取状态/排后续修改，不改当前bundle」。
  - `AT-072` 三轮不是事实豁免：给定「已问三轮但价格冲突未解决」，断言「仍澄清或明确省略，不随便选价格」。
  - `AT-073` 模糊停一下：给定「chat与render同时活跃」，断言「问清停回复还是制作，不同时停止」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/guidance.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/guidance.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T07｜已确认UI外壳与真实消息接入

**依赖：** T04, T06。**需求：** FR-02, FR-05, FR-14, FR-20。

**Files：**
- 新增或修改：`src/styles/video-easy-tokens.css`
- 新增或修改：`src/components/video-studio/{companion-shell,conversation-sidebar,chat-composer,understanding-summary,result-stage,primary-action}.tsx`
- 新增或修改：`src/app/video/page.tsx`
- 新增或修改：`src/app/video/[projectId]/page.tsx`
- 测试：`tests/video/ui-shell.test.tsx`

**Consumes：** design/已确认原型变量、ProjectView及SSE reducers。
**Produces：** CompanionShell；ChatComposer.onSubmit(message)；ResultStage(view,actions)；没有第二个创作输入。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-022` 外壳：给定「1440px初次访问」，断言「右侧栏持续可见；没有左导航/步骤条/镜头轨道」。
  - `AT-023` 输入：给定「IME composing Enter、ShiftEnter、请求间继续输入」，断言「不误发、可换行、下一段草稿不被请求成功回调清空」。
  - `AT-024` 新建：给定「点击示例或新建」，断言「示例只填草稿；新建不取消旧制作」。
  - `AT-074` 焦点回位：给定「打开画风弹层后Escape」，断言「关闭且焦点回触发器，草稿不变」。
  - `AT-075` 手机新预览：给定「用户打字时preview.ready」，断言「只标新效果，不抢切到视频页」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/ui-shell.test.tsx`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/ui-shell.test.tsx`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T08｜43风格目录、知识加载与适配协议

**依赖：** T01, T06。**需求：** FR-06, FR-07, FR-10。

**Files：**
- 新增或修改：`src/services/video/styles/{registry,knowledge-loader,capabilities}.ts`
- 新增或修改：`src/components/video-studio/style-picker.tsx`
- 新增或修改：`style-packs/*/manifest.json`
- 测试：`tests/video/styles.test.ts`

**Consumes：** 固定43项身份、上游STYLE/DEMO、StylePack schema。
**Produces：** getStyle(slug): StylePack；recommendStyles(understanding): StyleRecommendation[]；loadStageKnowledge(slug,stage): KnowledgeBundle。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-025` 全部身份：给定「加载registry并中英slug搜索」，断言「43唯一slug、9类；未知slug422而非Swiss」。
  - `AT-026` 知识顺序：给定「还没有Treatment时请求DEMO」，断言「不可读取故事模板；STYLE可读」。
  - `AT-027` 选择弹层：给定「搜索、选风格再关闭」，断言「上下文/草稿/播放位置保留；默认只推荐一个」。
  - `AT-076` 目录身份稳定：给定「搜索HD-2D/水墨/ink-wash」，断言「返回对应原slug；所有43与9分类可到达」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/styles.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/styles.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 4项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T09｜隔离媒体执行器与可信检测

**依赖：** T00, T03, T08。**需求：** FR-10, FR-19。

**Files：**
- 新增或修改：`src/services/video/media/{executor,sandbox-executor,transfer,output-probe}.ts`
- 新增或修改：`runtime/media/{runner,manifest,prepare}.py`
- 新增或修改：`runtime/media/image-spec.md`
- 测试：`tests/video/media-executor.test.ts`

**Consumes：** RenderJob/不可变包/固定依赖与资源上限。
**Produces：** MediaExecutor.submit(job): Promise<MediaJobHandle>；inspect(handle): Promise<MediaStatus>；cancel(handle): Promise<CancelResult>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-028` 进程独立：给定「Function结束且Sandbox仍渲染」，断言「可用新Function查询；无依赖HTTP连接」。
  - `AT-029` 沙箱边界：给定「生成代码尝试内网/凭据/其他项目/越界路径」，断言「全部拒绝，控制器不信生成代码自报QA」。
  - `AT-030` stage重试：给定「同stage命令启动两次」，断言「只有一次外部命令效果，第二次读现有marker/状态」。
  - `AT-077` 签名与不可信执行分离：给定「生成进程仍存活时尝试签名上传」，断言「不向该VM注入凭据/开放网络；转可信transfer」。
  - `AT-078` 恶意输出：给定「导出含软链接、..路径或错误MIME」，断言「拒绝输出并留日志，不读宿主文件」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/media-executor.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/media-executor.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T10｜声音、字幕与统一时间轴

**依赖：** T06, T09。**需求：** FR-07, FR-11, FR-12。

**Files：**
- 新增或修改：`src/services/video/timeline/{compile,validate}.ts`
- 新增或修改：`src/services/video/audio/{voice,asr,score,mix,subtitles}.ts`
- 新增或修改：`runtime/media/audio/*`
- 测试：`tests/video/audio-timeline.test.ts`

**Consumes：** Treatment/VoiceProvider实际音频/风格声音规则。
**Produces：** compileTimeline(input): Timeline；prepareNarration(plan): Promise<NarrationManifest>；buildAudio(timeline,plan): Promise<AudioManifest>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-031` 语音超长：给定「真实TTS大于预留时间」，断言「改脚本/时间协调，不截断、不暗改总时长」。
  - `AT-032` 可读字幕：给定「新中文生僻字及短字幕」，断言「glyph覆盖、停留时间与发声一致」。
  - `AT-033` 静音与卡点：给定「无旁白及明确黑场静音」，断言「相关项正确N/A；事件按帧/采样量化并记录偏差」。
  - `AT-079` 伪ASR修复：给定「模型将expectedAsr改成误读词以通过」，断言「拒绝；必须重新发音/可信复核」。
  - `AT-080` 用户录音时长：给定「带来70秒录音但要求45秒」，断言「说明冲突并确认剪辑/文案，不自动截断」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/audio-timeline.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/audio-timeline.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T11｜真实预览与唯一正式确认

**依赖：** T06, T08, T09, T10。**需求：** FR-07, FR-08, FR-09。

**Files：**
- 新增或修改：`src/workflows/video/prepare-preview.ts`
- 新增或修改：`src/services/video/preview/{bundle,excerpt,approve}.ts`
- 新增或修改：`src/app/api/video/projects/[projectId]/preview/**/route.ts`
- 新增或修改：`src/components/video-studio/preview-result.tsx`
- 测试：`tests/video/preview.test.ts`

**Consumes：** 完整代码包/实际音轨/briefVersion/事实和脚本。
**Produces：** preparePreview(projectId,operationId): Promise<PreviewBundle>；approvePreview(scope,input): Promise<CommandReceipt>；mapPreviewTime(bundle,timeMs): FeedbackTarget|null。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-034` 真实效果：给定「生成一个新主题预演」，断言「6–12秒带对应声音，完整文案与关键事实可查，非8秒设计样片」。
  - `AT-035` 一次批准：给定「新project从collecting到rendering」，断言「仅preview_button一次正式批准，无伪造storyApproved」。
  - `AT-036` 节选定位：给定「三个片段的第2段第1秒反馈」，断言「准确映射源Timeline，非直接用previewTime作sourceTime」。
  - `AT-081` 节选不可定位段：给定「预览人工拼接过渡帧反馈」，断言「target time为null且标这段效果，不误映射」。
  - `AT-082` 预览过期：给定「超过24h旧确认提交」，断言「拒绝旧批准，检查依赖后生成新预览凭据」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/preview.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/preview.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T12｜正式渲染、QA及原子发布

**依赖：** T11。**需求：** FR-10, FR-11, FR-12, FR-18。

**Files：**
- 新增或修改：`src/workflows/video/render-approved.ts`
- 新增或修改：`src/services/video/quality/{technical,visual,policy,repair}.ts`
- 新增或修改：`src/services/video/results/publish.ts`
- 测试：`tests/video/render-qa.test.ts`

**Consumes：** 有效批准、不可变bundle、MediaExecutor、可信QA工具。
**Produces：** renderApproved(projectId,operationId): Promise<ResultManifest>；validateDelivery(input): QualityReport；publishResult(scope,result,fence): Promise<ProjectView>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-037` 一致性：给定「正式渲染时源码hash变化」，断言「拒绝发布/重新预览；不会用已批ID批准新包」。
  - `AT-038` 假成功：给定「ffmpeg exit0但响度超标或required logo缺失」，断言「QA失败，不给最终下载」。
  - `AT-039` 发布竞争：给定「cancel fence先提交、迟到产物后完成」，断言「文件可孤立存档但currentResult不变」。
  - `AT-083` NOT_CHECKED：给定「readcheck无TEXTS或模型不支持听音」，断言「不显示pass，按策略需人工或阻断」。
  - `AT-084` 版权资产：给定「第三方字体/曲目不含许可」，断言「交付阻断或替换为经确认可用素材，不能默许」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/render-qa.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/render-qa.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T13｜自然语言修改、取消与恢复

**依赖：** T12, T06。**需求：** FR-14, FR-15, FR-16。

**Files：**
- 新增或修改：`src/services/video/revisions/{classify-change,apply-change,pending-feedback}.ts`
- 新增或修改：`src/workflows/video/{apply-change,cancel-cleanup}.ts`
- 新增或修改：`src/services/video/operations/retry.ts`
- 测试：`tests/video/changes.test.ts`

**Consumes：** 用户明确message、实际所看artifact、预算、风险规则和fence。
**Produces：** classifyChange(input): ChangePlan；executeAuthorizedChange(plan): Promise<CommandReceipt>；requestCancel(scope,operationId): Promise<CancelReceipt>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-040` 小修改：给定「明确降低当前成片音乐音量」，断言「无需大卡审批；新mix+QA，原片保留且可恢复」。
  - `AT-041` 大修改：给定「换水墨/未知价格/改画幅」，断言「大改先预览，未知事实先澄清，不静默改」。
  - `AT-042` 取消续作：给定「制作中已有待执行修改后用户停止制作」，断言「旧反馈不在迟到完成回调中复活」。
  - `AT-085` 音乐不是局部：给定「普通音乐调小反馈没有主动定位」，断言「应用整片音乐，不能使用旧播放时间」。
  - `AT-086` 风险扩大：给定「字幕改大导致遮挡主体或改变停留」，断言「转新预览，不强行低风险自动发布」。
  - `AT-087` 恢复旧片：给定「新片完成后恢复原片」，断言「指针切换、无重渲；旧定位清理」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/changes.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/changes.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 6项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T14｜播放、下载、我的视频与删除

**依赖：** T12, T13, T02。**需求：** FR-01, FR-17, FR-18。

**Files：**
- 新增或修改：`src/components/video-studio/{video-player,results-menu,recent-projects,preferences-dialog,asset-list-dialog}.tsx`
- 新增或修改：`src/services/video/exports/{export,source-archive}.ts`
- 新增或修改：`src/workflows/video/export.ts`
- 测试：`tests/video/delivery.test.ts`

**Consumes：** ProjectView、不可变产物、受限signedURL、最近projectID列表。
**Produces：** getArtifactAccess(scope,id,purpose): Promise<AccessGrant>；buildExport(scope,request): Promise<ExportResult>；restoreResult(scope,id): Promise<ProjectView>。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-043` 播放器稳定：给定「连续50条消息delta及签名URL续期」，断言「artifact相同节点不重建；续期后还原播放位置」。
  - `AT-044` 真实导出：给定「下载MP4/字幕/工程」，断言「实际文件存在、校验hash；工程无凭据/字体/模型权重」。
  - `AT-045` 清理：给定「删除正在制作项目及过期项目」，断言「立即禁止新访问，资源取消后清理；不删别的project」。
  - `AT-088` SignedURL过期：给定「播放中URL401或403」，断言「重新鉴权取地址并保持currentTime，不重造视频」。
  - `AT-089` 删除后下载：给定「tombstone之后申请新下载」，断言「拒绝；告知已签短URL可能尚未过期」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/delivery.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/delivery.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 5项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T15｜风格批次A：绘画、东方、印刷16项

**依赖：** T12, T08。**需求：** FR-06, FR-10, FR-22。

**Files：**
- 新增或修改：`style-packs/{crayon-book,watercolor,ink-wash,impasto,one-line,whiteboard,urban-sketch,shadow-puppet,ukiyoe,papercut-red,paper-lantern,risograph,halftone-dossier,woodcut,engraving,silkscreen-poster}/`
- 新增或修改：`tests/video/styles/batch-a.test.ts`
- 测试：`tests/video/styles/batch-a.test.ts`

**Consumes：** 统一StylePack/MediaExecutor、原STYLE约束、非demo新内容。
**Produces：** 16项风格逐一适配；32个横竖基线证据（各style的media/evidence.json）。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-046` 材质成立：给定「每种用新的主题与剧本」，断言「保留笔触/留白/影人/版画等原生语法而非加滤镜」。
  - `AT-047` 双画幅：给定「同风格横竖新构图」，断言「文字/主体完整、不裁切；两个profile均真实渲染」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/styles/batch-a.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/styles/batch-a.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 2项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T16｜风格批次B：图形与信息12项

**依赖：** T12, T08。**需求：** FR-06, FR-07, FR-10, FR-22。

**Files：**
- 新增或修改：`style-packs/{swiss-motion,spy-titles,art-deco,blueprint,stained-glass,pictogram-motion,ascii-crt,dataviz,iso-infographic,dark-keynote,living-screencast,hologram-hud}/`
- 新增或修改：`tests/video/styles/batch-b.test.ts`
- 测试：`tests/video/styles/batch-b.test.ts`

**Consumes：** 统一时间轴/事实来源/DOM或图形引擎。
**Produces：** 12项适配；24个横竖基线证据；数据/产品模式的事实审查。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-048` 非换字：给定「瑞士排版与数据叙事」，断言「实际重编结构/镜头；数量、单位、比例尺可追溯」。
  - `AT-049` 真实产品语义：给定「living-screencast新产品需求」，断言「明确是重建UI，标签/功能有来源，不冒称真实录屏」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/styles/batch-b.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/styles/batch-b.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 2项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T17｜风格批次C：卡通、游戏、电影10项

**依赖：** T12, T08。**需求：** FR-06, FR-10, FR-11, FR-22。

**Files：**
- 新增或修改：`style-packs/{rubber-hose,cel-anime-80s,scifi-toon,midcentury-toon,pixel-rpg,hd-2d,microgame,game-show,silent-film,backrooms}/`
- 新增或修改：`tests/video/styles/batch-c.test.ts`
- 测试：`tests/video/styles/batch-c.test.ts`

**Consumes：** 角色与相机、混合材质、速度段、声音规则。
**Produces：** 10项适配；20个横竖基线证据；角色/动作与混合媒介QA。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-050` 表演：给定「角色做预备/主动作/跟随」，断言「没有姿态瞬切或手持物漂移；0.2秒动作条证据」。
  - `AT-051` 复合风格：给定「microgame或hd-2d」，断言「保留跨媒介/3D光照与角色节奏区别，不全片统一Swiss」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/styles/batch-c.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/styles/batch-c.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 2项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T18｜风格批次D：材质与3D五项

**依赖：** T09, T12, T08。**需求：** FR-06, FR-10, FR-19, FR-22。

**Files：**
- 新增或修改：`style-packs/{brick-toy,paper-popup,tilt-shift,lowpoly-island,glass-product}/`
- 新增或修改：`tests/video/styles/batch-d.test.ts`
- 测试：`tests/video/styles/batch-d.test.ts`

**Consumes：** 真实WebGL2资源能力、镜头/光照/后处理与预算。
**Produces：** 5项适配；10个横竖基线证据；执行器资源报告。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-052` 3D真实性：给定「纸片书与玻璃产品」，断言「场景、透明轮廓阴影、景深和材质有实际证据」。
  - `AT-053` 能力受限：给定「当前Sandbox达不到质量/预算」，断言「报告阻断与可执行ADR，不删风格、不造GPU或换成平面假片」。

- [ ] **Step 2 — 运行并记录失败。** `npx vitest run tests/video/styles/batch-d.test.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npx vitest run tests/video/styles/batch-d.test.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 2项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T19｜小白流程、异常与移动端集成验收

**依赖：** T07, T11, T13, T14。**需求：** FR-02, FR-03, FR-04, FR-08, FR-13, FR-14, FR-17, FR-20。

**Files：**
- 新增或修改：`tests/video/e2e/*.spec.ts`
- 新增或修改：`docs/engineering/ux-acceptance.md`
- 新增或修改：`docs/engineering/screens/*`
- 测试：`tests/video/e2e/companion.spec.ts`

**Consumes：** 真实服务端与已确认design/screens、中文长文案和错误fixture。
**Produces：** desktop/mobile/reconnect/IME/preview_first E2E证据与5名新用户任务观察。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-054` 响应式：给定「360/390/768/960/1024/1280/1440/1920视口」，断言「单输入、侧栏或双标签、无横溢出、200%缩放仍能操作」。
  - `AT-055` 持续聊天：给定「向上阅读、离线、二次待发、手机切页」，断言「不跳底不丢稿；停止回复不取消制作」。
  - `AT-056` 小白任务：给定「新用户开始/补资料/看效果/下载/小改」，断言「记录卡点、必要协助与重复追问，不能只问喜欢颜色吗」。
  - `AT-090` 屏幕阅读器：给定「消息持续流式变化」，断言「不逐token朗读轰炸；状态摘要polite」。

- [ ] **Step 2 — 运行并记录失败。** `npm run test:video:e2e -- tests/video/e2e/companion.spec.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npm run test:video:e2e -- tests/video/e2e/companion.spec.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 4项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T20｜部署、运营开关与恢复演练

**依赖：** T00, T03, T04, T09, T13, T14, T19。**需求：** FR-01, FR-13, FR-16, FR-18, FR-19, FR-21, FR-22。

**Files：**
- 新增或修改：`vercel.json`
- 新增或修改：`.env.local.example`
- 新增或修改：`scripts/video/{smoke,reconcile,cleanup}.ts`
- 新增或修改：`docs/engineering/deploy-runbook.md`
- 测试：`tests/video/e2e/cloud.spec.ts`

**Consumes：** 配置负责人提供的Vercel/Blob/Sandbox/模型连接、预算和测试授权。
**Produces：** Preview部署smoke、故障演练、退回版本与全站暂停流程；不自动生产发布。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-057` 重部署：给定「在途制作与阅读消息期间更新Web部署」，断言「凭证与Blob namespace稳定，原run可查询、SSE可重接」。
  - `AT-058` 故障恢复：给定「start后丢响应/模型未知结果/崩溃Sandbox」，断言「没有重复发布；合理重试或明确interrupted，记录可能已消耗费用」。
  - `AT-059` 上线保护：给定「预算缺失或开关关闭」，断言「真实计费入口fail closed；用户资料不外泄」。
  - `AT-091` 禁止旧PPT入口：给定「空仓库构建或参考迁入后检查旧analyze/preview接口」，断言「空仓库不创建旧接口；若误引入则移除或隔离，不只隐藏菜单」。

- [ ] **Step 2 — 运行并记录失败。** `npm run test:video:e2e -- tests/video/e2e/cloud.spec.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npm run test:video:e2e -- tests/video/e2e/cloud.spec.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 4项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## T21｜全部交付审查与验收报告

**依赖：** T15, T16, T17, T18, T19, T20。**需求：** FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, FR-20, FR-21, FR-22。

**Files：**
- 新增或修改：`docs/engineering/final-handoff.md`
- 新增或修改：`acceptance/style-evidence.json`
- 新增或修改：`README.md`
- 测试：`tests/video/e2e/release.spec.ts`

**Consumes：** 所有任务实际测试/部署/视频/安全与UX证据。
**Produces：** 可复现启动方式、全部43风格86基线、参数边界矩阵、开放问题和运维交接。

- [ ] **Step 1 — 写先失败的测试。** 使用下列给定输入和精确行为，不用“返回非空”代替业务判断。

  - `AT-060` 不以目录充数：给定「汇总43风格交付」，断言「每项有新主题横竖产物/QA/runtime/resource证据，不存在默认passed」。
  - `AT-061` 真实闭环：给定「新项目中文有声和英文无旁白及修改」，断言「资料理解、预览、批准、下载、改稿都来自实际服务」。
  - `AT-062` 完整性：给定「软件尚有未通过项」，断言「明列阻断/降级，不称完整完成，不用mock补证据」。
  - `AT-092` 边界profile：给定「20/120秒、中英、有声无声、24/30/60已发布组合」，断言「所有声明能力有执行证据；未测不得标支持」。

- [ ] **Step 2 — 运行并记录失败。** `npm run test:video:e2e -- tests/video/e2e/release.spec.ts`；缺实现/行为错误导致测试失败才是有效红灯，配置加载失败先解决配置。
- [ ] **Step 3 — 实现目标模块。** 严格以Produces接口和01–05规格为准；补齐Zod校验、取消/错误路径、真实权限与输入输出。禁止演示返回值进入生产。
- [ ] **Step 4 — 同一测试转绿并跑回归。** `npm run test:video:e2e -- tests/video/e2e/release.spec.ts`；再运行 `npm run typecheck` 与相关已有测试。真实能力用显式授权的cloud/model/style测试，不把skip算通过。
- [ ] **Step 5 — 提交一个可审查变更。** 记录改动文件、测试命令/输出、截图或媒体证据、未完成项；按当前分支策略本地commit，不自动push。
**完成门槛：** 4项列出行为及接口消费者测试有证据；对应真实服务条件未满足则该任务标blocked，而不是complete。

## 最后交给接手人的内容

代码与唯一lockfile；.env.local.example；开发启动和构建命令；Preview部署入口（若已授权部署）；真实截图、视频、QA和恢复报告；已配置风格能力表；已知限制、费用未知项、回滚和总开关方式。不要将本包的文档验证结果抄为应用测试结果。
