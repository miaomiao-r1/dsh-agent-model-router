import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply,inject} from '../index.js';

test('host API loads without a global workflow engine and uses the calling preset workflow',async()=>{
 const definitions=new Map(),routes=[],effects=[];
 const agent={session:{header:{id:'host-fixture',createdAt:1}}};
 const signal=new AbortController().signal;
 let received;
 const native={execute:async(args,exec)=>{received={args,exec};return {kind:'foreground',runId:'native-run',agentsStarted:1,result:{status:'passed'}};}};
 const ctx={
  llm:{listProviders:async()=>[{id:'trae',name:'TRAE'}],listModels:async()=>[{provider:'trae',id:'deepseek-v4.1-flash',name:'DeepSeek'}]},
  tools:{register:d=>{definitions.set(d.name,d);return()=>definitions.delete(d.name);},get:(name,scope)=>{assert.equal(name,'workflow');assert.equal(scope,agent);return native;}},
  webServer:{register:r=>{routes.push(r);return()=>routes.splice(routes.indexOf(r),1);}},
  connection:{admit:()=>({peer:{}})},
  effect:fn=>{const dispose=fn();if(typeof dispose==='function')effects.push(dispose);return dispose;},
  inject:(_deps,fn)=>fn(ctx)
 };
 // A real Web host has no global workflowEngine; the shipped preset isolates it.
 assert.ok(inject.every(name=>name in ctx),'plugin must activate with host-plane services');
 ctx.systemPrompt={section:()=>()=>{},getSectionOrder:()=>1};
 const service=apply(ctx,{stateFile:'unused-host-fixture.json'});
 const schema=definitions.get('agent_orchestrate').parameters;
 assert.equal(schema.type,'object','tool registry expects a complete JSON Schema, not a field-spec map');
 assert.deepEqual(schema.required,['task']);
 assert.equal(schema.properties.plan.type,'array');
 assert.equal(schema.properties.plan.items.type,'string');
 assert.ok(schema.properties.plan.items.enum.includes('explore'));
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
