# 代理模型插件开发规则

- 正式开发工作区：`C:\Users\14173\Documents\agent_role_models`。后续源码、测试、文档与开发命令均以此目录为准。
- 插件包名：`dsh-agent-model-router`，用于 DeepSeek Harness，与 `dsh-our-free-model` 配合。
- 优先遵循用户当前指令及全局 AGENTS 规则。小任务直接执行；仅在收益明确时使用指定 Luna Worker，禁止二次委派。
- 开发前读取 `docs/SESSION.md`；新增、删除、移动主要项目文件时更新 `文档/项目树.md`。
- 模型映射跨工作区共享，保存后仅新建主会话采用新映射；多代理开关即时控制新编排，已有运行不中断。
- 不修改主会话模型、全局 AGENTS 或无关插件。不得自动替换停用模型或改变模型 ID 大小写。
- 工具参数使用完整 JSON Schema；workflowEngine 位于会话预设隔离范围，编排使用调用会话可见的 workflow 工具。
- 验证命令：`npm test`、`npm run check`。区分本地测试通过与真实子代理编排通过。
- 源码更改在此目录进行；其他历史副本仅作备份，不继续修改。
