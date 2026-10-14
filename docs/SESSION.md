# 当前开发状态

开发目录已迁至 `C:\Users\14173\Documents\agent_role_models`，DSH desktop profile 的本地依赖与加载链接应指向此目录。

## 已完成

- 左侧代理模型页面、五角色模型选择、启用目录刷新、全局历史映射与即时多代理开关。
- 原子存储、安装卸载脚本、取消与失败处理。
- 修复宿主加载依赖隔离 workflowEngine 导致配置接口未注册的问题。
- 修复工具参数缺少完整 JSON Schema 外层，导致模型将数组以字符串传入的问题。
- 最新开发副本与迁移前安装副本逐文件一致；38 项本地测试和语法检查通过。
- 2026-10-15 发布准备：精简 npm 包文件清单，新增 verify:package 实际打包解包检查、发布指南和标准安装说明。后续修改仅在本开发目录；不再要求同步历史副本。
- 发布包包含完整运行入口、工作流及许可；解包宿主导入和开发安装器的临时目录安装卸载已通过。
- 最新本地验收：41 项测试通过；npm run check、npm run verify:package、git diff --check 通过。
- 桌面版内置 DSH 0.2.0-rc.2 / pnpm 11.7.0 标准 CLI tarball 安装及卸载已在独立 DSH_HOME / release-check profile 通过，检查依赖、bundle 和包目录，并保留原有基础 bundle；未改真实 desktop profile。详见 docs/marketplace-release.md。
- 2026-10-15 已核对用户导出的会话及宿主原始主/子会话日志：真实 explore 运行 runId `7b6a8b95-0c38-4f52-953b-ade7892b5bb9`，agentsStarted=1，routingVersion=6。宿主 run-start、agent-start/end、run-end 均存在，stopReason=completed；子会话请求配置为 `trae / deepseek-v4.1-flash`，工具结果 verdict=passed，validationErrors=[]。基本编排链路通过，非所有角色或完整任务通过。
- 2026-10-15 已按用户授权创建公开仓库 https://github.com/miaomiao-r1/dsh-agent-model-router ，推送 main 并设置 origin/main 跟踪；GitHub 页面确认 Public 和完整源码目录。包元数据及目录条目指向真实仓库。市场所需 dsh-plugin topic 已添加。

## 待验收

- 本次真实 explore 使用 DSH 默认工作区 `C:\Users\14173\Documents\deepseek-harness\default-workspace`，未以正式插件目录为探索目标；正式目录验收仍待完成。子代理的 16 条 pwsh 调用未发现显式写文件命令，但部分使用 -Recurse，未遵守父调用的“不深入递归”限制；filesModified=[] 只是代理报告，不能独立证明文件系统零变化。
- 模型切换后的真实调用路由、新旧会话映射与目录停用行为。
- 不把此前失败的两次真实验收记为成功；两次失败均发生于 plan 参数校验，未启动代理。
- 打包、CLI 安装管理和单次 explore 编排均有独立证据；完整角色路由、宿主页面、最低兼容 DSH 版本、市场点击安装仍待验收。子会话请求配置证明 DSH 所选路由，不证明上游厂商的实际后端身份。
- 尚未发布 npm、GitHub Release 附件或提交目录 PR；公开源码仓库不代表已上架市场。

## 下一步

继续补充正式目录、其他角色及新旧会话映射的真实验收，并验证 GitHub 源码下载安装。后续探索明确传入 `C:\Users\14173\Documents\agent_role_models`；不得使用默认工作区里的历史副本作为正式开发源码。实际版本发布前重新打包和核对安装证据；收录 PR 必须等待公开仓库创建满 1 天。
