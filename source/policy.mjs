import {prepareWorkerPaths} from './paths.mjs';

const STAGES={explorer:'explore',worker:'implement',tester:'test',researcher:'research',reviewer:'review',visioner:'vision',scribe:'scribe'};
const ROLES=Object.fromEntries(Object.entries(STAGES).map(([role,stage])=>[stage,role]));
const DELEGATION=new Set(['agent_orchestrate','agent_delegate','agent_delegation_route','subagent','subagent_fork','workflow','spawn_teammate','send_message']);
const WRITE=new Set(['write','edit','write_file','edit_file','apply_patch']);
const SHELL=new Set(['pwsh','bash','shell','exec_command','run_command']);
const READ=new Set(['read','read_file','glob','grep','list_directory','view_image','read_image','image_read','structured_output']);
const WEB=new Set(['web','web_search','web_fetch']);
const header=exec=>exec.agent?.session?.header;
const isChild=h=>Boolean(h?.parentSession||h?.origin==='subagent'||h?.delegationDepth>0);
const target=args=>args?.file_path??args?.path??args?.file;
const command=args=>args?.command??args?.script;
const failure=message=>({isError:true,error:{message},content:[{type:'text',text:message}]});
// A root grant is task-scoped, not one-shot: it stays valid for consecutive
// operations in the same workspace so the assessment is not re-requested for
// every command. The TTL and use cap keep one assessment from silently
// becoming a permanent blanket permit for unrelated later work.
const GRANT_TTL_MS=15*60*1000,GRANT_MAX_USES=50;
// An explicit useNativeTool assessment covers one task's worth of native calls:
// a user-approved parallel fan-out dispatches many subagent calls from a single
// decision. Like root grants, a short TTL and use cap keep the exemption from
// silently becoming a permanent blanket bypass of the interception.
const NATIVE_EXEMPTION_TTL_MS=10*60*1000,NATIVE_EXEMPTION_MAX_USES=32;
// An explicit provider/model (or reasoning effort) on a native call is a route
// the plugin cannot express: agent_delegate/agent_orchestrate route by saved
// role mapping only, so the redirect must point at the native exemption path.
const explicitRoute=args=>Boolean(args?.provider||args?.model||args?.reasoning_effort||args?.reasoningEffort);
const scopeKey=cwd=>{let value=String(cwd??'').replace(/\\/g,'/').replace(/\/+$/,'');if(process.platform==='win32')value=value.toLowerCase();return value;};
// Only clearly read-only inspection commands skip the root grant. Anything with
// chaining, redirection or substitution, or an unrecognized head, still needs one.
// The version probe is limited to known toolchains: matching any executable would
// leave destructive binaries such as `format.com -v` ungated.
const SHELL_UNSAFE=/[<>;|&`\r\n]|\$\(/;
const SHELL_VERSION=/^(?:node|npm|npx|pnpm|yarn|bun|deno|python|python3|py|pip|pip3|java|javac|go|rustc|cargo|dotnet|git|ruby|php|gcc|g\+\+|clang|cmake|docker|pwsh|powershell|bash|sh)\s+(?:--version|-v|-version)$/i;
const SHELL_INSPECT=/^(?:git\s+(?:status|diff|log|show|branch|remote|rev-parse)|(?:Get-ChildItem|Get-Content|Get-Item|Get-Location|Test-Path|Select-String|Get-Command|Resolve-Path)|(?:ls|dir|pwd|cat|type|head|tail|where|which|findstr))\b/i;
const isInspection=requested=>{const text=String(requested??'').trim();if(!text||SHELL_UNSAFE.test(text))return false;return SHELL_INSPECT.test(text)||SHELL_VERSION.test(text);};

// Inspect the calling session's actual definition, not a cached host version.
// Activation receipts must belong to a real managed activation. A synchronous
// workflow result cannot be relabelled with a made-up subagentId.
function nativeContract(schema){
 const variants=Array.isArray(schema?.oneOf)?schema.oneOf:[schema];
 if(variants.some(s=>s?.properties?.kind?.const==='activation'&&s.properties.subagentId?.type==='string'))return 'activation';
 if(variants.some(s=>s?.properties?.kind?.const==='foreground'&&s.properties.runId?.type==='string'&&s.properties.output?.type==='array'))return 'foreground';
 return 'unknown';
}

// Only explicit role words in the manager's short description are considered.
// An ambiguous request is rejected with the explicit helper, not silently routed.
function inferRole(description=''){
 if(/implement|modify|edit|fix|实现|修改|修复/i.test(description))return 'worker';
 if(/test|verify|validation|测试|验证/i.test(description))return 'tester';
 if(/review|audit|审查|审计/i.test(description))return 'reviewer';
 if(/vision|image|screenshot|ocr|识图|图片/i.test(description))return 'visioner';
 if(/research|documentation|查证|文档核实/i.test(description))return 'researcher';
 if(/explor|inspect|locate|read|search|探索|检索|查找|读取|探测|探活|排查|巡检|盘点|梳理/i.test(description))return 'explorer';
 if(/scribe|format|document|笔记|整理|文案|文书|格式化|文档整理|状态报告|搬运/i.test(description))return 'scribe';
 return null;
}

export class RoutingPolicy{
 constructor({ctx,service}){
  Object.assign(this,{ctx,service});this.enabled=false;this.preExecuteObserved=false;this.active=new Map();this.children=new Map();this.checks=new Map();this.assessments=new Map();this.grants=new Map();
  this.available=typeof ctx.on==='function'&&typeof ctx.tools.guard==='function';
 }
 install(){
  if(!this.available)return [];
  const disposers=[
   this.ctx.on('tools/pre-execute',async(exec,next)=>{await this.beforeExecute(exec);return next();}),
   this.ctx.on('tools/execute',(exec,next)=>this.dispatch(exec,next)),
   this.ctx.tools.guard(exec=>this.guard(exec)),
   this.ctx.on('agent/created',payload=>this.created(payload.agent)),
   this.ctx.on('agent/disposed',payload=>{const agent=payload?.agent||payload;this.children.delete(agent?.session?.header?.id);this.assessments.delete(agent?.session?.header?.id);this.grants.delete(agent?.session?.header?.id);}),
   this.ctx.on('workflow/agent-start',(info,child)=>{
    if(info.meta?.name!=='agent-model-router')return;
    const actor=this.children.get(child.childId);if(!actor)return;
    const match=/#(\d+)$/.exec(child.label);
    if(match){actor.files=actor.contracts[Number(match[1])-1]?.files||[];actor.ready=true;}
   })
  ];
  return disposers.filter(d=>typeof d==='function');
 }
 recordAssessment(exec,decision,input){
  const id=header(exec)?.id;if(!id)return;
  this.assessments.set(id,{decision,input});
  // A 'root' decision grants task-scoped direct execution. Any other route
  // records the assessment but grants nothing, so guard() can report which
  // route was actually decided instead of a generic "not assessed" message.
  if(decision?.route==='root')this.grants.set(id,{scope:scopeKey(header(exec)?.cwd),createdAt:Date.now(),uses:0});
  else this.grants.delete(id);
 }
 async beforeExecute(exec){
  this.preExecuteObserved=true;
  this.enabled=(await this.service.store.read()).enabled===true;
  const actor=this.children.get(header(exec)?.id);
  let denial;
  if(actor?.role==='worker'&&WRITE.has(exec.name)){
   try{
    if(!actor.ready)throw Error('等待宿主关联子代理的文件归属');
    const file=target(exec.arguments);if(!file)throw Error('写工具必须有明确文件路径；请使用 write/edit');
    const prepared=await prepareWorkerPaths({workspace:header(exec).cwd,workTasks:[{files:[file]}]});
    const canonical=prepared.workTasks[0].files[0];
    const same=file=>process.platform==='win32'?file.toLowerCase()===canonical.toLowerCase():file===canonical;
    if(!actor.files.some(same))throw Error('该文件不属于此 Worker 的归属范围 (unowned path)');
   }catch(error){denial=String(error.message||error);}
  }
  if(this.checks.size>2048)this.checks.clear();
  if(exec.callId)this.checks.set(exec.callId,{denial,actorId:header(exec)?.id});
 }
 guard(exec){
  const h=header(exec),actor=this.children.get(h?.id),args=exec.arguments||{};
  if(!actor&&this.active.has(h?.parentSession))return '宿主尚未关联该子代理的角色生命周期，拒绝执行工具。';
  if(actor){
   if(DELEGATION.has(exec.name)||/^team_|^spawn_/.test(exec.name))return '禁止子代理嵌套委派；将问题交回根代理。';
   const checked=exec.callId?this.checks.get(exec.callId):null;
   if(checked?.denial)return checked.denial;
   if(READ.has(exec.name))return;
   if(actor.role==='researcher'&&WEB.has(exec.name))return;
   if(actor.role==='worker'){
    if(WRITE.has(exec.name)){
     if(!exec.callId||!checked||checked.actorId!==h.id)return '尚未校验 Worker 文件归属，拒绝写入。';
     return;
    }
    return 'Worker 只允许归属文件的 read/write/edit；shell 命令和其他副作用工具不允许，请交给 tester 或根代理。';
   }
   if(actor.role==='tester'&&SHELL.has(exec.name)){
    const requested=command(args);
    if(!actor.readOnlyApplied||!actor.commands.includes(requested))return '只读 tester 仅允许根明确列出的完整测试命令 (testCommands)。';
    // Native pwsh requires description and uses timeoutMs. These control only
    // presentation/deadlines; execution scope and privilege overrides stay denied.
    const allowed=new Set(['command','script','description','timeout','timeoutMs','timeout_ms','max_output_tokens','yield_time_ms']);
    if(Object.keys(args).some(key=>!allowed.has(key)))return '只读测试命令不能覆盖沙箱、工作区、环境或权限。';
    const policy=this.ctx.get?.('sandboxPolicy')||this.ctx.sandboxPolicy;
    if(policy?.resolve?.({session:exec.agent.session})?.mode!=='read-only')return '宿主没有确认 read-only 沙箱，拒绝执行测试命令。';
    return;
   }
   return '此角色为只读 (read-only)，不允许写入、任意 shell 或未授权工具。';
  }
  if(isChild(h)&&['agent_orchestrate','agent_delegate'].includes(exec.name))return '禁止嵌套编排；请返回根代理。';
  if(this.enabled&&!isChild(h)&&(WRITE.has(exec.name)||SHELL.has(exec.name))){
   // Read-only inspection commands are not gated: information gathering is the
   // most frequent root operation and does not need a delegation decision.
   if(SHELL.has(exec.name)&&isInspection(command(exec.arguments)))return;
   const assessment=this.assessments.get(h?.id),grant=this.grants.get(h?.id);
   if(!assessment)return '执行前请用 agent_delegation_route 评估，或直接用 agent_delegate 按角色委派；当前没有根直接执行的评估。';
   if(assessment.decision?.route!=='root')return 'agent_delegation_route 的评估结果为 delegate：请用 agent_delegate 委派该有界任务；本次根直接执行未获授权。';
   if(!grant)return '根直接执行授权不可用（评估未授予或已因工作区变更失效），请重新调用 agent_delegation_route 后再执行。';
   if(scopeKey(h?.cwd)!==grant.scope){this.grants.delete(h?.id);return '工作区已变更，原根执行授权失效；请针对当前工作区重新调用 agent_delegation_route。';}
   if(Date.now()-grant.createdAt>GRANT_TTL_MS){this.grants.delete(h?.id);return '根执行授权已超过 '+Math.round(GRANT_TTL_MS/60000)+' 分钟有效期，请重新调用 agent_delegation_route。';}
   if(grant.uses>=GRANT_MAX_USES){this.grants.delete(h?.id);return '根执行授权已用满 '+GRANT_MAX_USES+' 次，请重新调用 agent_delegation_route。';}
   grant.uses++;
  }
 }
 created(agent){
  const h=agent?.session?.header,parent=this.active.get(h?.parentSession);
  if(!parent)return;
  const actor={...parent,files:parent.contracts.length===1?(parent.contracts[0]?.files||[]):[],ready:parent.contracts.length<=1,readOnlyApplied:false};
  this.children.set(h.id,actor);
  if(actor.role!=='worker'){
   if(typeof agent.session.append!=='function')throw Error('宿主缺少 Session.append，无法设置角色只读沙箱');
   agent.session.append('sandbox/mode',{mode:'read-only',source:'delegation'});actor.readOnlyApplied=true;
  }
 }
 assertPlanCapabilities(request,exec){
  if(!this.available)throw Error('HOST_INCOMPATIBLE: 宿主缺少 tools.guard 或 tools/execute，无法保证角色边界');
  const plan=request.args.plan;
  if(plan.includes('implement')&&!this.preExecuteObserved)throw Error('HOST_INCOMPATIBLE: tools/pre-execute 预检查未触发，不能启动写阶段');
  const sandbox=this.ctx.get?.('sandboxPolicy')||this.ctx.sandboxPolicy;
  if(plan.includes('test')&&typeof sandbox?.resolve!=='function')throw Error('HOST_INCOMPATIBLE: 缺少 sandboxPolicy，不能验证只读测试沙箱');
  if(plan.some(stage=>stage!=='implement')&&typeof exec.agent?.session?.append!=='function')throw Error('HOST_INCOMPATIBLE: Session.append 不可用，不能建立只读沙箱');
 }
 async withStage(request,exec,run){
  this.assertPlanCapabilities(request,exec);
  const id=header(exec)?.id,stage=request.args.plan[0];
  if(this.active.has(id))throw Error('本主会话已有编排阶段运行，请等待该阶段完成');
  const record={role:ROLES[stage],contracts:request.args.workTasks||[],commands:request.args.testCommands||request.args.testTasks||[],executions:[]};
  this.active.set(id,record);
  try{
   const output=await run();
   if(stage==='test'&&output?.result?.verdict==='passed'){
    const missing=record.commands.filter(cmd=>!record.executions.some(e=>e.command===cmd&&e.success));
    if(!record.commands.length||missing.length){
     const message='测试命令缺少宿主成功执行证据，不能仅凭代理报告 passed：'+JSON.stringify(missing);
     output.result.verdict='blocked';output.result.canAccept=false;
     output.result.phaseStatus={...output.result.phaseStatus,test:{...output.result.phaseStatus?.test,executed:true,passed:false,blocked:true}};
     output.result.phases={...output.result.phases,test:{...output.result.phases?.test,status:'blocked',summary:message,hostExecutions:record.executions}};
     output.result.validationErrors=[...(output.result.validationErrors||[]),message];
    }
   }
   return output;
  }finally{if(this.active.get(id)===record)this.active.delete(id);}
 }
 async delegate(args,exec){
  if(!Object.hasOwn(STAGES,args.role))throw Error('请选择明确的七角色之一');
  const stage=STAGES[args.role],task=args.task;
  const request={task,plan:[stage],constraints:args.constraints,acceptanceCriteria:args.acceptanceCriteria,operationId:args.operationId,visionInputs:args.visionInputs};
  for(const key of Object.keys(request))if(request[key]===undefined)delete request[key];
  if(args.role==='worker'){
   if(!Array.isArray(args.files)||!args.files.length)throw Error('实现委派必须提供明确 files；用 agent_delegate 指定归属文件');
   request.prior={rootPlan:{approvedBy:'calling-root-agent',objective:task,files:args.files}};
   request.workTasks=[{objective:task,files:args.files}];
  }
  if(args.role==='tester'){
   if(!Array.isArray(args.commands)||!args.commands.length)throw Error('验证委派必须提供根确认的完整 commands');
   request.testCommands=args.commands;request.testTasks=args.commands;
  }
  return this.service.execute(request,exec);
 }
 async dispatch(exec,next){
  try{
   const actor=this.children.get(header(exec)?.id);
   if(actor?.role==='tester'&&SHELL.has(exec.name)){
    const result=await next(),value=result?.value;
    actor.executions.push({command:command(exec.arguments),success:result?.isError===false&&value?.kind==='foreground'&&value.exitCode===0&&!value.timedOut&&!value.aborted&&!value.sandbox?.denied,
     exitCode:value?.exitCode??null,isError:result?.isError!==false});
    return result;
   }
   const enabled=(await this.service.store.read()).enabled===true;
   if(!enabled||isChild(header(exec)))return next();
   if(['subagent','subagent_fork'].includes(exec.name)){
    if(this.assessments.get(header(exec)?.id)?.input.useNativeTool===true){
     const state=(this.assessments.get(header(exec)?.id).exemption??={createdAt:Date.now(),uses:0});
     if(Date.now()-state.createdAt<=NATIVE_EXEMPTION_TTL_MS&&state.uses<NATIVE_EXEMPTION_MAX_USES){state.uses++;return next();}
     // Exhausted or expired: drop the stale exemption and fall through to interception.
     this.assessments.delete(header(exec).id);
    }
    const args=exec.arguments||{},role=inferRole(args.description);
    const exemptionPath='请直接调用 agent_delegation_route(useNativeTool:true) 记录原生语义豁免，再以相同参数重试：豁免自记录起 '+Math.round(NATIVE_EXEMPTION_TTL_MS/60000)+' 分钟内最多覆盖 '+NATIVE_EXEMPTION_MAX_USES+' 次原生调用，足以覆盖一次并行扇出。不得把此返回视为任务完成。';
    if(!role){
     if(explicitRoute(args))return failure('委派角色不明确，且本次调用显式指定了 provider/model——agent_delegate 与 agent_orchestrate 只能按已保存的角色映射路由，无法表达指定通道/指定模型。本次未启动任何子代理。'+exemptionPath);
     return failure('委派角色不明确，本次未启动任何子代理。请改用 agent_delegate 显式指定：role 七选一（explorer=探索/检索/读代码，worker=按 files 实现，tester=按 commands 验证，researcher=查证/文档，reviewer=审查，visioner=识图，scribe=文书/格式化/整理），task 为完整任务描述；worker 必须另给精确 files，tester 必须另给完整 commands。示例：agent_delegate({role:"explorer",task:"阅读 package.json 并汇总依赖"})。多阶段任务用 agent_orchestrate({task:"...",plan:["explore"]})；多个互相独立的探测/检查任务请逐个分别调用 agent_delegate(role:"explorer")。以相同参数重试原生 subagent 会继续失败；确需原生语义时先调用 agent_delegation_route(useNativeTool:true)。');
    }
    const contract=nativeContract(this.ctx.tools.get?.(exec.name,exec.agent)?.output?.schema);
    if(contract!=='foreground'){
     const prefix=contract==='activation'?'当前宿主原生委派使用异步 activation/subagentId 生命周期。':'无法确认当前原生委派的输出契约。';
     if(explicitRoute(args))return failure(prefix+'本次调用显式指定了 provider/model——agent_delegate 与 agent_orchestrate 只能按已保存的角色映射路由，无法表达指定通道/指定模型，本次未启动子代理或执行任务。'+exemptionPath);
     return failure(prefix+'本次未启动子代理或执行任务；请现在调用 agent_delegate，role="'+role+'"，task 使用原 prompt，并保留原任务约束；worker 必须补充精确 files，tester 必须补充完整 commands。不得把此返回视为任务完成。需要多阶段交接时使用 agent_orchestrate。');
    }
    const output=await this.delegate({role,task:args.prompt},exec);
    if(output.runId==null)return failure(JSON.stringify(output));
    return {isError:false,value:{kind:'foreground',runId:output.runId,output:[{type:'text',text:JSON.stringify(output)}]},content:[]};
   }
   if(exec.name==='workflow')return failure('多代理模式开启时请使用 agent_orchestrate；它会应用角色映射、完整预检与恢复账本。示例：agent_orchestrate({task:"...",plan:["explore"]})；缺省 plan 且无 prior.rootPlan 时按 ["explore"] 执行。单步有界委派用 agent_delegate({role:"explorer",task:"..."})。');
   // The grant is deliberately not consumed here. It is task-scoped and expires
   // by TTL, use cap or workspace change; consuming it on the very call it
   // authorized forced a fresh assessment before every single command.
   return next();
  }catch(error){return failure(String(error.message||error));}
  finally{if(exec.callId)this.checks.delete(exec.callId);}
 }
}
