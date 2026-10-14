export const OWNED_PROVIDERS=new Set(['our-free-model','our-free-model-region','codearts','codebuddy','workbuddy','lobsterai','qoder','qodercn','trae','cline','loomy','raccoon','minimax','zcode','gemini']);
const STAGES={explore:'explorer',research:'researcher',implement:'worker',test:'tester',review:'reviewer'};
const ROLE_NAMES=['explorer','worker','tester','researcher','reviewer'];
const key=r=>JSON.stringify([r.provider,r.model??r.id]);
const copy=v=>structuredClone(v);
function unavailable(message){return Object.assign(new Error(message),{status:422,code:'MODEL_UNAVAILABLE'});}

export class RouterService {
  constructor({llm,store,engine,script,runWorkflow}){Object.assign(this,{llm,store,engine,script,runWorkflow});}
  async catalogue(){
    if(typeof this.llm?.listProviders!=='function'||typeof this.llm?.listModels!=='function')throw Error('宿主模型目录接口不可用');
    const providers=(await this.llm.listProviders()).filter(p=>OWNED_PROVIDERS.has(p.id));
    if(!providers.length)throw Error('请先启用 dsh-our-free-model 及所需通道');
    const groups=await Promise.all(providers.map(async p=>({provider:p.id,name:p.name,models:await this.llm.listModels(p.id)})));
    const seen=new Set(),models=[];
    for(const group of groups)for(const row of group.models){
      if(row.provider!==group.provider||typeof row.id!=='string'||!row.id||typeof row.name!=='string')throw Error('宿主返回了无效模型目录');
      if(row.enabled===false||row.disabled===true||row.isEnabled===false)continue;
      const route={provider:row.provider,model:row.id,name:row.name,providerName:group.name};
      const id=key(route);if(!seen.has(id)){seen.add(id);models.push(route);}
    }
    return {ok:true,checkedAt:Date.now(),models};
  }
  async view(){
    const settings=await this.store.read();let catalogue;
    try{catalogue=await this.catalogue();}catch(e){catalogue={ok:false,models:[],error:e.message,checkedAt:Date.now()};}
    const enabled=new Set(catalogue.models.map(key));
    return {settings,catalogue,availability:Object.fromEntries(ROLE_NAMES.map(role=>[role,enabled.has(key(settings.roles[role]))])),scope:'global',appliesTo:'new_sessions'};
  }
  async save({roles,expectedVersion}){
    const catalogue=await this.catalogue(),enabled=new Set(catalogue.models.map(key));
    for(const role of ROLE_NAMES)if(!roles?.[role]||!enabled.has(key(roles[role])))throw unavailable(role+' 的模型已停用或不可用，请重新选择');
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
    if(Object.hasOwn(args,'roles'))throw Error('不得通过 roles 覆盖界面已保存的模型');
    if(!exec?.agent)throw Error('编排工具必须由当前会话代理调用');
    if((await this.store.read()).enabled!==true)throw Error('多代理模式已关闭，请在左侧“代理模型”开启后再调用');
    const snapshot=copy(await this.forAgent(exec.agent));
    const plan=args.plan===undefined?['explore','implement','test','review']:args.plan;
    if(!Array.isArray(plan)||!plan.length||plan.some(s=>!STAGES[s]))throw Error('plan 必须为非空合法阶段数组');
    const catalogue=await this.catalogue(),enabled=new Set(catalogue.models.map(key));
    for(const stage of plan){const role=STAGES[stage];if(!enabled.has(key(snapshot.roles[role])))throw unavailable(role+' 的会话模型已停用或不可用；旧会话不会自动换模型，请重新选择并开启新会话');}
    if((await this.store.read()).enabled!==true)throw Error('多代理模式已关闭，本次编排未启动');
    exec.signal?.throwIfAborted();
    if(this.runWorkflow){
      const result=await this.runWorkflow({script:this.script,meta:{name:'agent-model-router',description:'按已保存角色映射执行有界多代理任务'},args:{...args,plan,roles:snapshot.roles}},exec);
      if(result.kind!=='foreground')throw Error('编排未返回前台执行结果');
      return {runId:String(result.runId),agentsStarted:result.agentsStarted,routingVersion:snapshot.version,roles:snapshot.roles,result:result.result};
    }
    const run=this.engine.start({script:this.script,meta:{name:'agent-model-router',description:'按已保存角色映射执行有界多代理任务'},args:{...args,plan,roles:snapshot.roles},parent:exec.agent,...exec.signal?{signal:exec.signal}:{}});
    const abort=()=>run.cancel('calling session aborted');exec.signal?.addEventListener('abort',abort,{once:true});
    try{
      const result=await run.result;
      if(result.stopReason!=='completed')throw Error(result.error||'工作流未正常完成：'+result.stopReason);
      return {runId:String(run.id),agentsStarted:result.agentsStarted,routingVersion:snapshot.version,roles:snapshot.roles,result:result.value};
    }finally{exec.signal?.removeEventListener('abort',abort);await run.dispose();}
  }
}
