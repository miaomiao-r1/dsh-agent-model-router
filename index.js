import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SettingsStore} from './source/store.mjs';
import {RouterService} from './source/router.mjs';
import {createHttpHandler} from './source/http.mjs';
import {DEFAULT_ROLES} from './source/defaults.mjs';
import {runLayeredWorkflow} from './source/handoff.mjs';
import {assessDelegation} from './source/delegation.mjs';
import {RoutingPolicy} from './source/policy.mjs';
import {RuntimeDiagnostics} from './source/runtime.mjs';

export const name='dsh-agent-model-router';
export const inject=['llm','tools'];
const HERE=path.dirname(fileURLToPath(import.meta.url));
const render=(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}];

export function apply(ctx,config={}){
  const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
  const file=config.stateFile||path.join(home,'agent-model-router','settings.json');
  const store=new SettingsStore({file,defaults:DEFAULT_ROLES});
  const script=fs.readFileSync(path.join(HERE,'engine/orchestrate.workflow.js'),'utf8');
  let policy;
  const diagnostics=new RuntimeDiagnostics({root:HERE,capabilities:()=>({toolGuard:typeof ctx.tools.guard==='function',dispatchMiddleware:typeof ctx.on==='function',preExecuteObserved:policy?.preExecuteObserved??false,sandboxPolicy:typeof (ctx.get?.('sandboxPolicy')||ctx.sandboxPolicy)?.resolve==='function'})});
  const service=new RouterService({llm:ctx.llm,store,script,diagnostics,runWorkflow:async(request,exec)=>{
    policy.assertPlanCapabilities(request,exec);
    const workflow=ctx.tools.get('workflow',exec.agent);
    if(!workflow||typeof workflow.execute!=='function')throw Error('当前会话预设没有可用的 workflow 工具，请选择支持编排的代理预设');
    return runLayeredWorkflow({request,exec,directory:config.handoffDirectory||path.join(home,'agent-model-router','handoffs'),run:(stageRequest,stageExec)=>policy.withStage(stageRequest,stageExec,()=>workflow.execute({...stageRequest,run_in_background:false},stageExec))});
  }});
  const handles=[];
  policy=new RoutingPolicy({ctx,service});service.policy=policy;handles.push(...policy.install());
  const delegationSchema={type:'object',properties:{scopeCount:{type:'integer',minimum:1,description:'根确认的独立工作范围数量，不能仅按文件数量判断。'},risk:{type:'string',enum:['low','medium','high']},explicitRequest:{type:'boolean',description:'用户是否明确要求多代理。'},needsIndependentCheck:{type:'boolean',description:'是否确有独立测试或审查需求。'},taskKind:{type:'string',enum:['conversation','exploration','implementation','testing','research','review','vision','decision']},bounded:{type:'boolean',description:'任务边界、输入与完成标准是否已明确。'},effort:{type:'string',enum:['small','substantial'],description:'工作量，不等同于范围或文件数量。'},complexity:{type:'string',enum:['simple','moderate','complex'],description:'推理复杂度；complex 一律由根代理（Manager）处理，不委派。'},useNativeTool:{type:'boolean',description:'仅在用户明确要求保留宿主原生委派语义时为true。豁免自记录起 10 分钟内最多覆盖 32 次原生调用，足以覆盖一次并行扇出；显式指定 provider/model 的原生调用只能走此路径。'}},required:['scopeCount'],additionalProperties:false};
  handles.push(ctx.tools.register({name:'agent_delegation_route',description:'评估任务边界、工作量、风险与独立检查需要。明确且工作量足够的单范围也可委派；根执行小改动/命令前记录评估。route=root 的评估在同一工作区内按任务复用（15 分钟/50 次上限），工作区变更即失效；只读检查类 shell 命令无需评估。',parameters:delegationSchema,output:{schema:{type:'object',additionalProperties:true},render},execute:(args,exec)=>{const decision=assessDelegation(args);policy.recordAssessment(exec||{},decision,args);return decision;}}));
  handles.push(ctx.tools.register({name:'agent_delegate',description:'一步按已保存模型委派明确任务。role 必填；worker 必须给精确files，tester 必须给完整commands；其他角色只读。根调用即批准该有界执行合同，不用于下放模糊或高风险决策。',parameters:{type:'object',properties:{role:{type:'string',enum:['explorer','worker','tester','researcher','reviewer','visioner','scribe']},task:{type:'string',minLength:1},files:{type:'array',items:{type:'string',minLength:1},minItems:1},commands:{type:'array',items:{type:'string',minLength:1},minItems:1},visionInputs:{type:'array',items:{type:'string'}},constraints:{type:'array',items:{type:'string'}},acceptanceCriteria:{type:'array',items:{type:'string'}},operationId:{type:'string',maxLength:160}},required:['role','task'],additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render},execute:(args,exec)=>policy.delegate(args,exec)}));
  handles.push(ctx.tools.register({
    name:'agent_role_models',description:'读取本会话有效的七角色（探索/实现/验证/查证/审查/识图/文书）模型映射及最新模型目录状态。目录包含当前 DeepSeek Harness 注册并广告的全部模型通道，不限于某个插件；全局设置仅对保存后新建的主会话生效。',
    parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render},
    async execute(_args,exec){const snapshot=await service.forAgent(exec.agent),catalogue=await service.catalogue(),current=await store.read();const enabled=new Set(catalogue.models.map(row=>JSON.stringify([row.provider,row.model])));return {enabled:current.enabled,snapshot,latestVersion:current.version,runtime:diagnostics.status(),catalogue:{ok:catalogue.ok,partial:catalogue.partial,errors:catalogue.errors,count:catalogue.models.length,availability:Object.fromEntries(Object.entries(snapshot.roles).map(([role,route])=>[role,enabled.has(JSON.stringify([route.provider,route.model]))]))}};}
  }));
  const fields={
    task:{type:'string',description:'明确的总体任务。'},
    operationId:{type:'string',maxLength:160,description:'同一操作的稳定标识；重复调用返回已有结果，不重复写文件。明确开始新一轮时使用新标识。缺省按本会话和完整输入生成。'},
    resumeFrom:{type:'string',pattern:'^[a-f0-9]{64}$',description:'使用返回的 operationId 续跑，必须同会话、相同输入。已完成阶段跳过；写入结果未知时须先检查，不自动重试。'},
    delegation:{...delegationSchema,description:'先用 agent_delegation_route 评估并传入相同评估。简单任务返回 root_required，不启动代理；用户明确要求多代理时 explicitRequest=true。'},
    plan:{type:'array',items:{type:'string',enum:['explore','research','implement','test','review','vision','scribe']},description:'按需选择阶段，传 JSON 数组（如 ["explore"]），不要传字符串。vision 为识图阶段，须排在其他阶段之前。'},
    prior:{type:'object',additionalProperties:true,description:'上轮阶段证据、rootPlan、约束与验收标准。'},
    channelConcurrency:{type:'object',additionalProperties:true,description:'本次运行各通道并发上限，缺省为1。'},
    exploreTargets:{type:'array',items:{type:'string'}},researchQuestions:{type:'array',items:{type:'string'}},
    workTasks:{type:'array',items:{type:'object',additionalProperties:true},description:'默认单任务；多个worker需objective和不重叠files。'},
    testTasks:{type:'array',items:{type:'string'},description:'兼容的根批准完整测试命令清单；含 test 阶段时必须提供本字段或 testCommands。'},reviewTasks:{type:'array',items:{type:'string'}},scribeTasks:{type:'array',items:{type:'string'},description:'文书阶段的整理/格式化任务清单。'},
    testCommands:{type:'array',items:{type:'string',minLength:1},description:'根授权的完整测试命令。含 test 阶段时必须提供本字段或 testTasks，否则整份计划在启动前拒绝。tester 只可在只读沙箱执行这些原样命令，不能覆盖权限或工作区。'},
    visionTargets:{type:'array',items:{type:'string'},description:'识图阶段的图片引用或描述；每项为一个待识别的图片路径、URL 或说明。'},
    capabilities:{type:'array',items:{type:'string'},description:'声明本任务所需能力。含 "vision" 时，若 plan 未显式含 vision，自动在 plan 前插入 vision 阶段。'},
    visionInputs:{type:'array',items:{type:'string'},description:'图片输入引用。非空时与 capabilities:["vision"] 等效，触发自动插入 vision 阶段。'},
    constraints:{type:'array',items:{type:'string'}},acceptanceCriteria:{type:'array',items:{type:'string'}}
  };
  handles.push(ctx.tools.register({
    name:'agent_orchestrate',description:'按“代理模型”已保存的会话映射执行有界多角色工作流。用于边界明确且有委派收益的任务，也支持用户明确要求多代理或独立验证。先探索、根做决策，再携prior分阶段调用；缺省 plan 且无 prior.rootPlan 时按 ["explore"] 执行并真实启动 explorer 子代理。不要为凑并发拆任务；不得嵌套调用本工具。识图：传 capabilities:["vision"] 或 visionInputs 非空时，自动在 plan 前插入 vision 阶段，派给 visioner 角色绑定模型；也可显式 plan:["vision",...]。',
    parameters:{type:'object',properties:fields,required:['task'],additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render},
    execute:(args,exec)=>service.execute(args,exec)
  }));
  ctx.inject(['webServer','connection'],sub=>{sub.effect(()=>sub.webServer.register({kind:'prefix',path:'/agent-model-router',handler:createHttpHandler({service,connection:sub.connection})}),'agent-model-router HTTP routes');});
  ctx.inject(['systemPrompt'],sub=>sub.systemPrompt.section({
    name:'tool:agent-model-router',order:sub.systemPrompt.getSectionOrder('TOOL_WORKFLOW'),
    text:[
      'Global DSH AGENTS.md remains active. Continue following its non-conflicting rules for user intent, task scope, ownership, root decisions, and verification. If the user explicitly names another delegation tool, use it. When delegation is being considered through this plugin, follow this plugin-specific tool path over generic tool-selection guidance.',
      'For root direct execution, call agent_delegation_route with scopeCount, risk, explicitRequest, needsIndependentCheck, taskKind, bounded, effort, and complexity. Bounded substantial work may delegate even with one scope. Tiny tasks stay with root; ambiguous plans and high-risk decisions require root judgment. complexity=complex always stays with the Manager.',
      '探索或排查类请求：预计要检索多个文件或工作量足够时，先 agent_delegation_route(taskKind:\'exploration\')；评估为 delegate 则用 agent_delegate(role:\'explorer\') 或 agent_orchestrate(plan:[\'explore\']) 启动 explorer 子代理；只查看一两个文件时由根直接读取，不必委派。',
      'Read agent_role_models to check the harness model catalogue and saved session mappings. Every model the harness currently advertises may be assigned to a role; the plugin applies no provider whitelist. Explicit agent_delegate or agent_orchestrate calls confirm the bounded delegation decision; an optional delegation assessment must agree. Do not pass roles overrides or hard-code a different model. A reviewer in the same model family as the worker only triggers a warning, never a silent pass.',
      'Use agent_delegate or agent_orchestrate directly for plugin-managed work. On hosts with asynchronous activation/subagentId delegation, ordinary subagent and subagent_fork calls return a redirect before any work starts: retry through the named plugin helper with the original task and constraints. Legacy foreground hosts retain automatic role routing. Generic workflow requires agent_orchestrate. When mode is disabled, plugin helpers are unavailable and native host delegation follows its own rules. If the user explicitly requests native semantics, record useNativeTool:true in a delegation assessment; the exemption then covers up to 32 native calls within 10 minutes, so issue the whole parallel fan-out promptly after the assessment. Calls that set provider/model explicitly cannot be expressed by agent_delegate or agent_orchestrate — always use the native exemption path for them.',
      'Keep root architectural decisions, ambiguous or high-risk decisions, and final verification with the root. Default to one worker; parallel workers need independent exact file ownership. Multiple scopes do not authorize parallel writes.',
      'Use agent_delegate for one-step bounded execution: role and task, exact files for worker, exact commands for tester, visionInputs for images. Missing rootPlan defaults agent_orchestrate to exploration and returns a root decision continuation. Native subagent dispatch is either redirected before launch or intercepted according to its output contract; ambiguous roles or unbounded writes require the explicit helper. Root mutations and shell require agent_delegation_route first; bounded substantial single-scope work can delegate. Read-only children have a logged read-only sandbox, write/tool guards and no nested delegation. A blocked or failed result is not completion. Role mappings apply to new main sessions. Preserve operationId for retries and use resumeFrom only after inspecting the returned recovery state; unknown writes must not be blindly retried.'
    ].join(' ')
  }));
  ctx.inject(['systemPrompt'],sub=>sub.systemPrompt.section({name:'tool:agent-model-router-handoff',order:sub.systemPrompt.getSectionOrder('TOOL_WORKFLOW'),text:'For staged implementation through agent_orchestrate, provide the root-approved plan in prior.rootPlan; agent_delegate worker confirms a bounded one-step plan using its exact files. High-risk decisions and ambiguous plans belong to the root. Multiple scopes do not authorize parallel writes. Phase handoffs contain role-relevant excerpts plus absolute paths to full JSON reports; read original reports and changed files as needed, never assume an excerpt is complete. Keep user constraints, exact failures, unresolved questions and evidence locations. Missing evidence or decisions require blocked/needs_decision.'}));
  ctx.effect(()=>()=>{for(const handle of handles)if(typeof handle==='function')handle();},'agent-model-router tools');
  return service;
}
