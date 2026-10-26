import {assessDelegation} from './delegation.mjs';
import {createRequire} from 'node:module';
import {prepareWorkerPaths} from './paths.mjs';
const {validatePlan}=createRequire(import.meta.url)('../engine/engine.cjs');
const STAGES={explore:'explorer',research:'researcher',implement:'worker',test:'tester',review:'reviewer',vision:'visioner'};
const ROLE_NAMES=['explorer','worker','tester','researcher','reviewer','visioner'];
// The candidate set for a role is the calling harness's own model catalogue.
// No plugin-owned provider whitelist is applied: whichever adapters the host has
// mounted advertise their models, and the page offers exactly those routes.
// Listing is advisory, not a success guarantee: an adapter can still reject a
// call for its own configuration, credential or quota reasons at request time.
const routeOf=(provider,row)=>{
  const route={provider:provider.id,model:row.id,name:row.name,providerName:provider.name||provider.id};
  if(typeof row.description==='string'&&row.description)route.description=row.description;
  if(Array.isArray(row.inputModalities))route.inputModalities=[...row.inputModalities];
  return route;
};
const needsVision=args=>(Array.isArray(args?.capabilities)&&args.capabilities.includes('vision'))||(Array.isArray(args?.visionInputs)&&args.visionInputs.length>0);
const withAutoVision=(plan,args)=>Array.isArray(plan)&&needsVision(args)&&!plan.includes('vision')?['vision',...plan]:plan;
const key=r=>JSON.stringify([r.provider,r.model??r.id]);
const copy=v=>structuredClone(v);
function unavailable(message){return Object.assign(new Error(message),{status:422,code:'MODEL_UNAVAILABLE'});}

