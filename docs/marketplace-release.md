# dsh-market 发布准备

## 收录目标与条目要求

目标目录仓库是 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，贡献规则见其 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。提交前应重新阅读规则，按仓库当时要求操作。

公开源码仓库为 `miaomiao-r1/dsh-agent-model-router`。收录 PR 应添加单个 `data/plugins/miaomiao-r1__dsh-agent-model-router.yml` 文件；本项目选择 `workflow` 分类，同时提供中英文描述（规则只要求英文必填）。插件仓库在提交前须已创建满 1 天，并带有 `dsh-plugin` topic；插件包还须提供 `dsh.bundle`。以下为已按真实归属准备的条目内容，待发布验收完成后提交：

```yaml
url: https://github.com/miaomiao-r1/dsh-agent-model-router
name: miaomiao-r1/dsh-agent-model-router
category: workflow
tarball: https://github.com/miaomiao-r1/dsh-agent-model-router/releases/download/v1.0.0-rc.1/dsh-agent-model-router-1.0.0-rc.1.tgz
description:
  en: Requires dsh-our-free-model to use enabled channel models and available free-tier quotas across five separately mapped agent roles, with cross-workspace settings, per-session mapping snapshots and staged report handoffs.
  zh: 依赖 dsh-our-free-model，按五角色分别映射已启用通道模型以利用可用免费额度，支持跨工作区共享设置、新旧会话各自保留映射和分阶段报告交接。
```

投稿时的差异说明：本插件依赖 `dsh-our-free-model`，为探索、查证、实现、测试、审查五角色分别映射其已启用的通道模型，让各通道的可用免费额度用于不同任务环节。设置跨工作区共享；保存后新建的主会话采用新映射，已有会话保留原映射。分阶段执行通过角色相关摘要与完整报告路径交接，后续角色可回查原件。用户自行按可用额度与模型能力配置角色。应以这些具体行为说明定位，不声称其他路由插件都缺少相同功能。

使用前需安装并启用 `dsh-our-free-model`。它管理通道凭据与模型可用性；本插件管理五角色映射和 workflow。免费额度与使用条款由各供应商决定，部分通道可能不免费，同一账号的多个模型也可能共享额度。插件按固定 provider 广告清单和启用状态提供模型选项，不查询额度或余额，不按剩余额度调度，也不会在额度耗尽时自动切换；因此条目描述的是按角色分配已启用模型以利用免费额度的用途，不是自动耗尽所有额度、无限免费、零费用或节省金额保证。

已发布 [v1.0.0-rc.1 预发布版](https://github.com/miaomiao-r1/dsh-agent-model-router/releases/tag/v1.0.0-rc.1)，提供上述固定 tag 的 tarball 和 SHA256SUMS.txt。安装包 SHA256 为 `5b9408a537adf5ce556ae5f6140a96350ca7f0a784d082a23d8119f825a7c2ca`。该附件已从公开 URL 经标准 CLI 在独立 profile 安装、检查入口并卸载；GitHub tag 源码安装亦已完成同样验证。尚未发布 npm，Release 路线已提供可安装下载源；若后续发布 npm，repository 必须继续指回本仓库，不在目录条目里填写 npm key。

实际投稿文件已准备为 `docs/marketplace-entry.yml`；提交到目录仓库时放到 `data/plugins/miaomiao-r1__dsh-agent-model-router.yml`，只提交该条目，不改目录的生成 README。公开仓库创建于北京时间 2026-10-15 01:46:11，满 24 小时前不提交 PR。真实完整验收和截图仍按下文分别记录。

## 本地打包准备

1.0.0-rc.1 已通过 53 项本地测试、语法/工作流同步和实际包检查；该版本为预发布，最新完整实机验收仍待完成。用户于 2026-10-15 提供的实际插件截图已保存为 `assets/agent-models.png`，根目录 `screenshots.json` 已声明该相对路径，README 同步展示；截图推荐项已完成。安全审查及开发卸载修复见 [security-review.md](security-review.md)。

发布检查脚本 `scripts/verify-package.mjs` 用于检查实际 `.tgz` 解包内容、入口与依赖、workflow、许可文件，以及隔离环境中的安装和卸载范围。使用 `npm run verify:package` 执行。打包产物写入 `artifacts/*.tgz`；它是构建产物，不纳入项目树维护清单。

另已实测从 GitHub codeload 下载固定提交 d55a05667c3272bd6f7847830a2d94ae35efce61，以标准 DSH CLI 安装到独立 github-install-check 的 release-check profile，关闭构建脚本，运行包入口检查后卸载。安装与卸载均验证 manifest/bundle 注册；不表示该 profile 已运行真实模型。

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
