# 05｜API、消息归档与SSE协议

本章固定应用协议，不暴露Mastra或Workflow私有chunk结构。`contracts/public.schema.json` 是请求与公开事件的可验证合同，不是已实现API。所有路径统一以 `/api/video` 开头；JSON请求上限256KiB，附件走签名直传。

## 1. 统一约定

所有写命令含 `clientCommandId`（UUID），相同意图重发保留ID。消息另有 `clientMessageId`；两者各自防重，不能将一次消息重发解释成新回复。同步操作200/201；已持久接受且启动成功的长任务202；启动失败503返回同一receipt及recoverable标识。轮询不是主UI状态通道。

```ts
interface CommandReceipt {
  schemaVersion: 5; commandId: string; projectId: string;
  operationId?: string; messageId?: string; controlVersion: number;
  status: 'accepted'|'replayed'|'completed'|'reserved';
}
interface ApiError {
  error: {code: string; message: string; retryable: boolean;
    requestId: string; operationId?: string; field?: string; retryAfterSec?: number};
}
```

每条route必须用服务器解析的owner scope，忽略任何客户端owner/runId/storageKey。不可把无权限资源的内容或存在性写进错误。客户端可能已经观察到更高版本快照，低controlVersion响应不得覆盖高版本状态。

## 2. API清单

| 方法与路径 | 输入 | 输出与行为 |
|---|---|---|
| POST `/session` | 空JSON，同源 | 自动设置匿名HttpOnly cookie、返回expiresAt；不是登录页面 |
| POST `/projects` | CreateProjectRequest | 201 `{projectId,controlVersion}`；重复clientCreateId返回同项目；首次只收集，不自动出片 |
| GET `/projects/:projectId` | 无 | ProjectView：摘要、消息页、当前预览/结果、可用动作、活跃operation |
| POST `/projects/lookup` | 最多20个本浏览器projectId | 只返回有权限的最近项目简要列表；无全站list |
| DELETE `/projects/:projectId` | DeleteProjectRequest | 202，tombstone后取消与删除；关联资源停止后完成 |
| GET `/projects/:projectId/messages?beforeOrdinal=&limit=` | limit默认50最大100 | 顺序消息页、nextBeforeOrdinal；只返回已归档或明确checkpoint |
| POST `/projects/:projectId/messages` | SendMessageRequest | 202 receipt；文本或附件至少一项；不空发；一轮回复一个operation |
| POST `/projects/:projectId/preferences` | UpdatePreferencesRequest | 200/202，按briefVersion更新；影响待确认效果则失效，不修改在途bundle |
| POST `/projects/:projectId/preview` | PreparePreviewRequest | 202 preview operation；只有按钮或明确preview意图授权可触发 |
| POST `/projects/:projectId/preview/approve` | ApprovePreviewRequest | 202 render operation；检查brief与预览hash；不再有story approve API |
| POST `/projects/:projectId/changes/:changePlanId/confirm` | ConfirmChangeRequest | preview_required确认后先准备新效果；decline无生产副作用 |
| POST `/projects/:projectId/results/:artifactId/restore` | RestoreResultRequest | 200切换已保存结果；无媒体制作费用；使不匹配的修改基线失效 |
| POST `/projects/:projectId/assets/reserve` | ReserveUploadRequest | 200 assetId、reservationId、受限上传信息、expiry |
| POST `/projects/:projectId/assets/:assetId/complete` | CompleteUploadRequest | 200/202，可信探测文件，必要时进入conversation lane分析 |
| DELETE `/projects/:projectId/assets/:assetId` | DeleteAssetRequest | 移除未来使用；既有不可变版本依赖保留到项目删除 |
| POST `/projects/:projectId/assets/:assetId/retry` | RetryAssetRequest | 202重新分析；不要求用户重复上传未损坏文件 |
| GET `/styles` | q/category/aspect可选 | 43项身份、预览引用、实际可用profile和原因；没有固定Swiss兜底 |
| GET `/projects/:projectId/operations/:operationId` | 无 | operation快照、canonical stream定位、恢复建议 |
| GET `/projects/:projectId/operations/:operationId/events` | cursor或Last-Event-ID | SSE，所有权检查；无canonicalRun时返回409 OPERATION_NOT_STARTED |
| POST `/projects/:projectId/operations/:operationId/cancel` | CancelOperationRequest | 202 cancelling；已经完成返回200 already_completed |
| POST `/projects/:projectId/operations/:operationId/retry` | RetryOperationRequest | 202新尝试；服务端验证重试许可与原授权，旧操作不复活 |
| POST `/projects/:projectId/recover` | RecoverRequest | 200/202，协调reserved/中断状态；不会重复已完成副作用 |
| POST `/projects/:projectId/exports` | ExportRequest | 已有文件200 access；缺源码包时202 export operation |
| GET `/projects/:projectId/artifacts/:artifactId/access` | purpose=play/download | 临时访问地址、expiresAt、mime、filename；不改数据，不接受外部URL |

