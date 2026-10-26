import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {apply} from '../index.js';

const legacyNativeSchema={type:'object',properties:{kind:{type:'string',const:'foreground'},runId:{type:'string'},output:{type:'array',items:{type:'object',additionalProperties:true}}}};
const activationSchema={type:'object',additionalProperties:false,properties:{kind:{type:'string',required:true,const:'activation'},subagentId:{type:'string',required:true}}};

const roles=Object.fromEntries(['explorer','worker','tester','researcher','reviewer','visioner'].map(r=>[r,{provider:'trae',model:r+'-model'}]));
function fixture(){
 const events=new Map(),definitions=new Map(),guards=[],requests=[];
 const root={session:{header:{id:'policy-root',createdAt:1,cwd:process.cwd()},append:()=>{}}};
 const ctx={llm:{listProviders:async()=>[{id:'trae'}],listModels:async()=>Object.values(roles).map(r=>({provider:r.provider,id:r.model,name:r.model}))},
  tools:{register:d=>{definitions.set(d.name,d);return()=>{};},get:()=>({execute:async req=>{requests.push(req);const stage=req.args.plan[0];return {kind:'foreground',runId:'native-run',agentsStarted:1,result:{verdict:'passed',phases:{[stage]:{status:'done',summary:'read'}}}};}}),guard:fn=>{guards.push(fn);return()=>{};}},
  on:(name,fn)=>{events.set(name,fn);return()=>{};},inject:(deps,fn)=>{if(deps.every(d=>ctx[d]!==undefined))fn(ctx);},effect:fn=>fn(),
  systemPrompt:{section:()=>()=>{},getSectionOrder:()=>1}};
 const service=apply(ctx,{stateFile:'unused-policy-fixture.json',handoffDirectory:'artifacts/policy-fixture'});
 service.store.read=async()=>({enabled:true,version:1,roles});service.store.forSession=async()=>({version:1,roles});
 // Native execution is still exercised by the real RouterService; only disk/model
 // boundaries are replaced in this fixture.
 const nativeRunWorkflow=service.runWorkflow;
 service.runWorkflow=async req=>{requests.push(req);return {kind:'foreground',runId:'native-run',agentsStarted:1,result:{verdict:'passed'}};};
 return {service,ctx,events,definitions,guards,requests,root,nativeRunWorkflow};
}

test('ordinary native subagent dispatch is automatically routed to saved role models',async()=>{
 const f=fixture();const wrapper=f.events.get('tools/execute');assert.equal(typeof wrapper,'function');
 const get=f.ctx.tools.get;f.ctx.tools.get=(name,...args)=>name==='subagent'?{output:{schema:legacyNativeSchema}}:get(name,...args);
 let native=false;
 const result=await wrapper({name:'subagent',callId:'c1',agent:f.root,arguments:{description:'Explore repository',prompt:'Read package.json only',provider:'wrong',model:'wrong'}},async()=>{native=true;});
 assert.equal(native,false);assert.equal(result.isError,false);assert.equal(result.value.kind,'foreground');
 assert.equal(f.requests[0].args.roles.explorer.model,'explorer-model');assert.deepEqual(f.requests[0].args.plan,['explore']);
});

test('activation delegation redirects to the explicit helper before starting any role work',async()=>{
 for(const name of ['subagent','subagent_fork']){
  const f=fixture();f.ctx.tools.get=()=>({output:{schema:activationSchema}});
  let nativeCalls=0;
  const result=await f.events.get('tools/execute')({name,agent:f.root,arguments:{description:'Explore package',prompt:'Read package.json'}},async()=>{nativeCalls++;});
  assert.equal(result.isError,true);assert.match(result.error.message,/agent_delegate/);
  assert.match(result.error.message,/explorer/);assert.match(result.error.message,/未启动/);
  assert.equal(f.requests.length,0);assert.equal(nativeCalls,0);
  assert.equal(result.value,undefined);
 }
});

