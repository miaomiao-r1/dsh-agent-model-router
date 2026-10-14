# DSH Agent Model Router Implementation Plan

Goal: 注册左侧“代理模型”，在所有工作区共享五角色映射，打开页面刷新当前启用模型，只有保存后创建的主会话采用新版本。
Architecture: plugin host 提供目录和原子配置接口，自有编排工具以主会话创建时间选择历史配置；client 通过 sidebar.panellist/main 注册页面；复用已验证引擎。
Tech stack: Node ESM、DSH Cordis 插件、原生 React 客户端、Node test runner。

- [ ] 存储：source/store.mjs 与 tests/store.test.mjs，先测试版本冲突、失败保留、重启恢复、旧会话历史映射，再实现原子写入。
- [ ] 目录与路由：source/router.mjs、tests/router.test.mjs，读取 llm.listProviders/listModels 当前启用目录；保存和执行二次校验，按主会话创建时间取快照；tool 禁止传 roles 覆盖 UI 保存值。
- [ ] Host：index.js 注册鉴权同源配置接口、agent_role_models 与 agent_orchestrate 工具；继承 parent/signal/cancellation；只在plugin自己目录写状态。
- [ ] Client：client.js 注册左侧入口、原生风格页面；打开/回到页面拉取目录；中文职责、可搜索分组模型、失效状态、版本冲突与保存提示。
- [ ] Package：package.json/cordis.patch.yml、安装卸载脚本，仅新增plugin条目并保留现有配置；同名冲突先停止；无需修改全局AGENTS。
- [ ] 验收：Node单元/宿主契约/原生guest测试；UI暗色和窄屏；独立只读任务验证所选route。安装后检查真实host加载日志与配置差异；不终止用户正在运行的会话。
