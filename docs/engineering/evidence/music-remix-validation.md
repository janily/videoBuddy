# T13 音乐总线实际重混音

2026-10-03。现有 master mixer 原先没有整片 musicGainDb，音乐已在 stems 中按 AudioPlan 事件增益执行；不能降低整个 master 代替音乐修改，否则旁白/音效也被改变。

新增明确的 −6 至0 dB 音乐总线调整参数，作用于音乐轨全片、ducking 前，旁白增益/侧链和音效路径保持原计划。默认仍产生原 schema1 图；显式音乐调整产生 schema2 job，增益、实际输入摘要、运行镜像、工具代码摘要共同决定 stageKey。Python 独立校验字段、有限数值与完整固定 filtergraph，拒绝错增益和追加任意滤镜。不修改旧 AudioPlan、旧执行包或旧 master。

TDD：新含旁白/无旁白两个测试在旧实现因没有音乐增益而失败；实现后通过，覆盖 TS/Python 同值接受、错增益和滤镜注入拒绝、NaN/Infinity/越界拒绝。相关 audio-master/audio-execution 两文件10项通过，旧归档校验保留。

实际命令：`npx tsx scripts/video/probe-music-remix.ts --remix`。读取原真实 native-package 的归档执行包，验证来源/四条音轨/冻结回执，复制已核实 voice/music/foley 到独立私有工作目录，并再次独立核 WAV 摘要；不重新合成音轨。采用固定无网 Docker/FFmpeg。此源是明确零旁白、真实模型生成的原创音乐/音效变体。

实测：默认重混音与原归档 mix 字节 SHA 完全一致；新 −3 dB 输出 stageKey 不同；1920000 个交错声道样本逐项核对 `new = old + (10^(-3/20)-1) * music`，719940 个样本改变，最大误差 6.261499582715935e-9，小于 1e-6；冷重放对象完全一致。原 control 与预算 SHA 未变，networkCalls=0，resultPublished=false。原始记录见 [music-remix-probe.json](music-remix-probe.json)，工作文件在记录的 ignored root 中保留。

第一次 typecheck/build发现归档轨道 schema 的 channels 类型为1|2，不可直接冒充单声道旁白；已改为独立读取并核实实际 WAV，修复后真实探针再次通过。最终88文件444项单元通过，lint/build/构建后typecheck/diff-check均退出0。

这只是实际重混音生产者验证。含实际旁白的混音、成片响度/听验/post-mix ASR、授权 ChangePlan/持久 operation/新 revision 包/QA/结果发布与用户恢复闭环仍需接通。调整后的音轨不能套用旧 AudioExecution 回执冒充原版，也不宣布 AT-040/T13/C0/C1/C2 完成。全片未知模型账目、43风格86基线和其它交付门槛继续保留。未 push 或生产部署。
