# dsh-market 发布准备

## 收录目标与条目要求

目标目录仓库是 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，贡献规则见其 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。提交前应重新阅读规则，按仓库当时要求操作。

公开源码仓库为 `miaomiao-r1/dsh-agent-model-router`。收录 PR 应添加单个 `data/plugins/miaomiao-r1__dsh-agent-model-router.yml` 文件；本项目选择 `workflow` 分类，同时提供中英文描述（规则只要求英文必填）。插件仓库在提交前须已创建满 1 天，并带有 `dsh-plugin` topic；插件包还须提供 `dsh.bundle`。以下为已按真实归属准备的条目内容，待发布验收完成后提交：

```yaml
url: https://github.com/miaomiao-r1/dsh-agent-model-router
name: miaomiao-r1/dsh-agent-model-router
category: workflow
description:
  en: Configure per-role model mappings and run staged agent workflows with dsh-our-free-model.
  zh: 配合 dsh-our-free-model 配置各代理角色的模型映射并执行分阶段工作流。
```

发布包可通过 GitHub Release 的固定 tag 对应 tarball 分发，再在条目中添加 `tarball` 字段。当前尚未上传 Release 附件，不填写不存在的下载链接。若另行发布到 npm，package.json 的 `repository` 已真实指回该插件仓库；无论是否发布 npm 都不要添加 `npm` key，目录自动关联。

## 本地打包准备

发布检查脚本 `scripts/verify-package.mjs` 用于检查实际 `.tgz` 解包内容、入口与依赖、workflow、许可文件，以及隔离环境中的安装和卸载范围。使用 `npm run verify:package` 执行。打包产物写入 `artifacts/*.tgz`；它是构建产物，不纳入项目树维护清单。

建议先运行 `npm test`、`npm run check`，再运行打包检查。三者分别提供本地测试、语法检查和包内容/隔离安装检查证据；这些结果都不等于 DSH 中的真实代理编排验收。

## DSH 人工验收记录

2026-10-15 本地记录：使用桌面版内置 DSH 0.2.0-rc.2、pnpm 11.7.0、Node.js 24.15.0。在 `artifacts/dsh-cli-isolated` 独立 DSH_HOME 下以 `release-check` profile 完成标准 CLI tarball 安装及卸载；安装时关闭生命周期脚本，使用离线模式。检查安装后的 package.json 依赖、bundle 注册和实体包；卸载后依赖、bundle 注册及包目录均移除，原有 `@deepseek-ai/dsh-base` bundle 保留。未改真实 desktop profile。

桌面版 Electron 可执行文件不在 PATH 的普通 CLI 安装范围内，本次通过其内置入口执行；终端没有 `dsh` 命令的用户应先配置 CLI，或在市场 UI 中安装。Electron crashpad 输出一条写权限诊断，但 CLI 操作及文件检查通过；不能仅凭该进程退出码判断安装结果。此记录仅证明安装管理，不证明启动、页面或模型调用兼容。最低兼容版本尚未验证。以下真实运行仍需记录：

- 实际编排的 `runId`、`agentsStarted` 和最终结果；此前失败且未启动代理的运行不得计为成功。
- 切换 explorer/worker 等角色映射后，记录真实模型路由证据。
- 保存新映射后，验证新建主会话采用新映射，并验证已有会话继续使用旧映射。
- 分别验证启用和关闭多代理模式；关闭后确认新调用受开关控制，同时核对已运行任务的实际行为。
- 记录调用预设是否提供可见的 `workflow` 工具，以及 `dsh-our-free-model` 通道是否已启用。

真实 DSH 编排应有宿主运行记录或等价证据。`npm test`、`npm run check`、包检查和模拟宿主结果须单独记载，不能代替上述人工验收，也不能表述为真实编排已成功。真实运行尚未完成时，相应项目继续保持待验收。

## 已核对的真实 explore 运行

2026-10-15，用户提供导出会话“检查映射并探索项目根目录--45ef5dfd.md”。已进一步核对本机 DSH 的主会话 `session-45ef5dfd-fd02-4bf7-884b-03645e16039c` 与子会话 `a941c006-e45f-4341-a5e8-e2b9e59830a1` 原始日志，而非仅采用模型最终答复。

- runId：`7b6a8b95-0c38-4f52-953b-ade7892b5bb9`；agentsStarted：1；routingVersion：6。
- 主会话中存在真实工具调用、workflow run-start、agent-start、agent-end（completed）及 run-end（completed）。工具返回 explore.status=done、verdict=passed、validationErrors=[]、warnings=[]、taskComplete=false。
- 子会话请求配置为 provider=`trae`、model=`deepseek-v4.1-flash`，与 explorer 映射和 agent-start 标签一致。仅验证 DSH 请求路由，不推断上游后端身份；其余四角色未启动。
- 子会话调用 16 次 pwsh 与一次 structured_output；查看到的命令未发现显式文件写操作，filesModified=[] 为代理自报，未进行文件系统前后快照比较。
- 目标实际是 DSH 默认工作区，不是正式插件目录。部分命令递归遍历，超出父调用“仅根目录及直接子项”的限制。因此本次只记为真实基本编排链路通过，不记为正式项目范围、全部约束或完整发布验收通过。

下一次正式目录探索应显式指定 `C:\Users\14173\Documents\agent_role_models`。模型切换、新旧会话映射、关闭开关、其他角色以及市场点击安装继续保持待验收。
