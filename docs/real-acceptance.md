# 真实运行与截图验收

目标版本：1.0.0-rc.1。正式工作区：`C:\Users\14173\Documents\agent_role_models`。

## 连接与边界

当前桌面窗口已打开，但本会话的浏览器会话没有登录宿主；Playwright 访问 127.0.0.1:19387 返回 401。浏览器独立配置不会继承桌面登录。需要用户在可操作的浏览器里打开 DSH 提供的已登录地址；登录令牌、cookie 和供应商凭据无需发送到聊天，也不纳入仓库或截图。

模型工具验收不需要浏览器登录：桌面端已能调用插件工具。浏览器401只阻塞配置界面自动操作和截图，不应据此停止可执行的模型阶段。

必须先在DSH中切换工作区为 `C:\Users\14173\Documents\agent_role_models`，再新建主会话。仅把该路径写进默认工作区会话的消息，不会改变会话的cwd或沙箱边界。只有桌面端时，在这个正式工作区新会话发送下方指令并导出记录即可；截图和配置界面操作单独完成。

## 五角色与交接

把以下内容发给 DSH。确认宿主已加载 `agent_delegation_route`；工具不存在时报告“需要加载新插件”，不要自动修改其他插件或强行改模型。

> 这是执行请求，不是要求再生成验收计划或转交提示词。先核对本会话实际cwd；若不是C:\Users\14173\Documents\agent_role_models，只报告工作区不匹配，不声称已执行验收。若匹配，立即按下面的有界方案调用实际工具。浏览器401不阻止模型工具验收；截图和配置界面另行标记待完成。不得把主代理自己读取package.json或README记为explorer/researcher子代理运行。

> 执行 dsh-agent-model-router 1.0.0-rc.1 的有界验收。先调用 agent_role_models 记录映射、版本和开关，再用 agent_delegation_route 明确 explicitRequest=true、scopeCount=1、risk=low。使用 agent_orchestrate 分阶段调用 explore、research、implement、test、review，记录每阶段真实 runId、childId、agentsStarted 和宿主请求路由。目标仅为 C:\Users\14173\Documents\agent_role_models\artifacts\real-acceptance，不得改项目源码或用户其他文件，不改主会话模型，不自动替换失败或停用角色模型。explore 只读取正式项目 package.json 的名称、版本和 dsh.bundle，不递归，不读取凭据；research 只核对 README 中 free-model 与本插件的职责。根审批方案为：worker 仅在上述 artifacts 目录创建 acceptance.mjs，内容 console.log('acceptance-ok')；tester 用 node 执行它并记录实际退出码与输出；reviewer 回查完整报告和该文件。将根方案作为 prior.rootPlan，并传递各阶段完整 handoff。某角色失败、归档失败或沙箱拒绝时停止依赖阶段，准确报告失败，不计成功，不擅自扩大权限。

## 避免重复耗尽输出预算

2026-10-15 正式工作区两次 explorer 子会话均以 `max-tokens` 结束，未调用 `structured_output`。宿主对失败或缺少结构化输出均返回 `null`，不能仅凭此判断模型格式不合规。当前开发版已将此情况单独标为 `outputUnavailable`；详细原因仍须读取子会话的 `turn/end`，不可伪造宿主没有提供的停止原因。

重跑时将每阶段任务写成明确、短小的 objective：explorer 仅读 package.json 的 name/version/dsh.bundle 后立即提交简短结构化报告；researcher 仅读 README 的职责说明。通过宿主提供的 `structured_output` 工具提交结果。前置角色无须证明尚未创建的 acceptance.mjs、后续报告、截图或整个验收已完成，不应为此遍历 tests、历史 SESSION、配置目录和其他会话。五角色仅验收这个最小工件，阶段完成与整个任务验收分别判断。不自动增加宿主输出预算或切换模型。

## 配置行为

- 保存原始五角色映射、版本和模式状态；只使用目录当前启用的模型，不修改 free-model 通道或凭据。
- 创建旧会话并记录快照；临时修改 explorer 到另一个启用模型，保存后创建新会话。分别调用 agent_role_models，核对旧会话保留旧版本/路由、新会话使用新版本/路由，并各执行一次只读 explore 以核对请求配置。
- 关闭模式后，在新调用中验证编排未启动；打开后验证可启动。已有运行应不中断，不能只依据界面提示判定。
- 按版本保护恢复原始映射和开关。若其他用户或会话已修改配置，停止恢复并报告冲突，不覆盖新设置。

## 界面截图

2026-10-15 已采用用户提供的实际插件页面截图，原样保存到 `assets/agent-models.png`，并创建根目录 `screenshots.json`。截图展示五角色选择、已启用的模式开关和配置版本，未见凭据或个人会话内容。此项完成不代表所有角色的模型调用与配置行为验收已完成。

实际“代理模型”页面至少保存一张截图，展示五角色选择和模式开关；不包含凭据、个人会话、其他项目内容。图片保存为 `assets/agent-models.png`，检查无敏感内容后再创建根目录 `screenshots.json`：

```json
["assets/agent-models.png"]
```

截图未实际取得前，不创建指向不存在文件的 manifest，也不用示例数据界面替代实机截图。市场页面和 GitHub Release 页面截图不是插件界面截图。

## 证据要求

保留成功和失败结果。根核对宿主的 workflow 启动/结束事件、子会话 request/header 中 provider/model、结构化报告及实际 artifacts 文件。代理的 passed 或 filesModified=[] 不能单独证明测试通过或文件系统零变化。模型路由证据不证明供应商实际后端身份。
