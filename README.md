# DSH 代理模型

本插件与 `dsh-our-free-model` 配合使用：先安装并启用后者提供的通道，再为 explorer、researcher、worker、tester、reviewer 五类代理角色分配其中已启用的模型，按任务分工使用不同模型通道的免费额度。通道凭据和模型可用性由 `dsh-our-free-model` 管理；本插件管理角色映射与分阶段工作流。供应商的免费额度和使用条款各自适用，部分通道可能不免费；请只选择已确认有免费额度且符合其条款的通道。

## 与其他模型路由插件的区别

本插件面向五角色分工和工作流，不负责检查额度余额或剩余量，也不会按余量调度、额度耗尽后自动切换模型。可选项来自固定 provider 广告清单，并按启用状态过滤；新主会话使用创建时取得的角色映射快照，保存配置不会替换已有会话的映射。因此它帮助用户把已启用通道模型分配给不同任务角色，不承诺无限免费、零费用或具体节省金额。

左侧导航提供“代理模型”页面，模型列表支持搜索和通道分组。配置对所有工作区共用，保存后创建的新主会话采用新映射，已有会话和任务保持原映射。

## 使用

1. 打开左侧“代理模型”。每次进入页面、窗口恢复焦点时，插件重新读取宿主当前启用目录。
2. 为 explorer、worker、tester、researcher、reviewer 选择模型，点击“保存设置”。停用模型保留旧选择并提示不可用，不自动回退。
3. 开启顶部“多代理模式”。开关默认关闭，对后续编排调用立即生效；关闭不取消已在运行的任务。
4. 新建主会话，要求使用 `agent_role_models` 检查映射，使用 `agent_orchestrate` 分阶段执行有界任务。探索之后由根决定方案，再携带返回的 `handoff` 作为 `prior` 继续实现/验证/审查。小任务仍可由根完成；不为凑数量拆成三个 worker。

开关控制本插件的执行入口，不修改 DSH 自带 Agent Teams 或其他插件的代理功能。主会话模型由原来的会话控件设置，插件不更改它。

## 分层交接与委派

根先调用 `agent_delegation_route`，传入确认后的 `scopeCount`、`risk`、`explicitRequest`、`needsIndependentCheck`；编排时把相同评估作为 `delegation` 传入。单范围且无需独立验证时返回 `root_required`、agentsStarted=0，由根处理。用户明确要求多代理可设置 explicitRequest=true；多个范围不自动授权并行，高风险决策由根负责。旧调用未传评估仍兼容，不按提示词长度猜复杂度。

完整输入和各阶段报告保存到 `~/.dsh/agent-model-router/handoffs/<运行目录>/`。worker 接收探索/查证，tester 接收实现，reviewer 接收实现/测试。summary、evidence、commands 超过 1600 字符时节选，并附完整 JSON 的 source.path/pointer；约束、根方案、错误、未决问题和结构化发现不截断。下一角色必须按索引回查完整报告和实际文件，缺少证据时返回 blocked，不能补猜。

实现必须有 `prior.rootPlan`，否则返回 needs_decision，不启动 worker。探索后由根确认方案，再携完整 handoff 继续调用。失败、取消、归档失败阻止后续阶段；报告无自动删除，按需人工清理。

多阶段调用的 `result.runs` 提供各阶段 runId，顶层 runId 为最后记录阶段，agentsStarted 为总数；`result.handoff` 保留完整报告，`result.reportFiles` 给出原件路径。本机制不承诺 token 或缓存改善。

修改 `engine/engine.cjs` 后执行 `npm run build:workflow`；`node scripts/build-workflow.mjs --check` 校验生成脚本同步。

## 安装与卸载

### 发布包安装

公开源码仓库：https://github.com/miaomiao-r1/dsh-agent-model-router 。可使用标准 bundle 安装源码：

```powershell
dsh plugin --profile desktop add github:miaomiao-r1/dsh-agent-model-router
```

此包入口已随源码提供，无需安装期构建。固定提交的 GitHub 源码下载、入口检查、标准 CLI 安装与卸载已在独立 profile 实测通过；市场点击安装仍待收录后验收。

插件要求 Node.js 20 或更高版本。使用模型配置需先启用 `dsh-our-free-model` 所需通道，使用编排还需调用预设提供 `workflow` 工具。发布前可在源码目录运行 `npm run verify:package` 生成 `artifacts/dsh-agent-model-router-1.0.0-rc.1.tgz`；公开发布后可从 GitHub Release 下载。将下例路径替换为本机 tarball 的绝对路径：

```powershell
dsh plugin --profile desktop add "C:\绝对路径\dsh-agent-model-router-1.0.0-rc.1.tgz"
dsh plugin --profile desktop remove dsh-agent-model-router
```

使用 web profile 时，将 `desktop` 换成 `web`。已使用桌面版内置 DSH 0.2.0-rc.2 和 pnpm 11.7.0，在独立 `DSH_HOME` 的 `release-check` profile 验证 tarball 安装、bundle 注册及卸载。此结果不代表真实模型编排通过，DSH 最低兼容版本也尚未确定。首次安装后按宿主提示刷新或重启。

### 开发目录链接（仅开发）

以下方式仅用于本地开发和调试，不是发布包安装方式。在完整插件根目录执行：

```powershell
node scripts/install.mjs
```

安装器为当前 desktop profile 增加自身依赖和 bundle 注册，创建指向本目录的链接，并备份原 manifest。不会修改全局 AGENTS 或其他插件状态。同名注册或路径冲突时停止。首次安装后需要重新启动 DSH；正在运行的工作请先完成。

```powershell
node scripts/uninstall.mjs
```

开发卸载移除自身依赖、bundle 和安装链接，保留插件源文件与 `~/.dsh/agent-model-router/settings.json`。支持通过 `DSH_HOME` 指定独立 DSH 数据目录；不要在测试时误用真实主目录。

## 验证

```powershell
node --test tests/*.test.mjs
npm run check
npm run verify:package
```

测试覆盖目录重新读取、停用模型、原子保存、并发版本冲突、跨重启恢复、新旧会话映射、开关即时关闭、取消信号和安装卸载范围。HTTP 测试只连接本机隔离测试服务。

`verify:package` 实际打包并解包，检查运行文件、语法、宿主导入与许可，验证开发安装器在临时目录中的安装卸载。它不启动 DSH、不请求模型；标准 CLI 实测与真实编排分别记录在 [发布指南](docs/marketplace-release.md)（源码仓库文档）。执行该命令需 npm 和系统 tar；Windows 使用系统自带 tar.exe。

模型目录由宿主 `llm.listModels(provider)` 提供，使用 adapter 当前广告清单，不把上游模型总列表冒充已启用目录。凭据不传给客户端。已启用不是成功率保证，真实调用失败会明确阻断。

子代理权限继承调用会话；提示词中的只读要求不是文件系统沙箱。结构化状态和测试证据仍须根复核，阶段通过不等于整体任务验收。

服务端仅依赖宿主的 `llm` 与 `tools`。执行编排时使用调用会话可见的 `workflow` 工具，沿用该预设的引擎、取消和运行记录；没有 workflow 的预设会明确报错。配置页面不依赖全局 workflowEngine，支持 DSH 将引擎隔离在会话预设内的结构。

## 来源与许可

角色编排思路及引擎基于 `itsolver/codex-sol-luna-orchestrator` 的 Apache-2.0 版本适配，保留失败门、独立角色和根验收责任。原许可见 `THIRD-PARTY-LICENSE.txt`。插件代码采用 Apache-2.0；DSH 与依赖插件遵循各自许可，本包不附带其安装程序或凭据。
