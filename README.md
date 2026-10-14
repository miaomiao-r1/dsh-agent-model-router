# DSH 代理模型

配合 `dsh-our-free-model`，在左侧导航增加“代理模型”。五类角色可分别选择已启用模型，支持搜索和通道分组。配置对所有工作区共用，保存后创建的新主会话采用新映射，已有会话和任务保持原映射。

## 使用

1. 打开左侧“代理模型”。每次进入页面、窗口恢复焦点时，插件重新读取宿主当前启用目录。
2. 为 explorer、worker、tester、researcher、reviewer 选择模型，点击“保存设置”。停用模型保留旧选择并提示不可用，不自动回退。
3. 开启顶部“多代理模式”。开关默认关闭，对后续编排调用立即生效；关闭不取消已在运行的任务。
4. 新建主会话，要求使用 `agent_role_models` 检查映射，使用 `agent_orchestrate` 分阶段执行有界任务。探索之后由根决定方案，再携带返回的 `handoff` 作为 `prior` 继续实现/验证/审查。小任务仍可由根完成；不为凑数量拆成三个 worker。

开关控制本插件的执行入口，不修改 DSH 自带 Agent Teams 或其他插件的代理功能。主会话模型由原来的会话控件设置，插件不更改它。

## 安装与卸载

在完整插件根目录执行：

```powershell
node scripts/install.mjs
```

安装器为当前 desktop profile 增加自身依赖和 bundle 注册，创建指向本目录的链接，并备份原 manifest。不会修改全局 AGENTS 或其他插件状态。同名注册或路径冲突时停止。首次安装后需要重新启动 DSH；正在运行的工作请先完成。

```powershell
node scripts/uninstall.mjs
```

卸载移除自身依赖、bundle 和安装链接，保留插件源文件与 `~/.dsh/agent-model-router/settings.json`。支持通过 `DSH_HOME` 指定独立 DSH 数据目录；不要在测试时误用真实主目录。

## 验证

```powershell
node --test tests/*.test.mjs
npm run check
```

测试覆盖目录重新读取、停用模型、原子保存、并发版本冲突、跨重启恢复、新旧会话映射、开关即时关闭、取消信号和安装卸载范围。HTTP 测试只连接本机隔离测试服务。

模型目录由宿主 `llm.listModels(provider)` 提供，使用 adapter 当前广告清单，不把上游模型总列表冒充已启用目录。凭据不传给客户端。已启用不是成功率保证，真实调用失败会明确阻断。

子代理权限继承调用会话；提示词中的只读要求不是文件系统沙箱。结构化状态和测试证据仍须根复核，阶段通过不等于整体任务验收。

服务端仅依赖宿主的 `llm` 与 `tools`。执行编排时使用调用会话可见的 `workflow` 工具，沿用该预设的引擎、取消和运行记录；没有 workflow 的预设会明确报错。配置页面不依赖全局 workflowEngine，支持 DSH 将引擎隔离在会话预设内的结构。

## 来源与许可

角色编排思路及引擎基于 `itsolver/codex-sol-luna-orchestrator` 的 Apache-2.0 版本适配，保留失败门、独立角色和根验收责任。原许可见 `THIRD-PARTY-LICENSE.txt`。插件代码采用 Apache-2.0；DSH 与依赖插件遵循各自许可，本包不附带其安装程序或凭据。