test('unrecognized native output contracts cannot launch work before discovering incompatibility',async()=>{
 for(const definition of [undefined,{output:{schema:{type:'object',additionalProperties:true}}}]){
  const f=fixture();f.ctx.tools.get=()=>definition;
  const result=await f.events.get('tools/execute')({name:'subagent',agent:f.root,arguments:{description:'Explore',prompt:'Read'}},()=>{throw Error('unexpected native launch');});
  assert.equal(result.isError,true);assert.match(result.error.message,/agent_delegate/);assert.equal(f.requests.length,0);
 }
});

test('following an activation redirect executes the explicit helper once with the saved role route',async()=>{
 const f=fixture();f.ctx.tools.get=()=>({output:{schema:activationSchema}});
 const task='Read package.json only',constraints=['No shell or writes'];
 const redirect=await f.events.get('tools/execute')({name:'subagent',agent:f.root,arguments:{description:'Explore package',prompt:task}},()=>{throw Error('unexpected native launch');});
 assert.equal(redirect.isError,true);assert.equal(f.requests.length,0);
 const result=await f.definitions.get('agent_delegate').execute({role:'explorer',task,constraints},{agent:f.root});
 assert.equal(result.runId,'native-run');assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].args.task,task);assert.deepEqual(f.requests[0].args.constraints,constraints);
 assert.equal(f.requests[0].args.roles.explorer.model,'explorer-model');
 assert.deepEqual(f.requests[0].args.plan,['explore']);
});

test('explicit native semantics keep the real activation id and host lifecycle untouched',async()=>{
 const f=fixture();f.ctx.tools.get=()=>({output:{schema:activationSchema}});
 f.service.policy.recordAssessment({agent:f.root},{route:'delegate'},{useNativeTool:true});
 const nativeResult={isError:false,value:{kind:'activation',subagentId:'real-host-child'},content:[]};let calls=0;
 const exec={name:'subagent',agent:f.root,arguments:{description:'Explore',prompt:'Read'}};
 assert.equal(await f.events.get('tools/execute')(exec,async()=>{calls++;return nativeResult;}),nativeResult);
 assert.equal(calls,1);assert.equal(f.requests.length,0);
 // The authorization covers the whole fan-out inside its window, not one dispatch.
 assert.equal(await f.events.get('tools/execute')(exec,async()=>{calls++;return nativeResult;}),nativeResult);
 assert.equal(calls,2);
});

test('one native authorization covers an explicitly requested parallel fan-out',async()=>{
 const f=fixture();f.ctx.tools.get=()=>({output:{schema:activationSchema}});
 f.service.policy.recordAssessment({agent:f.root},{route:'delegate'},{useNativeTool:true});
 let calls=0;
 const exec={name:'subagent',agent:f.root,arguments:{description:'Test channel availability',prompt:'Ping the model',provider:'trae',model:'kimi-k3'}};
 for(let i=0;i<9;i++){
  const result=await f.events.get('tools/execute')(exec,async()=>{calls++;return {isError:false,value:{kind:'activation',subagentId:'child-'+i},content:[]};});
  assert.equal(result.isError,false,'fan-out call '+i+' should pass through to the host');
 }
 assert.equal(calls,9);assert.equal(f.requests.length,0);
});

test('a native authorization stays bounded by its use cap and TTL',async()=>{
 for(const bound of ['cap','ttl']){
  const f=fixture();f.ctx.tools.get=()=>({output:{schema:activationSchema}});
  f.service.policy.recordAssessment({agent:f.root},{route:'delegate'},{useNativeTool:true});
  const assessment=f.service.policy.assessments.get(f.root.session.header.id);assert.ok(assessment);
  const exec={name:'subagent',agent:f.root,arguments:{description:'Explore',prompt:'Read'}};
  await f.events.get('tools/execute')(exec,async()=>({isError:false,value:{kind:'activation',subagentId:'c'},content:[]}));
  if(bound==='cap')assessment.exemption.uses=32;else assessment.exemption.createdAt=Date.now()-(11*60*1000);
  const blocked=await f.events.get('tools/execute')(exec,()=>{throw Error('authorization reused past its bound');});
  assert.equal(blocked.isError,true,bound+' should end the exemption');
  assert.equal(f.requests.length,0);
 }
});

