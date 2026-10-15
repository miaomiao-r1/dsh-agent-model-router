# 插件市场发布执行计划

目标：将现有插件准备为 dsh-market 可收录、可安装的发布包。用户已同意先完成本地适配与验收，再处理公开发布账号。

方案：保留现有运行行为，使用标准 DSH bundle 安装入口；发布包包含宿主、客户端、工作流和许可，不依赖开发目录链接。先准备 GitHub Release tarball；npm 发布可选。仓库归属未确定前不填写虚构 repository 地址、不公开发布。

- [x] 整理 package.json 的发布文件清单、关键词及打包验证命令。
- [x] 编写发布包检查脚本，验证实际 tgz 解包后的入口、导入依赖、工作流、许可以及隔离安装卸载；不把模拟宿主结果记为真实编排成功。
- [x] 更新 README 标准本地包安装方式、宿主与 dsh-our-free-model 前置条件。
- [x] 准备发布指南、目录条目生成方式、真实 DSH 验收步骤；更新项目树及 SESSION。
- [x] 执行 npm test（41 项通过）、npm run check、实际打包与验证，检查 diff。
- [x] 已通过桌面内置 DSH 0.2.0-rc.2 在隔离 profile 验证标准安装和卸载，不变更真实 desktop profile。
- [x] 用户确认使用 miaomiao-r1 账号，创建公开源码仓库并推送 main，设置 dsh-plugin topic。
- [x] 发布v1.0.0-rc.1预发布安装附件和校验文件，完成tag源码与公开安装附件的隔离安装、入口检查和卸载验证；53项本地测试通过。
- [x] 强调free-model五角色分工利用免费额度，完成范围明确的代码审查、开发卸载修复及真实匿名/跨源拒绝检查。
- [ ] 补齐真实五角色与配置行为验收，以及实际插件截图和screenshots.json；当前需要已登录浏览器连接。
- [ ] 提交目录PR；仓库最早于北京时间2026-10-16 01:46:11满24小时。

验收边界：本地测试、tgz 完整性、标准 CLI 安装、真实子代理运行、市场点击安装分别记录。没有对应运行证据的阶段保持待验收。

目标目录规则：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md 。以执行时读取的规则为准。
