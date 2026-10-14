import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RouterService} from '../source/router.mjs';

test('root routing does not start a workflow for a simple assessed task',async()=>{
 const f=fixture();
 const result=await f.service.execute({task:'small change',plan:['implement'],delegation:{scopeCount:1,risk:'low'}},{agent:{session:{header:{id:'x',createdAt:300}}}});
 assert.equal(result.agentsStarted,0);assert.equal(result.result.verdict,'root_required');assert.equal(f.starts.length,0);
});
const keys=['explorer','worker','tester','researcher','reviewer'];
const roles=Object.fromEntries(keys.map(k=>[k,{provider:'trae',model:'enabled'}]));
function fixture(){
 let rows=[{provider:'trae',id:'enabled',name:'Enabled'}],starts=[];
 const llm={listProviders:()=>[{id:'trae',name:'TRAE'},{id:'deepseek-official',name:'official'}],listModels:async p=>p==='trae'?structuredClone(rows):[]};
 const store={read:async()=>({version:2,effectiveFrom:200,enabled:true,roles}),save:async(r,v)=>({version:v+1,roles:r,enabled:true}),forSession:async(id,t)=>({version:t<200?1:2,roles:Object.fromEntries(keys.map(k=>[k,{provider:'trae',model:t<200?'old':'enabled'}]))})};
 const engine={start:req=>{starts.push(req);return {id:'run',result:Promise.resolve({stopReason:'completed',agentsStarted:1,value:{verdict:'passed'}}),cancel:()=>{},dispose:async()=>{}};}};
 const service=new RouterService({llm,store,engine,script:'return args;'});
 return {service,llm,store,starts,setRows:value=>{rows=value;}};
}
test('opening page always reads a fresh catalogue',async()=>{const f=fixture();assert.equal((await f.service.view()).catalogue.models.length,1);f.setRows([]);const view=await f.service.view();assert.equal(view.catalogue.models.length,0);assert.equal(view.availability.explorer,false);});
test('catalogue restricts to our-free-model owned providers',async()=>{const f=fixture();assert.deepEqual((await f.service.catalogue()).models.map(m=>m.provider),['trae']);});
test('save revalidates exact model IDs and preserves stale choices on failure',async()=>{const f=fixture();f.setRows([]);await assert.rejects(f.service.save({roles,expectedVersion:2}),/停用|不可用/);});
test('directory failure never substitutes an old list',async()=>{const f=fixture();f.llm.listModels=async()=>{throw Error('offline');};const view=await f.service.view();assert.equal(view.catalogue.ok,false);assert.equal(view.catalogue.models.length,0);await assert.rejects(f.service.save({roles,expectedVersion:2}));});
test('old main session keeps old mapping after global save',async()=>{const f=fixture();f.setRows([{provider:'trae',id:'old',name:'Old'},{provider:'trae',id:'enabled',name:'Enabled'}]);const old={session:{header:{id:'old-session',createdAt:100}}};const fresh={session:{header:{id:'new-session',createdAt:300}}};assert.equal((await f.service.forAgent(old)).roles.worker.model,'old');assert.equal((await f.service.forAgent(fresh)).roles.worker.model,'enabled');});
test('orchestration uses saved routing and calling session/cancellation',async()=>{const f=fixture();const controller=new AbortController();const agent={session:{header:{id:'new-session',createdAt:300}}};const result=await f.service.execute({task:'read only',plan:['explore']},{agent,signal:controller.signal});assert.equal(result.routingVersion,2);assert.equal(f.starts[0].parent,agent);assert.equal(f.starts[0].signal,controller.signal);assert.equal(f.starts[0].args.roles.explorer.model,'enabled');});
test('caller cannot override saved roles',async()=>{const f=fixture();await assert.rejects(f.service.execute({task:'x',roles:{worker:{provider:'bad',model:'bad'}}},{agent:{session:{header:{id:'x',createdAt:300}}}}),/覆盖|roles/);assert.equal(f.starts.length,0);});
test('only needed roles are required to remain enabled',async()=>{const f=fixture();f.store.forSession=async()=>({version:1,roles:{...roles,worker:{provider:'trae',model:'disabled'}}});await f.service.execute({task:'read only',plan:['explore']},{agent:{session:{header:{id:'x',createdAt:300}}}});assert.equal(f.starts.length,1);});
test('abort cancels and disposes the underlying workflow',async()=>{const f=fixture();let cancelled=false,disposed=false,settle;f.service.engine={start:()=>({id:'r',result:new Promise(r=>{settle=r;}),cancel:()=>{cancelled=true;settle({stopReason:'cancelled'});},dispose:async()=>{disposed=true;}})};const controller=new AbortController();const running=f.service.execute({task:'x',plan:['explore']},{agent:{session:{header:{id:'x',createdAt:300}}},signal:controller.signal});await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(running);assert(cancelled);assert(disposed);});
test('mode off blocks new orchestration even in an old enabled session',async()=>{const f=fixture();f.store.read=async()=>({version:3,enabled:false,roles});await assert.rejects(f.service.execute({task:'x',plan:['explore']},{agent:{session:{header:{id:'x',createdAt:300}}}}),/关闭/);assert.equal(f.starts.length,0);});