session并发首开需通过同源初始化串行化，避免两个标签创建不同sid导致一边项目不可访问。项目新建和第一条消息可由UI连续调用，但分别使用稳定ID；创建成功而消息失败时重发消息，不重建项目。

### 2.1 ProjectView必须提供的业务信息

`projectId/title/controlVersion/briefVersion/phase/understanding.summary/preferences/assets/messages/currentPreview/currentResult/previousResult/activeProduction/activeConversation/pendingInputs/actions/expiresAt`。

`actions`由服务端计算，含kind、enabled、disabledReason、targetId、semanticBaseline；UI只投影为当前一个主操作。内部runId、ownerHash、密钥、Blob key和原始QA日志不返回。消息加载与项目快照可以分批，首次快照须带可续接的当前operation和已归档消息版本。

### 2.2 写操作示例

```json
{
  "schemaVersion": 5,
  "clientCommandId": "a0000000-0000-4000-8000-000000000001",
  "clientMessageId": "a0000000-0000-4000-8000-000000000002",
  "text": "没有门店照片，就用插画表达。先做一段效果给我看看。",
  "attachmentIds": [],
  "target": null
}
```

```json
{
  "schemaVersion": 5,
  "clientCommandId": "a0000000-0000-4000-8000-000000000003",
  "previewId": "a0000000-0000-4000-8000-000000000004",
  "revisionId": "a0000000-0000-4000-8000-000000000005",
  "expectedBriefVersion": 3,
  "bundleHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "scriptHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "factsHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
}
```

预览批准客户端不传approvedStory、不传新脚本、更不传allowSkipQuality。source为服务器从此API确定的preview_button。正文schema拒绝未定义字段。

## 3. 上传不是聊天二进制

reserve检查格式、剩余额度、并发预约总量；签名只允许当前owner/project/asset的一个生成路径、一个MIME范围、最大字节及10分钟期限。直传完成前不发送“已读取”消息。complete使用预约记录定位对象并探测真实格式/尺寸，不能相信客户端size/hash。

资料附件可以先作为上传消息占位，complete幂等更新同attachment part。分析排队可读地显示“已上传，待整理”，不能谎称数据丢失；用户文字可继续在composer草稿里输入。预约超期或失败明确释放容量；已经用于当前生产包的文件即使从未来草稿移除，也不能使旧任务读不到输入。

## 4. 双通道SSE：少量连接，独立生命期

前端用fetch + ReadableStream解析SSE（可携带游标、查看HTTP错误），不用useChat反推生产状态。每项目最多两个事件连接：一个conversation，一个production；导出采用短时结果接口或复用生产lane，不常驻第三条连接。每个连接对应一个operation，底层映射到其canonical Workflow run的默认UI stream。[V03]

