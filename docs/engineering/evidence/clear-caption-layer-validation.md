# 独立版本清晰手写字幕层（2026-10-05）

T10/T11：新建 renderer `book-caption-clear.mjs`，仅将中文字体替换为已锁定 Long Cang；原 renderer/SHA 与受信任 producer 文件保持。新 renderer SHA f05641cb89861f8a931025b09637470dfe569ce0bacd0e9c6a8f391ebbf87591。BookCaptionDescriptor v2 严格绑定新 renderer/Long Cang/Patrick Hand，默认v1保留原字段值、source/job hash及原字体。native producer不由Agent生成，仍是相同固定源码，只接收冻结job中的指定字体。

新增 public compositor seam 测试先实际失败（v2请求仍返回schemaVersion1），实现后通过；降级v1/换旧字体/换旧renderer均拒绝，旧默认重复结果一致。receipt可识别两个renderer，但最终必须精确等于当前job renderer；job字节、producer源码、实际 completed stdout、文件receipt与最终MOV字节都核对，不能将v1回执挪到v2。6项相关测试通过。

[实际原生报告](clear-caption-layer-probe.json)：从原业务 TimingDraft 的完整引用及当前 stage snapshot读取原四句，保持原时序/文字，独立native job使用新字体镜像 c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623。实际生成20秒/480帧/1280×720/24fps qtrle ARGB透明MOV，SHA0355de03b581bfd214d9c916d461f8a72f6ef940c015428dc791415837075f78，7,668,145bytes；producer完整解码、ffprobe单流/尺寸/帧数/时长/alpha验证通过。两字体读取加一次实际字幕producer，三个 owned native completed。缓存mustExist恢复结果同hash，无新native；原项目control/budget/failed operation三项hash未改，0模型请求。

这是实际compositor字幕生产能力，不是已发布影片。CaptionPackage/Timing/FilmSpec仍只认识旧book policy3，本轮不隐式升级已冻结包；独立新policy4接线、源工程清单/字体receipt、影片合成与真实Critic仍待完成。原frame409字体事实阻断保留，未将技术decode视为视觉/完整质量通过。

116文件600测试52.85秒、lint、build、构建后typecheck退出0。固定88e2f92…f9405f6 Spec/Standards双轴clean，未发现实质P1/P2。下一步接线新字幕policy/Timing/冻结包并复用原画面和已确认音轨合成，实际核验字幕/事实/全片QA，再完成公开制作与修改流程和全部43风格完整范围。C0/C1/C2未达到，无push/部署，目标保持active。
