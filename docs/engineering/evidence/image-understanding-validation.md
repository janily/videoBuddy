# T05 图片理解与资料接线增量（2026-10-05）

基线 `9d04828`；初始实现 `f61ab66`，资料类型修正 `4aab4fb`，审查边界修正 `76e03f2`，fixture类型修正 `af26945`，否定原话修正 `c918ad2`、确认状态转换修正 `b8ba4a9`、统一全部用户事实来源修正 `43ed2e3`。本地 implemented/tested；未部署、未 push；没有新增外部模型或媒体调用。本模块不等于完整 T05/C0/C1/C2 或全部项目交付。

## 实际实现

- `src/contracts/video/image-understanding.ts`：PNG/JPEG/WebP 最大20MiB，与上传限制一致。服务读取实际私有字节，输入 ID/MIME/bytes/SHA 全部核验；签名校验不冒充独立完整图片解码。结果严格包含绑定资产/原图 SHA、可见描述、归一化区域、逐字可见文字/clear或uncertain、无法确认项。scope=provided_image_only、trust=untrusted_material，无授权/许可/质量通过字段；非法/越界区域拒绝。
- `src/mastra/video/image-understanding.ts`：实际二进制以 Mastra 多模态图片输入发送，发送前复制字节防止调用方异步修改。图片文字/指令/网址与用途是不可信资料；逐字OCR、模糊标uncertain，禁止猜身份/品牌/日期/品种、未提供声音/视频和用户批准。maxRetries=0；模型预约/开始/实际usage按已有会计模块记录，发送前与返回后核权限，拒绝错误身份输出，不将观察升级为可信事实。
- `image-analysis-stage.ts`：只允许当前live、rightsConfirmed、uploaded/analyzing/ready素材；实际原字节与控制态一致。输入完整 hash 形成持久 effect 唯一身份，预算在effect前预约；仅native新effect核全站generation/配置。unknown不自动重试，completed复查权限/字节后可0调用归档。严格、不可变 schema5 imageAnalysis 及确定文本进入analysisRef，CAS只增一次brief/assetUse，将旧ready preview标stale，解除inputPending。ready冷读也核实际字节、ref SHA、完整schema/输入绑定和文本一致。
- `source-worker.ts`：新增真实图片分析分支。配置缺失或全站暂停保持uploaded与具体阻断码，可配置后继续；确认的确定性输入/语义错误可failed，预算/effect未知与存储/ACK错误保留可协调状态，不能因archive写成功后ACK丢失永久丢弃已完成工作。已移除/过期/删除素材不复活。errorCode变更递增controlVersion，不改变权限/留存活动时间。
- `local-director.ts`/`director.ts`：实际读取归档图片描述与观察，ref SHA/严格schema/source identity一致才能进入context。图片观察、OCR及不确定项始终不可信。图上下文任何新事实（含provided、非critical、mustInclude真假）若引用user_message，必须逐字保留对应真实用户消息的完整原文（含否定/限制）；上传“请参考照片”、随意“好的”或截取否定句校名不能当作确认。图片uploaded_material仍不能通过旧Markdown/PDF/语音引文规则自证confirmed。图上下文resolve_conflict同样要求selectedFact与该操作关联的完整真实用户原话一致，并保存确认来源；不能先provided再选id升格。普通非图上下文已有处理保留。

## 测试与失败证据