打开页面：GET ProjectView → 接入活跃operation从checkpoint游标开始 → terminal事件后再GET最新快照校准。自己发命令后用receipt接流；聚焦/恢复可见/本机BroadcastChannel提示时刷新快照，发现其他标签的新operation。为跨标签提供“当前结果有更新”，不每2秒轮询。没有跨设备协作承诺。

### 4.1 事件封装

每个Workflow逻辑写入chunk是一个完整JSON领域事件，≤16KiB；不是按网络TCP chunk编号。SDK adapter先保持平台逻辑chunk边界，再包SSE。`getReadable({startIndex})`使用**绝对零基逻辑索引**，T00必须验证其语义；不得把底层字节块编号当startIndex。[V03]

```text
id: 0:12
event: message.delta
data: {"schemaVersion":5,"projectId":"a0000000-0000-4000-8000-000000000010","operationId":"a0000000-0000-4000-8000-000000000011","epoch":0,"eventId":"a0000000-0000-4000-8000-000000000012","type":"message.delta","createdAt":"2026-10-02T10:00:00.000Z","payload":{"messageId":"a0000000-0000-4000-8000-000000000002","contentVersion":1,"offset":0,"text":"我会先突出你最想表达的特色。"}}

```

cursor形式`<epoch>:<chunkIndex>`，客户端下一次从index+1读；epoch来自可信operationcontrol。Last-Event-ID优先于query，两者都有且不一致返回400，不猜测较大的值。游标只是一位置不是访问凭证；非数字、负数、超安全整数、异常长度拒绝。客户端发现未来游标或stream已过保存期，走reset快照而非永远白屏。

心跳用`: heartbeat\n\n`，每15秒一次，没有id、不推进业务游标。`event: stream.rotate`同样不带id，在240秒关闭之前发送；重连从最后业务id继续。只有成功应用事件后才保存游标，不在刚收到未解析字节时前移。

Response：`Content-Type:text/event-stream; charset=utf-8`、`Cache-Control:private,no-store,no-transform`，禁压缩缓冲；Node runtime，maxDuration=300。仅这些可安全终止的读流routes开启平台supportsCancellation；断开只终止reader，不调用workflow.cancel。不在同一读流请求里附带必须继续执行的副作用。[V02][V03]

### 4.2 事件类型与副作用

| type | payload | 客户端处理 |
|---|---|---|
| `message.started` | messageId,contentVersion,role,ordinal | 创建或恢复同一助手消息 |
| `message.reset` | messageId,contentVersion,text | 新模型尝试替换旧内容，不把两个答案拼起来 |
| `message.delta` | messageId,contentVersion,offset,text | 仅当前版本且offset匹配时增量；低版本丢弃 |
| `message.committed` | messageId,contentVersion,archiveRevision | 从归档校准终态，只有服务端已存才发送 |
| `message.stopped` | messageId,contentVersion | 保留已输出文字并标已停止 |
| `understanding.updated` | briefVersion,summary | 更新最多3条理解，必要时刷新ProjectView |
| `asset.updated` | assetId,status,errorCode? | 同附件原位更新 |
| `activity.updated` | stage,label,completed?,total?,unit? | 当前一行活动；不向聊天追加每帧日志 |
| `preview.ready` | previewId,revisionId,briefVersion | 读权威预览；手机提示有新效果，不抢焦点 |
| `preview.invalidated` | previewId,reason | 清除旧确认资格，不清聊天或已有画面 |
| `result.ready` | artifactId,revisionId | 权威result已CAS提交后更新播放器引用 |
| `change.confirmation` | changePlanId,summary | 一句影响说明与两操作，非技术看板 |
| `operation.terminal` | status,errorCode?,retryable | 收流、刷新状态；不是所有succeeded都代表视频完成 |

公开schema中的payload各自闭合，不能any。禁止原始reasoning、凭据、代码全文和未校验React/HTML。字段增补要提升schema版本或向后兼容，不让旧前端直接执行未知动作。

### 4.3 重试、重连和部分回答

