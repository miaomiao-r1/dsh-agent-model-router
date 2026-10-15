# 当前开发状态

开发目录已迁至 `C:\Users\14173\Documents\agent_role_models`，DSH desktop profile 的本地依赖与加载链接应指向此目录。

## 已完成

- 2026-10-15 1.0.0-rc.1 发布准备：突出 free-model 通道免费额度按五角色分工利用；53 项测试、语法/工作流同步及实际打包检查通过。安全审查文档完成，修复开发卸载缺失字段、错误传播和失败恢复。GitHub 固定提交 d55a056 源码下载、关闭脚本的标准 CLI 安装、入口检查及卸载通过。最新候选版仍需真实多角色验收。
- 已公开发布 v1.0.0-rc.1（源码提交5904dac）：https://github.com/miaomiao-r1/dsh-agent-model-router/releases/tag/v1.0.0-rc.1 。TGZ 和 SHA256SUMS.txt 已上传；公开 Release URL 安装、入口检查、卸载，以及同 tag 的 GitHub 源码安装、入口检查、卸载均在隔离 profile 实测通过。附件 SHA256：5b9408a537adf5ce556ae5f6140a96350ca7f0a784d082a23d8119f825a7c2ca。
- 宿主认证代码已核对；真实配置接口匿名读取401，外部Origin/Host均403。审查结果及边界见 docs/security-review.md；不把它称为完整渗透测试。

- 2026-10-15 分层交接与委派已实现：完整报告逐阶段归档、角色相关摘要与可回查路径、rootPlan 实现门控、显式委派评估工具与 root_required 返回。49 项本地测试、语法检查、脚本同步与实际 tarball 解包验证通过。本次未请求真实模型，也未发布新改动。

- 左侧代理模型页面、五角色模型选择、启用目录刷新、全局历史映射与即时多代理开关。
- 原子存储、安装卸载脚本、取消与失败处理。
- 修复宿主加载依赖隔离 workflowEngine 导致配置接口未注册的问题。
- 修复工具参数缺少完整 JSON Schema 外层，导致模型将数组以字符串传入的问题。
- 最新开发副本与迁移前安装副本逐文件一致；38 项本地测试和语法检查通过。
- 2026-10-15 发布准备：精简 npm 包文件清单，新增 verify:package 实际打包解包检查、发布指南和标准安装说明。后续修改仅在本开发目录；不再要求同步历史副本。
- 发布包包含完整运行入口、工作流及许可；解包宿主导入和开发安装器的临时目录安装卸载已通过。
- 历史发布准备验收：41 项测试通过；当前预发布验收为53项。
- 桌面版内置 DSH 0.2.0-rc.2 / pnpm 11.7.0 标准 CLI tarball 安装及卸载已在独立 DSH_HOME / release-check profile 通过，检查依赖、bundle 和包目录，并保留原有基础 bundle；未改真实 desktop profile。详见 docs/marketplace-release.md。
- 2026-10-15 已核对用户导出的会话及宿主原始主/子会话日志：真实 explore 运行 runId `7b6a8b95-0c38-4f52-953b-ade7892b5bb9`，agentsStarted=1，routingVersion=6。宿主 run-start、agent-start/end、run-end 均存在，stopReason=completed；子会话请求配置为 `trae / deepseek-v4.1-flash`，工具结果 verdict=passed，validationErrors=[]。基本编排链路通过，非所有角色或完整任务通过。
- 2026-10-15 已按用户授权创建公开仓库 https://github.com/miaomiao-r1/dsh-agent-model-router ，推送 main 并设置 origin/main 跟踪；GitHub 页面确认 Public 和完整源码目录。包元数据及目录条目指向真实仓库。市场所需 dsh-plugin topic 已添加。

## 待验收

- 2026-10-15 新导出会话“DSH代理模型路由验收--6dcf4f67.md”已对照原始会话日志：cwd仍为默认工作区；agent_role_models和agent_delegation_route各调用1次，agent_orchestrate调用0次，workflow事件为空。只确认新工具已加载和前置读取，不记为explore/research子代理或五角色验收通过。正式项目的acceptance.mjs、assets/agent-models.png及screenshots.json均未出现。该次没有实际启动编排，不能据此认定发生了子代理沙箱失败。

- 新分层交接的真实多阶段运行、子代理回查原件、新委派工具和 token/缓存指标仍待实机验收。重启宿主加载新工具；此前单阶段 explore 成功不代替新功能验收。报告无自动保留期。
- 浏览器连接 DSH 返回 authentication required；用户当前打开的是桌面窗口，浏览器工具无法控制该窗口。真实角色测试和实际界面截图需已登录 Edge 页面，不能用假数据截图代替。

- 本次真实 explore 使用 DSH 默认工作区 `C:\Users\14173\Documents\deepseek-harness\default-workspace`，未以正式插件目录为探索目标；正式目录验收仍待完成。子代理的 16 条 pwsh 调用未发现显式写文件命令，但部分使用 -Recurse，未遵守父调用的“不深入递归”限制；filesModified=[] 只是代理报告，不能独立证明文件系统零变化。
- 模型切换后的真实调用路由、新旧会话映射与目录停用行为。
- 不把此前失败的两次真实验收记为成功；两次失败均发生于 plan 参数校验，未启动代理。
- 打包、CLI 安装管理和单次 explore 编排均有独立证据；完整角色路由、宿主页面、最低兼容 DSH 版本、市场点击安装仍待验收。子会话请求配置证明 DSH 所选路由，不证明上游厂商的实际后端身份。
- 尚未发布 npm 或提交目录 PR；已有 GitHub Release 安装附件，但不代表已上架市场。投稿条目为 docs/marketplace-entry.yml，待满24小时并完成真实验收后提交。

## 下一步

先在DSH切换工作区为C:\Users\14173\Documents\agent_role_models，再新建主会话，依照docs/real-acceptance.md实际调用编排，不能只把目标路径写入默认工作区会话的提示词。模型工具验收不以浏览器登录为前提；配置页面和实机截图另需已登录界面。投稿最早北京时间2026-10-16 01:46:11；未实际取得截图前不创建失效的screenshots.json。不得修改默认工作区中的历史源码副本。