1. 图片合同/原生适配器、持久stage均先因缺生产模块失败；完成后本地协议通过。
2. Worker接线最初测试误先做cold prepare，掩盖了未接线，已补“Worker后立即ready”断言；临时仅回退本项source-worker到原固定HEAD，真实得到uploaded≠ready的RED，再恢复目标代码转GREEN，没有回退用户改动。
3. Director新图片附件用例先因SOURCE_INVALID导致decide calls=0失败，接真实ref/schema/观察后通过。固定的模型回复仅存在于测试注入，不进入生产默认分支。
4. native实际loopback HTTP传递真实PNG字节/data URI、SHA、限定scope，保留图片中恶意指令文字为数据；前置素材移除0请求，返回后素材移除拒绝消费。
5. 原图hash/MIME/大小不一致、结果资产/SHA/许可字段伪造、区域越界拒绝。实际FileStore/上传字节测试第一次分析与冷恢复只调用producer一次；篡改原图拒绝且无重分析。移除期间不发布ready/brief。
6. 审查P2暂停：完整dummy模型配置＋generation=false原代码已到预算/effect create，由安全拦截 STOP_BEFORE_MODEL 截断，绝无SDK/cloud；新增实际RED→GREEN证明暂停先于预算/effect准入，budget-intents/effects为空。
7. 审查P2 ACK：FileStore真实immutable create成功后抛EIO_ARCHIVE_ACK，旧Worker标failed不能恢复；新增实际RED为failed≠uploaded。修正后保持uploaded，cold Worker generation=false且不注入producer，从completed effect恢复ready，producer总调用1，未发新请求。
8. 审查P2事实：上传“请把这张照片作为参考”，模型 uncertain OCR“清和学校”以上传消息 sourceRef 添加confirmed/critical事实，旧函数实证接受；修正后 SOURCE_INVALID。实际肯定完整用户原文可通过。
9. 自查否定子串：“我没有确认学校名称为清和学校。”旧contains仍让肯定校名confirmed；测试实际RED，再用完整原话一致核验转GREEN，保留否定。
10. Spec追加发现provided/noncritical/mustInclude=true可直接进入冻结制作事实，即使不resolve。新增实际RED后，统一所有图上下文user_message事实来源，不靠status/critical/mustInclude旗标保护。optional provided也拒冒充用户原话，观察只留不可信分析；旧provided base确认仍核全文并追加独立确认消息ref。
11. 最终Spec复核发现provided/noncritical→resolve_conflict可绕过确认；新增实际函数反例先RED，补状态转换原话与来源记录后GREEN，完整肯定原话仍可确认；目标image+Director19项11.44s、types通过。
12. 类型检查先因readNarrationJson返回unknown、随后union可选字段、fixture literal宽化失败；使用严格record schema、显式兼容TextAnalysis结构类型及已验证fixture修正，没有as never/宽泛断言。

所有实际模型响应均为本地HTTP协议fixture；stage测试中视觉文字为注入结果，并不证明真实图中确有植物/校名，未作为用户质量、OCR精度、品牌识别或图片全流程验收。真实PNG仅验证上传字节/来源链路；本轮JPEG/WebP仍无实际云识别/codec验收，20MiB边界实际请求、批量图片/context/长资料等亦未全面验收。

修正前完整 `npm test` 137文件689项66.73s通过；三P2修正后目标3文件25项12.05s、types通过。固定af26945完整137文件692项66.56s通过。c918ad2全套137文件692项66.78s通过；b8ba4a9完整137文件692项66.75s通过；最终43ed2e3全量结果补在文末。lint/build/构建后types将在最终检查后补记。

## 剩余与真实模型阻断

没有调用真实云图模型、没有创建空预算账本绕过未知费用。现有真实全片Critic请求180s超时、无HTTP/raw/usage，诊断 `.video-local/clear-full-critic-UGy32l` 保留 reservation `5dd1833417ee752dc2af96fef7281593b22e1b0880cd37cb450ef23653015dbb`，gate state=unknown。本轮只读检查原gate SHA `ae8f0a0062bb4068ebe458077bc11c8857ac84ceda6a2723a2c48617ae0d92af` 与旧失败/timeout审计；未reset、退款、重试该请求或续发31批后续。费用/次数无限授权仍有效，不能当作未知用量已结算。

新native分析需VIDEO_GENERATION_ENABLED=true、现有完整服务配置与预算/授权、MODEL_API_KEY/MODEL_BASE_URL、VIDEO_VISUAL_MODEL。同一正常服务根目录运行 `npm run worker:sources` 会扫描图片；已有source-worker启动还需要其PDF运行时预检，生产开关当前不擅自启用。原clear项目、批准包、影片及未知账本未写入；已有画面上传不能冒充正式影片审批。

还需要：真实图片模型/准确OCR/用户事实核实与多图要求覆盖，独立图片解码及缩图/大图预处理，扫描PDF文档模型、配乐/长音频/长文检索、完整全片视听/字幕/许可QA、公共批准/修改/导出闭环、43风格86基线和公开profiles、22功能92验收16Agent/5用户及恢复安全部署等。完整目标和C0/C1/C2仍未达，本轮不得标整个T05完成。

最终固定 `43ed2e33276fc79ab416f6f16e729562b58d7092`：完整 `npm test` 137文件692项65.93s退出0；最终build/lint/diff检查退出0。类型检查最终构建后结果补下。两轴独立复核均clean（Spec完整9d04828…43ed2e3，Standards基础及各最终增量）；仅本项范围，不是云/媒体或全项目验收。
最终构建后 `npm run typecheck` 退出0。原repo/docs/design/git/origin保留，当前仅本地提交，deployed=false。