文本offset以JS UTF-16 code unit计；发送端保证不在代理对中间拆分。网络TextDecoder必须stream=true，保留跨读块的UTF-8与SSE行缓存；处理CRLF、多行data和末尾半个事件，不能按每个read()直接JSON.parse。

同epoch/index重复直接丢弃；同eventId重复也丢弃。delta.offset小于已接收长度仅在内容完全一致时视为重放，部分重叠/缺口则请求message checkpoint，不静默拼接。新contentVersion必须先reset或完整snapshot，旧版本delta不可复活。streamEpoch升高则丢弃旧游标，读取当前消息检查点并标恢复；不能把新run的chunk0接到旧run文本末尾。

重连退避0.5/1/2/4/8秒加抖动，上限8秒；网络offline暂停并提示，恢复online立即接；410流过期后从Blob消息与project快照恢复，未完成消息标interrupted/可重试，而不是补写不存在的token。断线不改业务phase为failed。

最终消息先写immutable archive/index再发committed。流中途故障可从已写stream恢复；平台流已失效且没有对应checkpoint的文字不能宣称被永久保存。每次stage结束或回复停止时归档，长回复每5秒/累计2KiB以上可存checkpoint（至少间隔5秒），避免每token写Blob。消息超过配置字数必须分页/收束，不无限增长。

## 5. SSE reducer与播放器隔离

`reduceEvent(state,event)`为纯函数，按operation/epoch/messageVersion处理；ProjectView控制phase与primaryAction，不能从助手一句“完成了”推断。聊天部分和ResultStage订阅分开selector；播放器key只随实际artifactId变化，不能随controlVersion、message数组或signedURL续期变化。

点击定位显式建立FeedbackTarget，sourceTime由当前artifact映射；切换结果清除不兼容定位。音乐全片反馈默认target=null。发消息成功后只清该条草稿，不覆盖用户在请求期间继续输入的下一段。

## 6. 错误码与小白文案

| code / HTTP | 可重试 | 页面应做什么 |
|---|---|---|
| VALIDATION_FAILED / 400 | 修正后 | 指出具体字段；保留输入 |
| ACCESS_NOT_FOUND / 404 | 否 | 无法访问；不泄露他人项目 |
| PROJECT_EXPIRED / 410 | 否 | 告知保存期限；不假装恢复 |
| IDEMPOTENCY_CONFLICT / 409 | 否 | 命令内容变化需新ID；开发日志定位 |
| PREVIEW_STALE / 409 | 更新后 | “新资料已记下，先更新效果” |
| INPUT_PENDING / 409 | 稍后 | 正在确认新资料影响，解除条件明确 |
| BUSY / 409 | 稍后 | 已有制作进行；普通聊天仍可用 |
| OPERATION_NOT_STARTED / 409 | 是 | 查receipt/recover，不直接创建新项目 |
| CAPACITY_LIMIT / 429 | 是 | 具体稍后重试，带Retry-After |
| BUDGET_LIMIT / 429 | 人工确认或重置后 | 保留结果；不自动增加预算 |
| ASSET_INVALID / 422 | 更换资料 | 非支持格式、损坏、超限理由 |
| FACT_CONFLICT / 422 | 澄清后 | 只问需要核对的一件事 |
| CAPABILITY_UNAVAILABLE / 422 | 配置/适配后 | 原风格仍保留，说明实际原因 |
| PROVIDER_UNAVAILABLE / 502 | 有限次数 | 原消息保留；不称已理解 |
| START_FAILED / 503 | 是 | 复用原receipt恢复，不重复收费 |
| QUALITY_BLOCKED / 422 | 修复后 | 不开放最终下载；显示可执行修复 |
| CANCEL_PENDING / 202 | 查询终态 | 正在停止，不提前标已取消 |

所有错误的requestId用于服务日志，不把异常堆栈和密钥显示给用户。retry必须按错误类型和原授权判断，不把所有4xx/取消状态自动重跑。
