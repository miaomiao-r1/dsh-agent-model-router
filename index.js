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

export const name='dsh-agent-model-router';
export const inject=['llm','tools'];
const HERE=path.dirname(fileURLToPath(import.meta.url));
const render=(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}];

export function apply(ctx,config={}){
  const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
  const file=config.stateFile||path.join(home,'agent-model-router','settings.json');
  const store=new SettingsStore({file,defaults:DEFAULT_ROLES});
  const script=fs.readFileSync(path.join(HERE,'engine/orchestrate.workflow.js'),'utf8');
  const service=new RouterService({llm:ctx.llm,store,script,runWorkflow:async(request,exec)=>{
    const workflow=ctx.tools.get('workflow',exec.agent);
    if(!workflow||typeof workflow.execute!=='function')throw Error('当前会话预设没有可用的 workflow 工具，请选择支持编排的代理预设');
    return runLayeredWorkflow({request,exec,directory:config.handoffDirectory||path.join(home,'agent-model-router','handoffs'),run:(stageRequest,stageExec)=>workflow.execute({...stageRequest,run_in_background:false},stageExec)});
  }});
  const handles=[];
  const delegationSchema={type:'object',properties:{scopeCount:{type:'integer',minimum:1,description:'根确认的独立工作范围数量，不能仅按文件数量判断。'},risk:{type:'string',enum:['low','medium','high']},explicitRequest:{type:'boolean',description:'用户是否明确要求多代理。'},needsIndependentCheck:{type:'boolean',description:'是否确有独立测试或审查需求。'}},required:['scopeCount'],additionalProperties:false};
  handles.push(ctx.tools.register({name:'agent_delegation_route',description:'根据根确认的任务范围、风险和独立验证需求，判断由根处理还是委派；不启动代理，不改变模型。',parameters:delegationSchema,output:{schema:{type:'object',additionalProperties:true},render},execute:args=>assessDelegation(args)}));
  handles.push(ctx.tools.register({
    name:'agent_role_models',description:'读取本会话有效的五角色模型映射及最新启用状态。全局设置仅对保存后新建的主会话生效。',
    parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render},
    async execute(_args,exec){const snapshot=await service.forAgent(exec.agent),catalogue=await service.catalogue(),current=await store.read();return {enabled:current.enabled,snapshot,catalogue};}
  }));
  const fields={
    task:{type:'string',description:'明确的总体任务。'},
    delegation:{...delegationSchema,description:'先用 agent_delegation_route 评估并传入相同评估。简单任务返回 root_required，不启动代理；用户明确要求多代理时 explicitRequest=true。'},
    plan:{type:'array',items:{type:'string',enum:['explore','research','implement','test','review']},description:'按需选择阶段，传 JSON 数组（如 ["explore"]），不要传字符串。'},
    prior:{type:'object',additionalProperties:true,description:'上轮阶段证据、rootPlan、约束与验收标准。'},
    channelConcurrency:{type:'object',additionalProperties:true,description:'本次运行各通道并发上限，缺省为1。'},
    exploreTargets:{type:'array',items:{type:'string'}},researchQuestions:{type:'array',items:{type:'string'}},
    workTasks:{type:'array',items:{type:'object',additionalProperties:true},description:'默认单任务；多个worker需objective和不重叠files。'},
    testTasks:{type:'array',items:{type:'string'}},reviewTasks:{type:'array',items:{type:'string'}},
    constraints:{type:'array',items:{type:'string'}},acceptanceCriteria:{type:'array',items:{type:'string'}}
  };
  handles.push(ctx.tools.register({
    name:'agent_orchestrate',description:'按“代理模型”已保存的会话映射执行有界多角色工作流。仅当用户明确要求多代理或任务确实需要独立角色时调用。先探索、根做决策，再携prior分阶段调用。不要为凑并发拆任务；不得嵌套调用本工具。',
    parameters:{type:'object',properties:fields,required:['task'],additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render},
    execute:(args,exec)=>service.execute(args,exec)
  }));
  ctx.inject(['webServer','connection'],sub=>{sub.effect(()=>sub.webServer.register({kind:'prefix',path:'/agent-model-router',handler:createHttpHandler({service,connection:sub.connection})}),'agent-model-router HTTP routes');});
  ctx.inject(['systemPrompt'],sub=>sub.systemPrompt.section({
    name:'tool:agent-model-router',order:sub.systemPrompt.getSectionOrder('TOOL_WORKFLOW'),
    text:'When the user asks for role-based multi-agent orchestration, first call agent_role_models. If enabled is false, do not invoke agent_orchestrate or substitute another workflow for this plugin mode; work as the root or explain how to enable the mode. If enabled is true, use agent_orchestrate so subagents use the role mappings selected in the Agent Models sidebar. Do not pass roles overrides or hard-code a different model. Keep root architectural decisions and final verification. Use prior for phase handoff. Default to one worker; parallel workers need independent exact file ownership. A blocked/failed result is not completion. Role model settings apply only to main sessions created after saving. Do not invoke agent_orchestrate recursively from subagents.'
  }));
  ctx.inject(['systemPrompt'],sub=>sub.systemPrompt.section({name:'tool:agent-model-router-handoff',order:sub.systemPrompt.getSectionOrder('TOOL_WORKFLOW'),text:'Before delegation, use agent_delegation_route with assessed scopeCount, risk, explicitRequest and needsIndependentCheck; pass the same assessment as delegation to agent_orchestrate. Single-scope work without independent-check needs stays with the root. Explicit user requests for multi-agent work may delegate. High-risk decisions and ambiguous plans belong to the root. Multiple scopes do not authorize parallel writes. For implementation, provide the root-approved plan in prior.rootPlan. Phase handoffs contain role-relevant excerpts plus absolute paths to full JSON reports; read original reports and changed files as needed, never assume an excerpt is complete. Keep user constraints, exact failures, unresolved questions and evidence locations. Missing evidence or decisions require blocked/needs_decision.'}));
  ctx.effect(()=>()=>{for(const handle of handles)if(typeof handle==='function')handle();},'agent-model-router tools');
  return service;
}
