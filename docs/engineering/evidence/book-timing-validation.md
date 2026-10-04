# 绘本字幕冻结接线验证（2026-10-04）

新的 crayon-book 自动字幕读取实际安装的 Ma Shan Zheng / Patrick Hand 字体，冻结两个字体文件、许可、元数据、字符集及字幕 renderer/producer 哈希。TimingDraft 保持旧 schema 兼容，新增字体种类；新 FilmSpec 使用 v5.1-package-3-book-captions / CaptionPackage3。旧 policy1/2 不自动迁移，book 字体降级至旧 policy 拒绝。

字幕显示结束增加 ceil(350ms × fps) 帧，稳定阅读起点同样后移；阅读时长不被逐字显现占用。字体覆盖逐句检查实际选择的字体，中文混英文不能借另一字体的字符集合掩盖缺字。冻结加载、Composite、发布和冷读核对固定字体回执；工程 ZIP 提供合法字体获取清单及渲染源码，核对冻结 renderer/producer SHA，不附字体二进制或凭据。Visual 提示明确底部纸底预留区，不能代替遮挡 QA。

实际原生结果见 [book-timing-probe.json](book-timing-probe.json)：新独立私有目录，固定媒体镜像 46a3a937…，两次字体检查 completed。读取原实际四句已验证旁白清单，完整 hash 一致；字形覆盖和字体记录冷读取通过。字幕区间变为 0–110、120–230、240–350、360–459 帧；稳定阅读起点为 9、129、249、369。未修改原项目、重新生成声音或请求模型。此探针只验证实际字体与原旁白时序，不创建或批准新 FilmSpec/影片。

完整回归 114 文件588测试（49.73秒）；随后补充实际选定字体的中英混排负例，局部3测试通过。lint、build及构建后typecheck退出0。voice-stage 四种协议场景覆盖新 book 冻结/Composite/冷读取及旧字幕兼容，受控执行器不算真实影片 QA。固定代码审查 baa8af6…8beadd3 的 Spec 与 Standards 两轴 clean。审查范围不含其后新增的只读诊断脚本、混排负例和本记录。

原派生影片 frame405 仍遮挡根系。下一步按预留区重新生成实际镜头，核新影片的最终混音、事实和全片视觉质量，再发布可批准预览。现有单句最终 AAC 确认仅绑定原影片 7c381b…，不自动适用于新影片。公共复核/正式制作/修改与全部43风格86条真实基线、92项验收仍需完成；C0/C1/C2未达到，未push或部署。
