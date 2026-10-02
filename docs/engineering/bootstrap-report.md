# T00 初始化记录

2026-10-02：根目录 `/Users/janily/Desktop/dev/videoBuddy`。原分支 main，HEAD 0211801；origin 身份 github.com/janily/videoBuddy（保持不变）。原文件 .git、.gitignore、README.md 与未跟踪 docs/、.DS_Store。没有 package.json/src/lockfile/测试脚本；这是未初始化，不是旧测试失败。保留全部既有文件，不在交付目录安装。

选择 Node 22.23.1（本机已安装），因为 Mastra 1.74.0 要求 >=22.13；使用 npm，唯一 package-lock.json。先 npm install 生成锁，再 npm ci 验证。启动：nvm use && npm run dev。
