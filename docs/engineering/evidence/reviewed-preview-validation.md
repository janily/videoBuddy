# 原旁白复核后的真实预览验证（2026-10-04）

负责人已明确确认原句“洒下适量的水，润湿土壤。”读音正确。该事实仅适用于既有单句WAV及冻结完整旁白上下文；不代表批准正式制作或最终AAC。确认记录及原失败 operation 保留。

## 本轮实现

后端受限 `reviewedTreatment` 路径可从原 ASR_MISMATCH/voice 的失败预览复用其真实、已完成 Treatment effect，要求相同项目、授权 epoch、brief、Understanding、完整 plan/旁白/WAV/可信复核关联。新命令产生新 operation/revision，旧失败不复活；公共请求没有新增任意来源注入入口。新 operation 的不可变源摘要、命令 bodyHash、receipt 和复用记录共同锁定来源；冷恢复丢失记录可从已接受命令恢复，丢失/损坏命令或声明不得回退为新模型调用。三个协议测试覆盖实际 FileStore/CAS 并发及冷读取，核心两轴审查 clean。

## 实际结果

[真实预览报告](new-theme-reviewed-preview-probe.json)记录新 operation `df5b5a6e-173d-4e69-aaa3-15ce765cfb0b`，revision `3e029b9c-38b8-4bc3-b731-f4f3b4d25e34`，同项目 `4a5c6131-3842-440c-a551-7d8fcf6e7c95`。实际复用原冻结 Treatment、四原WAV（3匹配+1单句可信试听）、时序、字幕及旁白归档；Audio计划/执行和第一个镜头渲染完成。第二镜头真实HTML生成完成，但画面渲染失败。没有执行后两镜头/Composite/Excerpt/Critic，没有发布预览。

三次新增 gemini-3.8-flash 请求均 HTTP200，原始响应已私有归档并记录 SHA，用量分别为 input/output 9042/7048、7216/5707、7209/10458；新增实际合计 23467 input、23213 output，46680 total。项目现有五次调用均 settled；预算预约计数与实际用量分开，预约值152621/49000不是实际消耗。原 source operation 与原 Treatment 未变化；项目控制态和预算仅按此次授权新预览正常推进。

原第二镜头 native stderr 为 `NONDETERMINISTIC_SCENE`；state 记录 `RENDER_FAILED`，非OOM或模型连接错误。上层目前映射为泛化 `PROVIDER_UNAVAILABLE`，错误分类尚需改进，不能据此宣称供应商失败。

## 确定性诊断与技术修复证据

[默认/软件诊断](scene-determinism-probe.json)、[Canvas状态诊断](canvas-state-determinism-probe.json)在独立命名空间挂载原HTML，只读核原控制态/预算/失败operation不变。默认、关闭GPU、willReadFrequently三模式均复现首帧重复绘制差异；绘制前 ctx.reset 模式三轮、三个采样帧共9图SHA一致。原首帧前后实际差异962102像素、范围x0–1919/y0–626、最大通道差1；其他两个采样时间一致。此证据定位到Canvas完整绘制状态/原生优化路径，未证明具体Chromium内部缺陷。

[派生源码完整渲染](scene-reset-render-probe.json)将唯一 `ctx.clearRect(0, 0, 1920, 1080);` 替换成 `ctx.reset();`，另存新SHA、新job、新bundle、新stage，不覆盖原模型输出/失败job。原固定镜像及原可信 render.mjs 的严格PNG确定性守卫仍执行；实际5秒、120帧、1280×720无音轨MP4成功，全解码/格式/帧数检查通过，SHA `bc8d48ffc939f2aa471d81a0284ae7ecc88a3ea533343cdb93571406c632d957`。这只是派生镜头技术诊断，不是完整视觉QA/风格验收/全片交付；报告 deliveryEligible=false。未把该源码注入原冻结revision或伪装原operation成功。

独立审查确认36张PNG及派生影片/源码的实际SHA一致。初始两份诊断执行时没有固定脚本副本，历史scriptSha为执行前读取，不能把它升级成不可变输入证明。随后修复脚本执行前原子独占准入、文件和目录fsync、独立副本0444/只读挂载及job/scene只读覆盖；新执行必须保留started/unknown admission，禁止冷重跑绕过未知副作用。8并发准入只1成功、冷started与failed/unknown再次执行均拒绝测试通过；这项安全修复没有重跑或覆盖历史探针。两轴复审clean。

## 仍需完成

把确定性修复接入受限、有diff及新bundle证据的实际预览/有限修复流程，并避免Visual重复绘制由合成器负责的字幕；完善错误分类。公共试听入口、完整预览与Critic、正式1080p全片/最终AAC独立核验、修改/导出/清理、43风格86基线和完整T21验收仍未完成，C0/C1/C2未达到。原failed/unknown不重置，无push或生产部署。

最终本轮验证：105个文件555项测试通过；lint、Next16 build、构建后typecheck及diff检查通过。诊断期间0新增模型调用；上述3新增调用来自真实预览。