export class RouterService {
  constructor({llm,store,engine,script,runWorkflow,diagnostics}){Object.assign(this,{llm,store,engine,script,runWorkflow,diagnostics});}
  async catalogue(){
    if(typeof this.llm?.listProviders!=='function'||typeof this.llm?.listModels!=='function')throw Error('宿主模型目录接口不可用');
    const registered=await this.llm.listProviders();
    if(!Array.isArray(registered)||!registered.length)throw Error('宿主未注册任何模型通道；请先在 DSH 中启用或配置模型');
    const providers=registered.filter(provider=>provider&&typeof provider.id==='string'&&provider.id);
    if(!providers.length)throw Error('宿主返回了无效的模型通道目录');
    const groups=await Promise.allSettled(providers.map(async provider=>{
      const rows=await this.llm.listModels(provider.id);
      if(!Array.isArray(rows)||rows.some(row=>row?.provider!==provider.id||typeof row.id!=='string'||!row.id||typeof row.name!=='string'))throw Error('宿主返回了无效模型目录');
      return rows.filter(row=>row.enabled!==false&&row.disabled!==true&&row.isEnabled!==false).map(row=>routeOf(provider,row));
    }));
    const seen=new Set(),models=[],errors={};
    for(const [index,result] of groups.entries()){
      if(result.status==='rejected'){errors[providers[index].id]=String(result.reason?.message||result.reason);continue;}
      for(const route of result.value){const id=key(route);if(!seen.has(id)){seen.add(id);models.push(route);}}
    }
    return {ok:groups.some(r=>r.status==='fulfilled'),partial:Object.keys(errors).length>0,errors,checkedAt:Date.now(),models};
  }
  async view(){
    const settings=await this.store.read();let catalogue;
    try{catalogue=await this.catalogue();}catch(e){catalogue={ok:false,models:[],error:e.message,checkedAt:Date.now()};}
    const enabled=new Set(catalogue.models.map(key));
    return {settings,catalogue,availability:Object.fromEntries(ROLE_NAMES.map(role=>[role,enabled.has(key(settings.roles[role]))])),scope:'global',appliesTo:'new_sessions',...(this.diagnostics?{runtime:this.diagnostics.status()}:{})};
  }
  async save({roles,expectedVersion}){
    const catalogue=await this.catalogue(),enabled=new Set(catalogue.models.map(key));
    for(const role of ROLE_NAMES)if(!roles?.[role]||!enabled.has(key(roles[role])))throw unavailable(role+' 的模型不在宿主当前模型目录中（可能已停用、被移除或通道不可用），请重新选择');
    return this.store.save(roles,expectedVersion);
  }
  async setEnabled({enabled,expectedVersion}){
    if(typeof enabled!=='boolean')throw Error('enabled 必须为布尔值');
    return this.store.saveEnabled(enabled,expectedVersion);
  }
  async forAgent(agent){
    const header=agent?.session?.header;
    if(!header || typeof header.id!=='string'||!Number.isSafeInteger(header.createdAt)||header.createdAt<=0)throw Error('无法确认主会话创建时间，不能套用新配置');
    return this.store.forSession(header.id,header.createdAt);
  }
  async execute(args,exec){
    if(!args||typeof args.task!=='string'||!args.task.trim())throw Error('task 必须非空');
    if(this.diagnostics?.status().reloadRequired)throw Error('插件源码与已加载构建不同，请重新加载本插件 (reload) 后再启动新编排；仅新建会话无效');
    if(Object.hasOwn(args,'roles'))throw Error('不得通过 roles 覆盖界面已保存的模型');
    if(Object.hasOwn(args,'workspace'))throw Error('不得覆盖调用会话的 workspace 工作区');
    if(!exec?.agent)throw Error('编排工具必须由当前会话代理调用');
    const header=exec.agent.session?.header;
    if(header?.parentSession||header?.origin==='subagent'||header?.delegationDepth>0)throw Error('禁止子代理嵌套编排；请返回根代理处理');
    if((await this.store.read()).enabled!==true)throw Error('多代理模式已关闭，请在左侧“代理模型”开启后再调用');
    if(args.delegation){
      const decision=assessDelegation(args.delegation);
      if(decision.route==='root')return {runId:null,agentsStarted:0,routingDecision:decision,result:{verdict:'root_required',canAccept:false,taskComplete:false,summary:'请由根代理直接处理本任务，不启动子代理。'}};
    }
    const snapshot=copy(await this.forAgent(exec.agent));
    const plan=withAutoVision(args.plan===undefined?(args.prior?.rootPlan?['implement','test','review']:['explore']):args.plan,args);
    if(!Array.isArray(plan)||!plan.length||plan.some(s=>!Object.hasOwn(STAGES,s)))throw Error('plan 必须为非空合法阶段数组');
    let prepared={...args,plan,roles:snapshot.roles};
    if(plan.includes('test')){
      const commands=prepared.testCommands===undefined?prepared.testTasks:prepared.testCommands;
      if(!Array.isArray(commands)||!commands.length||commands.some(command=>typeof command!=='string'||!command.trim()))throw Error('测试阶段需要根明确提供非空 testCommands（或 testTasks 完整命令清单）；整份计划尚未启动');
      prepared.testCommands=copy(commands);
      if(prepared.testTasks===undefined)prepared.testTasks=copy(commands);
    }
    const workspace=exec.agent.session?.header?.cwd;
    if(workspace)prepared.workspace=workspace;
    else if(args.workTasks?.some(task=>task?.files?.length))throw Error('无法确认调用会话工作区，不能分配文件归属');
    const checked=validatePlan(prepared);
    if(checked.errors.length)throw Error(checked.errors.join('; '));
    if(plan.includes('implement')){
      if(prepared.workTasks===undefined&&Array.isArray(args.prior?.rootPlan?.files))prepared.workTasks=[{objective:args.task,files:args.prior.rootPlan.files}];
      if(!Array.isArray(prepared.workTasks)||!prepared.workTasks.length||prepared.workTasks.some(task=>!Array.isArray(task?.files)||!task.files.length))throw Error('实现需要明确 workTasks[].files；可用 agent_delegate 一步提供文件归属');
      if(!workspace)throw Error('无法确认调用会话工作区，不能启动实现');
    }
    prepared=await prepareWorkerPaths(prepared);
    const physical=validatePlan(prepared);
    if(physical.errors.length)throw Error(physical.errors.join('; '));
    const catalogue=await this.catalogue(),enabled=new Set(catalogue.models.map(key));
    for(const stage of plan){const role=STAGES[stage];if(!enabled.has(key(snapshot.roles[role])))throw unavailable(role+' 的会话模型已不在可用模型目录中（停用或不可用）；旧会话不会自动换模型，请重新选择并开启新会话');}
    if((await this.store.read()).enabled!==true)throw Error('多代理模式已关闭，本次编排未启动');
    exec.signal?.throwIfAborted();
    if(this.runWorkflow){
      const result=await this.runWorkflow({script:this.script,meta:{name:'agent-model-router',description:'按已保存角色映射执行有界多代理任务'},args:prepared},exec);
      if(result.kind!=='foreground')throw Error('编排未返回前台执行结果');
      return {runId:result.runId==null?null:String(result.runId),agentsStarted:result.agentsStarted,routingVersion:snapshot.version,roles:snapshot.roles,result:result.result};
    }
    const run=this.engine.start({script:this.script,meta:{name:'agent-model-router',description:'按已保存角色映射执行有界多代理任务'},args:prepared,parent:exec.agent,...exec.signal?{signal:exec.signal}:{}});
    const abort=()=>run.cancel('calling session aborted');exec.signal?.addEventListener('abort',abort,{once:true});
    try{
      const result=await run.result;
      if(result.stopReason!=='completed')throw Error(result.error||'工作流未正常完成：'+result.stopReason);
      return {runId:String(run.id),agentsStarted:result.agentsStarted,routingVersion:snapshot.version,roles:snapshot.roles,result:result.value};
    }finally{exec.signal?.removeEventListener('abort',abort);await run.dispose();}
  }
}
