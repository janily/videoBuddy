# 绘本字幕真实合成验证 — 2026-10-04

代码提交 `5fd7ad2`，固定审查快照 `7491f78…8ff808d58953743aa9f5627302126c88318709ea`；二者代码树一致。

## 接线与实际媒体

`composeVideo` 新增受信任绘本字幕层分支：锁定绘制器、生产器及两字体字节，显式逻辑画布/safeBox进入缓存身份；Canvas按真实字宽排版、PNG流编码为qtrle/argb透明MOV，再与画面叠加。SRT保留但不再次烧录。生产器核输入哈希、确定性采样、完整帧输出、实际qtrle元数据和全解码，输出原生回执。现有普通字幕及旧v1回执协议未改。

字体及源码身份、bundleHash/fence、输出profile/时长/fps/cues进入透明层job身份。层回执有界读取并匹配同参数completed stdout，实际MOV字节必须匹配。无journal/current completed的缓存、孤立部分输出、篡改字体/源码、阅读时间不足均拒绝，mustExist不重做层。

最终book合成的schema2回执同时绑定 picture、track、SRT、实际alpha MOV和最终MP4 SHA。其生产器固定stdout也必须与实际回执一致；旧普通合成保持原协议与key。

[首次合成证据](book-composition-probe.json) 使用原真实种子四镜头与已生成音乐/旁白master，没有示例视频或固定模型回复。master在新固定镜像中经实际受限PCM导入并核源/输出哈希，没有重贴旧runtime标签；源project/control/timing/execution/picture/master字节不变。初始化脚本曾误读execution.stems、误将逻辑资产key作实体路径，两次均发生在报告准入和native之前；改为实际tracks及master stage路径后准入执行成功。

新的诊断字幕cue每句末尾增加9帧，以补约350ms逐字显现后的阅读时间，均未越出各5秒镜头。原冻结cue与Timeline未改。这是独立派生技术影片，不是冻结影片的静默升级。

## 实际质量结果及限制

最新 [最终固定输出验证](book-composition-v2-probe.json)：20秒、480帧、1280×720、24fps、48kHz stereo AAC；实际MP4 SHA `1daff89392c9e53e4e2c198258a391a4562421516d4854d91bd2bf2de54a30eb`，11,262,567字节。全解码和faststart检查通过，−14.29 LUFS、−4.05 dBTP通过。透明MOV实际8,386,929字节，生产回执/固定stdout/文件哈希一致。

[真实frame51/405抽帧](book-composition-frame-probe.json) 使用影片SHA输入校验，PNG SHA/bytes均复核。字体/墨棕/纸底符合新绘制器；**frame405的纸底仍遮挡根系，视觉QA未通过**。safeBox只是区域约束，不是主体无遮挡证明。不能把这两帧、技术检查或旧用户单句复核冒充新全片QA。新AAC旁白/事实/Critic/完整声音试听未执行，不能发布或进入正式制作。

最终源协议修复后的新FFmpeg输出与首次book电影字节相同，但来源证明单独重新执行：原5项completed保持不变，只追加1个完整schema2 stdout completed，冷读取前后6项完全一致，0新cold producer、0模型。原旧片白字幕MP4、原输入与历史回执均未改。

## 审查发现与实际回归

1. 层缓存可替换MOV并重签receipt：旧e36候选在隔离复制/协议fixture中实际接受；现必须绑定同args completed原始stdout，拒绝 BOOK_CAPTION_RECEIPT_CHANGED/PRODUCER_UNKNOWN。新增2cache测试旧源码精确回放2 RED，修复后2 GREEN。
2. 存在探查先整读receipt：改为lstat拒绝不合法/超4KiB文件，fd最多读取4097字节；最终book回执同样有界。测试4097字节拒绝。
3. 最终MP4可用真实legacy白字幕片重签schema2回执冒充：仅book producer新增固定stdout，进入新compose key并强制比较；旧8fc源码精确回放 final receipt 回归 RED，修复后GREEN。独立Spec实际legacySHA临时receipt验证现拒绝 COMPOSITION_RECEIPT_CHANGED。旧空stdout事实保留，不伪造为新证明。

[第一轮层冷读证据](book-composition-cold-probe.json) 是对应当时代码的5completed/0producer结果；最终协议实际来源证明以v2报告为准，不能将旧空stdout合成升级为最终证明。

最终 Spec：clean；最终 Standards：clean，均审查精确快照，只读核实际哈希、固定stdout及前后回执，没有运行producer/模型或修改原媒体。

自动检查：113文件585测试通过，50.66秒；相关cache/compose/receipt 3文件7测试通过；lint/build/构建后typecheck/diffcheck退出0。全部本次模型调用0，无push或生产部署。

## 后续必需工作

公开冻结CaptionPackage/TimingDraft仍使用既有字幕，不会自动选择新book分支。需要新版本化policy和字体/生产器/源码身份、stableReadableStartFrame及额外阅读停留、真实镜头明确预留字幕区、源码ZIP资源许可清单，再执行新完整影片旁白/事实/遮挡/声音/两轮QA。43风格、公共review/retry和正式Worker/UI、全部验收与自托管交付范围仍未完成，C0/C1/C2未达到。
