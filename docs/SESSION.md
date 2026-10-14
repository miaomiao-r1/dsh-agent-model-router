# 当前开发状态

开发目录已迁至 `C:\Users\14173\Documents\agent_role_models`，DSH desktop profile 的本地依赖与加载链接应指向此目录。

## 已完成

- 左侧代理模型页面、五角色模型选择、启用目录刷新、全局历史映射与即时多代理开关。
- 原子存储、安装卸载脚本、取消与失败处理。
- 修复宿主加载依赖隔离 workflowEngine 导致配置接口未注册的问题。
- 修复工具参数缺少完整 JSON Schema 外层，导致模型将数组以字符串传入的问题。
- 最新开发副本与迁移前安装副本逐文件一致；38 项本地测试和语法检查通过。

## 待验收

- 参数 schema 修正之后的真实 explore 子代理运行，取得实际 runId、agentsStarted 和结果。
- 模型切换后的真实调用路由、新旧会话映射与目录停用行为。
- 不把此前失败的两次真实验收记为成功；两次失败均发生于 plan 参数校验，未启动代理。

## 下一步

在本目录执行 `npm test` 和 `npm run check`。重启 DSH 后新建会话，先调用 agent_role_models，再调用 agent_orchestrate，显式传入数组 `plan: ["explore"]`，执行只读根目录摘要并检查实际运行记录。
