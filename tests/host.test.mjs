import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply,inject} from '../index.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('host API loads without a global workflow engine and uses the calling preset workflow',async t=>{
 const handoffDirectory=await mkdtemp(path.join(tmpdir(),'amr-host-'));t.after(()=>rm(handoffDirectory,{recursive:true,force:true}));
 const definitions=new Map(),routes=[],effects=[],prompts=[];
 const agent={session:{header:{id:'host-fixture',createdAt:1},append:()=>{}}};
 const signal=new AbortController().signal;
 let received;
 const native={execute:async(args,exec)=>{received={args,exec};return {kind:'foreground',runId:'native-run',agentsStarted:1,result:{status:'passed'}};}};
 const ctx={
  llm:{listProviders:async()=>[{id:'trae',name:'TRAE'}],listModels:async()=>[{provider:'trae',id:'deepseek-v4.1-flash',name:'DeepSeek'}]},
  tools:{register:d=>{definitions.set(d.name,d);return()=>definitions.delete(d.name);},get:(name,scope)=>{assert.equal(name,'workflow');assert.equal(scope,agent);return native;},guard:()=>()=>{}},
  on:()=>()=>{},
  webServer:{register:r=>{routes.push(r);return()=>routes.splice(routes.indexOf(r),1);}},
  connection:{admit:()=>({peer:{}})},
  effect:fn=>{const dispose=fn();if(typeof dispose==='function')effects.push(dispose);return dispose;},
  inject:(_deps,fn)=>fn(ctx)
 };
 // A real Web host has no global workflowEngine; the shipped preset isolates it.
 assert.ok(inject.every(name=>name in ctx),'plugin must activate with host-plane services');
 ctx.systemPrompt={section:section=>{prompts.push(section);return()=>{};},getSectionOrder:()=>1};
 const service=apply(ctx,{stateFile:'unused-host-fixture.json',handoffDirectory});
 const guidance=prompts.map(section=>section.text).join('\n');
 assert.doesNotMatch(guidance,/Single-scope work without independent-check needs stays with the root/);
 assert.match(guidance,/taskKind, bounded, effort, and complexity/);
 assert.match(guidance,/taskKind:'exploration'/,'guidance must give exploration tasks an explicit delegation trigger');
 assert.match(guidance,/agent_delegate\(role:'explorer'\)/,'guidance must name the one-step explorer call');
 const orchestrate=definitions.get('agent_orchestrate');
 assert.match(orchestrate.description,/真实启动 explorer 子代理/,'orchestrate description must state the default explore stage starts a real explorer child');
 const schema=orchestrate.parameters;
 assert.equal(schema.type,'object','tool registry expects a complete JSON Schema, not a field-spec map');
 assert.deepEqual(schema.required,['task']);
 assert.equal(schema.properties.plan.type,'array');
 assert.equal(schema.properties.plan.items.type,'string');
 assert.ok(schema.properties.plan.items.enum.includes('explore'));
  assert.ok(schema.properties.plan.items.enum.includes('vision'));
 assert.equal('required' in schema.properties.task,false);
 assert.equal(definitions.get('agent_role_models').parameters.type,'object');
 assert.equal(routes[0].path,'/agent-model-router');
 service.store.read=async()=>({enabled:true});
 service.store.forSession=async()=>({version:7,roles:{explorer:{provider:'trae',model:'deepseek-v4.1-flash'}}});
 const exec={agent,signal};
 const result=await definitions.get('agent_orchestrate').execute({task:'read only',plan:['explore']},exec);
 assert.equal(result.runId,'native-run');
 assert.equal(result.routingVersion,7);
 assert.equal(received.exec,exec);
 assert.equal(received.args.args.roles.explorer.model,'deepseek-v4.1-flash');
 assert.equal(received.args.run_in_background,false);
 for(const dispose of effects.reverse())dispose();
 assert.equal(routes.length,0,'host route must be removed when plugin unloads');
});