test('activation redirect for explicit provider/model calls points to the native exemption path',async()=>{
 for(const name of ['subagent','subagent_fork']){
  const f=fixture();f.ctx.tools.get=()=>({output:{schema:activationSchema}});
  let nativeCalls=0;
  const result=await f.events.get('tools/execute')({name,agent:f.root,arguments:{description:'Test channel availability',prompt:'Ping glm-5.3',provider:'codearts',model:'glm-5.3'}},async()=>{nativeCalls++;});
  assert.equal(result.isError,true);assert.equal(nativeCalls,0);assert.equal(f.requests.length,0);
  assert.match(result.error.message,/useNativeTool/);
  assert.match(result.error.message,/provider\/model|指定通道|指定模型/);
  assert.doesNotMatch(result.error.message,/请现在调用 agent_delegate/,'explicit channel routes cannot be expressed by agent_delegate');
 }
});

test('ambiguous explicit-route calls are rejected with the native exemption path instead of a role list',async()=>{
 const f=fixture();f.ctx.tools.get=()=>({output:{schema:activationSchema}});
 const result=await f.events.get('tools/execute')({name:'subagent',agent:f.root,arguments:{description:'Handle it',prompt:'do the thing',provider:'trae',model:'kimi-k3'}},async()=>{throw Error('unexpected native launch');});
 assert.equal(result.isError,true);
 assert.match(result.error.message,/useNativeTool/);
 assert.match(result.error.message,/角色不明确/);
 assert.doesNotMatch(result.error.message,/请现在调用 agent_delegate/);
});

test('disabled mode leaves ordinary native subagent execution with the host',async()=>{
 const f=fixture();f.service.store.read=async()=>({enabled:false});const wrapper=f.events.get('tools/execute');assert.equal(typeof wrapper,'function');
 let native=false;await wrapper({name:'subagent',callId:'c2',agent:f.root,arguments:{description:'Explore',prompt:'read'}},async()=>{native=true;return {isError:false,value:{kind:'foreground',runId:'host',output:[]},content:[]};});
 assert.equal(native,true);assert.equal(f.requests.length,0);
});

