# T10/T11 最终混音可信单句复核（2026-10-04）

本增量接入负责人已明确给出的最终混音试听确认，完成同一冻结实片的四句技术核验。不是整片主观试听、正式制作批准、预览发布或最终交付。

实际影片 SHA256 为 `7c381b9b2f75e9a05ccaa7e542686268df18a23c02fff7dd487cabcf00312ce3`，20秒、480帧、1280×720、48kHz双声道AAC，10,492,984字节；既有独立全解码和响度报告保留在 `existing-preview-film-remainder-probe.json`。本次未改变影片、原文、冻结plan或ASR输出。

## 实现

- 独立 `postmix-review.ts` capability，scope严格为single_postmix_wav。challenge绑定project/revision、完整plan、film SHA、提取起点/长度、media runtime、混音WAV、完整ASR/词时间、model/runtime。验证实际影片SHA及按冻结提取key定位的WAV，不把解码AAC伪装成原TTS VoiceResult。
- 只接受已归档的owned completed user消息“读音正确，确认这句最终混音试听复核”。immutable refs核对hash/bytes/mime/prefix；固定确认槽禁止一条消息迁移到另一challenge，冷读复查消息Index、owner、epoch。私有Symbol阻止JSON伪造；当前epoch lookup不继承取消前执行许可。原TTS proof不能用于最终混音，最终混音proof不能用于TTS。
- `verifyPostMixNarration` 仅在真正ASR_MISMATCH时查找明确复核，保留recognizedText和`trusted_review`，词时间非空/正长度/不重叠仍检查。resolveReview后重查取消fence。
- `prepareCompositeStage` 接入owned lookup、实时fence和postmix Docker journal。所有既有合成记录必须重新冷读取实际WAV/ASR/owned proof并比较完整postMix结果，包括无旁白分支，不能仅信JSON状态。新记录刚完成实际核验且持久对象canonicalHash完全相同，仅再验技术QA/fence，避免立即重复读取。未重构其他既有媒体调用的journals。

## 实际验证

`npx tsx scripts/video/record-postmix-review.ts --confirmed-final-mix-workspace-reply`：退出0，现存真实影片、WAV、ASR mustExist读取；实际负责人回复归档为owned user消息，immutable proof冷加载与lookup一致。network/model/native producer均0；source operation/budget/Understanding/phase/activeProduction不改。详见 `new-theme-postmix-trusted-review-probe.json`。

`npx tsx scripts/video/probe-reviewed-final-mix.ts --verified-existing-final-mix`：原1/2句已存在证据读取；原root从未执行的3/4句通过4次bounded owned native调用（2提取+2 ASR）获得与先前独立诊断一致的WAV SHA；四句完整核验与冷读均执行到返回。最后journal汇总因listKeys传入非法尾斜杠而退出1/INVALID_KEY，该失败原样保留在 `reviewed-final-mix-probe.json`。

修复查询prefix后，另行执行 `--recover-existing-final-mix`：退出0；强制mustExist，两次完整读取结果完全相同；4个既有native回执全部completed，新增producer/network/model均0，无正在运行的owned容器。原control/budget/failed operation的canonical hashes未变。独立报告 `reviewed-final-mix-recovery-probe.json`，没有覆盖首失败报告或重置回执。

| 最终混音句子 | 实际识别 | 状态 | 词数 |
|---|---|---|---:|
| 把小种子轻轻放进泥土里。 | 把小种子轻轻放进泥土里 | pass | 11 |
| 洒下适量的水，润湿土壤。 | 撒下适量的水 润湿土壤 | trusted_review（负责人只确认此混音WAV） | 10 |
| 泥土里探出了嫩绿的小芽。 | 泥土里探出了嫩绿的小芽 | pass | 11 |
| 观察成长，耐心照料。 | 观察成长 耐心照料 | pass | 8 |

## 工程测试

新增suite先因模块缺失失败；实现后3项边界测试通过。真实冷verifier合成PCM测试首次因fixture缺媒体timeout配置失败，补齐fixture后4项通过（不是试听QA）。覆盖跨owner、跨影片/窗口/plan/WAV、原TTS确认拒绝、JSON伪造/修改challenge、固定消息槽重绑定、缺/零词时间、真实缓存ASR路径、无proof拒绝和取消后lookup拒绝。

完整 `npm test`：106文件564项，退出0，52.12秒。`npm run lint`退出0。首次build报告闭包root narrowed丢失的TS2345；guard后固定dataRoot const修复，`npm run build`随后退出0。构建后 `npm run typecheck` 与 `git diff --check` 均退出0。

独立Spec review发现并修复两处P2：①原length≤reserved不接受合法300ms尾音上下文，fixture改为reserve800/window1000，旧4测试全RED，修复后GREEN；仍拒绝越过下一句和reserve+300。②cached postMix自报pass/空lines可跳过仅trusted才执行的冷核；临时恢复原conditional guard，新增真实存储边界用例确实因lines=[]被接受而RED；finally恢复修复源码，small/medium/trusted三参数suite GREEN，并覆盖trusted→pass去proof降级拒绝。这些合成PCM/mock只证明存储分支，不能替代实际试听。最终固定base8a962ac/headb009ab2，两轴均clean。Spec独立离线读取当前verify函数确认正常trusted冷读1次通过、清空lines/去proof降级均冷读1次后拒绝；相关2文件7测试通过。Standards独立禁spawn/禁create/cas冷读真实四句缓存通过、0producer/0writes、伪JSON拒绝；最后缓存修复只读复审clean。

## 尚未完成

原preview操作 `5b25cce7-3723-4128-8fa8-b252053386e9` 保持failed/composition；未写CompositeStage、未Excerpt/Critic/发布、无currentPreview。本增量只读技术探针不能替代新操作的生产fence。下一步实现独立新operation的技术重试，复用同一完整冻结revision/影片；必须校验accepted command/source hashes和所有已有创作stage，缺失或变更时禁止回退付费重创作或新音视频。完成新的Composite→Excerpt→Critic→Publication后再继续正式制作与全片QA。

公共试听review API/UI、新operation技术重试、完整正式worker/批准UI、43风格86条基线/92验收/用户测试及其他任务缺口仍见task-ledger/blockers。C0/C1/C2尚未达到；无push、生产部署。