test('ambiguous native subagent dispatch is rejected with a role list and a working example',async()=>{
 const f=fixture();f.ctx.tools.get=()=>({output:{schema:legacyNativeSchema}});
 let native=false;
 const result=await f.events.get('tools/execute')({name:'subagent',agent:f.root,arguments:{description:'Handle it',prompt:'do the thing'}},async()=>{native=true;});
 assert.equal(native,false);assert.equal(result.isError,true);assert.equal(f.requests.length,0);
 const message=result.error.message;
 for(const role of ['explorer','worker','tester','researcher','reviewer','visioner'])assert.match(message,new RegExp(role),'rejection must name role '+role);
 assert.match(message,/agent_delegate\(\{role:"explorer",task:/,'rejection must show a copyable agent_delegate example');
 assert.match(message,/agent_orchestrate\(\{task:/,'rejection must show a copyable agent_orchestrate example');
 assert.match(message,/重试|retry/i,'rejection must warn that repeating the same call keeps failing');
});

test('probe-style native subagent descriptions route to the explorer role',async()=>{
 for(const description of ['探测 codearts 通道可用性','探活 trae 模型','排查配置残留','巡检插件目录','盘点已启用通道','梳理依赖关系']){
  const f=fixture();f.ctx.tools.get=()=>({output:{schema:legacyNativeSchema}});
  const result=await f.events.get('tools/execute')({name:'subagent',agent:f.root,arguments:{description,prompt:'只读检查'}},async()=>{throw Error('unexpected native launch');});
  assert.equal(result.isError,false,description+' should delegate instead of failing');
  assert.equal(f.requests.length,1);assert.deepEqual(f.requests[0].args.plan,['explore']);
  assert.equal(f.requests[0].args.roles.explorer.model,'explorer-model');
 }
});

test('generic workflow interception names agent_orchestrate with a minimal example',async()=>{
 const f=fixture();
 const result=await f.events.get('tools/execute')({name:'workflow',agent:f.root,arguments:{script:'return 1'}},async()=>{throw Error('unexpected native launch');});
 assert.equal(result.isError,true);
 assert.match(result.error.message,/agent_orchestrate\(\{task:/,'rejection must show a minimal agent_orchestrate example');
 assert.match(result.error.message,/agent_delegate/,'rejection must name the one-step helper');
});

test('one-step delegation supplies the manager-approved worker contract',async()=>{
 const f=fixture();const delegate=f.definitions.get('agent_delegate');assert.ok(delegate);
 await delegate.execute({role:'worker',task:'Change only client.js',files:['client.js']},{agent:f.root});
 assert.deepEqual(f.requests[0].args.plan,['implement']);assert.ok(f.requests[0].args.prior.rootPlan);
 assert.deepEqual(f.requests[0].args.workTasks[0].files,[path.resolve('client.js')]);
});

test('read-only children receive a real sandbox event and cannot invoke write or shell tools',async()=>{
 const f=fixture();assert.ok(f.service.policy);
 const appended=[],child={session:{header:{id:'readonly-child',parentSession:'policy-root',origin:'subagent',delegationDepth:1,cwd:process.cwd()},append:(type,data)=>appended.push({type,data})}};
 await f.service.policy.withStage({args:{plan:['explore']}},{agent:f.root},async()=>{
  await f.events.get('agent/created')({agent:child});
  assert.ok(appended.some(e=>e.type==='sandbox/mode'&&e.data.mode==='read-only'));
  assert.match(f.service.policy.guard({name:'write',agent:child,arguments:{file_path:'client.js'}}),/只读|read.only/i);
  assert.match(f.service.policy.guard({name:'pwsh',agent:child,arguments:{command:'Remove-Item client.js'}}),/只读|read.only/i);
  assert.equal(f.service.policy.guard({name:'read',agent:child,arguments:{file_path:'package.json'}}),undefined);
  assert.match(f.service.policy.guard({name:'agent_orchestrate',agent:child,arguments:{task:'nested'}}),/嵌套|nested/i);
 });
});

test('managed workers cannot write unowned paths or execute an arbitrary shell',async()=>{
 const f=fixture();assert.ok(f.service.policy);
 const child={session:{header:{id:'worker-child',parentSession:'policy-root',origin:'subagent',cwd:process.cwd()},append:()=>{}}};
 await f.events.get('tools/pre-execute')({name:'agent_orchestrate',callId:'stage-admission',agent:f.root,arguments:{}},async()=>({kind:'allow'}));
 await f.service.policy.withStage({args:{plan:['implement'],workTasks:[{objective:'change client',files:[path.resolve('client.js')]}]}},{agent:f.root},async()=>{
  await f.events.get('agent/created')({agent:child});
  const execution={name:'write',callId:'w1',agent:child,arguments:{file_path:'README.md'}};
  await f.service.policy.beforeExecute(execution);assert.match(f.service.policy.guard(execution),/归属|owned|范围/i);
  const own={name:'write',callId:'w2',agent:child,arguments:{file_path:'client.js'}};
  await f.service.policy.beforeExecute(own);assert.equal(f.service.policy.guard(own),undefined);
  assert.match(f.service.policy.guard({name:'pwsh',agent:child,arguments:{command:'git reset --hard'}}),/shell|命令|允许/i);
 });
});

test('root mutations require an actual delegation assessment when mode is enabled',async()=>{
 const f=fixture();assert.ok(f.service.policy);
 const execution={name:'write',callId:'root-write',agent:f.root,arguments:{file_path:'client.js'}};
 await f.service.policy.beforeExecute(execution);assert.match(f.service.policy.guard(execution),/agent_delegation_route|agent_delegate/);
 await f.definitions.get('agent_delegation_route').execute({scopeCount:1,risk:'low',effort:'small',taskKind:'implementation',bounded:true},{agent:f.root});
 assert.equal(f.service.policy.guard(execution),undefined);
});

test('a root grant is reused across consecutive commands instead of one-shot',async()=>{
 const f=fixture();assert.ok(f.service.policy);
 await f.definitions.get('agent_delegation_route').execute({scopeCount:1,risk:'low',effort:'small',taskKind:'exploration',bounded:true},{agent:f.root});
 // One assessment must cover many successive operations in the same workspace.
 for(let i=0;i<12;i++){
  const execution={name:'write',callId:'reuse-'+i,agent:f.root,arguments:{file_path:'client.js'}};
  await f.service.policy.beforeExecute(execution);
  assert.equal(f.service.policy.guard(execution),undefined,'operation '+i+' should reuse the grant');
  await f.events.get('tools/execute')(execution,async()=>({isError:false,value:{},content:[]}));
 }
});

test('a grant is dropped when the root session changes workspace',async()=>{
 const f=fixture();assert.ok(f.service.policy);
 await f.definitions.get('agent_delegation_route').execute({scopeCount:1,risk:'low',effort:'small',taskKind:'exploration',bounded:true},{agent:f.root});
 const moved={session:{header:{...f.root.session.header,cwd:path.resolve('elsewhere')},append:()=>{}}};
 const execution={name:'write',callId:'moved',agent:moved,arguments:{file_path:'client.js'}};
 await f.service.policy.beforeExecute(execution);
 assert.match(f.service.policy.guard(execution),/工作区/);
});

test('an expired grant is rejected instead of permitting later unrelated work',async()=>{
 const f=fixture();assert.ok(f.service.policy);
 await f.definitions.get('agent_delegation_route').execute({scopeCount:1,risk:'low',effort:'small',taskKind:'exploration',bounded:true},{agent:f.root});
 const grant=f.service.policy.grants.get(f.root.session.header.id);assert.ok(grant,'grant should exist after a root assessment');
 grant.createdAt=Date.now()-(16*60*1000);
 const execution={name:'write',callId:'expired',agent:f.root,arguments:{file_path:'client.js'}};
 await f.service.policy.beforeExecute(execution);
 assert.match(f.service.policy.guard(execution),/有效期/);
});

test('a delegate-route assessment grants no direct execution and says so',async()=>{
 const f=fixture();assert.ok(f.service.policy);
 await f.definitions.get('agent_delegation_route').execute({scopeCount:2,risk:'low',effort:'substantial',taskKind:'implementation',bounded:true},{agent:f.root});
 const execution={name:'write',callId:'delegate-route',agent:f.root,arguments:{file_path:'client.js'}};
 await f.service.policy.beforeExecute(execution);
 const denial=f.service.policy.guard(execution);
 assert.match(denial,/delegate/);assert.match(denial,/agent_delegate/);
});

test('read-only inspection shell needs no grant while mutating shell still does',async()=>{
 const f=fixture();assert.ok(f.service.policy);
 for(const cmd of ['git status','git diff HEAD','Get-ChildItem -Force','node --version','Test-Path foo.txt']){
  const execution={name:'pwsh',callId:'inspect',agent:f.root,arguments:{command:cmd}};
  await f.service.policy.beforeExecute(execution);
  assert.equal(f.service.policy.guard(execution),undefined,cmd+' should not need a grant');
 }
 for(const cmd of ['Remove-Item -Recurse build','echo hi > out.txt','git reset --hard','git status; rm -rf build','npm install']){
  const execution={name:'pwsh',callId:'mutate',agent:f.root,arguments:{command:cmd}};
  await f.service.policy.beforeExecute(execution);
  assert.match(f.service.policy.guard(execution),/agent_delegation_route|delegate/,cmd+' should still need a grant');
 }
});

test('missing execution-precheck or sandbox capability blocks the stage before child creation',async()=>{
 const f=fixture();assert.ok(f.service.policy);let created=false;
 await assert.rejects(f.service.policy.withStage({args:{plan:['implement'],workTasks:[{files:[path.resolve('client.js')]}]}},{agent:f.root},async()=>{created=true;}),/pre-execute|预检查/i);
 assert.equal(created,false);
 await assert.rejects(f.service.policy.withStage({args:{plan:['test'],testCommands:['node check.mjs']}},{agent:f.root},async()=>{created=true;}),/sandboxPolicy|沙箱/i);
 assert.equal(created,false);
});

test('tester accepts required host display metadata but rejects execution overrides',async()=>{
 const f=fixture(),approved='Write-Output rc2-live-ok';
 f.ctx.sandboxPolicy={resolve:()=>({mode:'read-only'})};
 const child={session:{header:{id:'tester-child',parentSession:'policy-root',origin:'subagent',cwd:process.cwd()},append:()=>{}}};
 await f.service.policy.withStage({args:{plan:['test'],testCommands:[approved]}},{agent:f.root},async()=>{
  await f.events.get('agent/created')({agent:child});
  const execution={name:'pwsh',agent:child,arguments:{command:approved,description:'Verify smoke artifact',timeoutMs:10000}};
  assert.equal(f.service.policy.guard(execution),undefined);
  for(const extra of [{workdir:process.cwd()},{sandbox_permissions:'require_escalated'},{env:{X:'Y'}},{run_in_background:true}]){
   assert.match(f.service.policy.guard({...execution,arguments:{...execution.arguments,...extra}}),/覆盖|沙箱|权限/);
  }
  assert.match(f.service.policy.guard({...execution,arguments:{...execution.arguments,command:'Write-Output other'}}),/完整测试命令/);
 });
});

test('tester cannot report passed without successful host results for every approved command',async()=>{
 for(const exitCode of [undefined,1,0]){
  const f=fixture(),approved='Write-Output rc2-live-ok';f.ctx.sandboxPolicy={resolve:()=>({mode:'read-only'})};
  const child={session:{header:{id:'tester-evidence',parentSession:'policy-root',origin:'subagent',cwd:process.cwd()},append:()=>{}}};
  const output=await f.service.policy.withStage({args:{plan:['test'],testCommands:[approved]}},{agent:f.root},async()=>{
   await f.events.get('agent/created')({agent:child});
   if(exitCode!==undefined)await f.events.get('tools/execute')({name:'pwsh',agent:child,arguments:{command:approved,description:'verify'}},async()=>({isError:false,value:{kind:'foreground',exitCode}}));
   return {kind:'foreground',runId:'tested-run',result:{verdict:'passed',phases:{test:{status:'passed',summary:'model claims success'}}}};
  });
  assert.equal(output.result.verdict,exitCode===0?'passed':'blocked');
  assert.equal(output.runId,'tested-run');
 }
});

test('missing later-stage host capability is rejected before an earlier implementation can run',async()=>{
 const f=fixture();f.service.runWorkflow=f.nativeRunWorkflow;
 await f.service.policy.beforeExecute({name:'agent_orchestrate',agent:f.root,arguments:{}});
 const file=path.resolve('artifacts/admission-owned.txt'),command='Write-Output ok';
 await assert.rejects(f.service.execute({task:'bounded change and verify',plan:['implement','test'],prior:{rootPlan:{files:[file]}},workTasks:[{objective:'bounded change',files:[file]}],testCommands:[command],testTasks:[command]},{agent:f.root}),/sandboxPolicy|沙箱/);
 assert.equal(f.requests.length,0,'host capability preflight must precede every stage dispatch');
});

test('a managed child cannot execute tools before its role lifecycle association',async()=>{
 const f=fixture(),child={session:{header:{id:'unassociated',parentSession:'policy-root',origin:'subagent',cwd:process.cwd()}}};
 await f.service.policy.withStage({args:{plan:['explore']}},{agent:f.root},async()=>{
  for(const name of ['write','pwsh','structured_output'])assert.match(f.service.policy.guard({name,agent:child,arguments:{}}),/关联|角色|lifecycle/i);
 });
});
