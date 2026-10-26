import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {apply} from '../index.js';
import {RouterService} from '../source/router.mjs';

test('the state endpoint exposes the actually loaded runtime build and capabilities',async()=>{
 const ctx={llm:{listProviders:async()=>[{id:'trae'}],listModels:async()=>[]},tools:{register:()=>()=>{},guard:()=>()=>{}},on:()=>()=>{},inject:()=>{},effect:fn=>fn()};
 const service=apply(ctx,{stateFile:'unused-runtime-test.json'});
 service.store.read=async()=>({version:1,enabled:false,roles:Object.fromEntries(['explorer','worker','tester','researcher','reviewer','visioner'].map(role=>[role,{provider:'trae',model:'m'}]))});
 const state=await service.view();
 assert.ok(state.runtime);assert.match(state.runtime.loadedBuildId,/^[a-f0-9]{64}$/);
 assert.equal(state.runtime.reloadRequired,false);assert.equal(state.runtime.capabilities.toolGuard,true);
 assert.equal(state.runtime.nodeVersion,process.version);
});

test('a changed loaded runtime blocks orchestration before any child starts',async()=>{
 let started=false;
 const roles={explorer:{provider:'trae',model:'m'}};
 const service=new RouterService({diagnostics:{status:()=>({reloadRequired:true})},llm:{listProviders:async()=>[{id:'trae'}],listModels:async()=>[{provider:'trae',id:'m',name:'M'}]},store:{read:async()=>({enabled:true}),forSession:async()=>({version:1,roles})},runWorkflow:async()=>{started=true;return {kind:'foreground',runId:'r',agentsStarted:1,result:{verdict:'passed'}};}});
 // This is already a valid explicit exploration request; only stale runtime
 // admission should prevent it from dispatching.
 await assert.rejects(service.execute({task:'read',plan:['explore']},{agent:{session:{header:{id:'root',createdAt:1}}}}),/重载|reload/i);
 assert.equal(started,false);
});

test('runtime diagnostics detects script changes as well as imported host source changes',async t=>{
 const module=await import('../source/runtime.mjs').catch(()=>null);assert.ok(module?.RuntimeDiagnostics,'RuntimeDiagnostics must be available');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'amr-runtime-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await fs.mkdir(path.join(directory,'source'));await fs.mkdir(path.join(directory,'engine'));
 for(const [file,content] of Object.entries({'package.json':JSON.stringify({version:'1.0.0-rc.2'}),'index.js':'// loaded','client.js':'// client','source/example.mjs':'// module','engine/engine.cjs':'// engine','engine/orchestrate.workflow.js':'// workflow'}))await fs.writeFile(path.join(directory,file),content);
 const diagnostics=new module.RuntimeDiagnostics({root:directory,capabilities:{toolGuard:true,dispatchMiddleware:true}});
 assert.equal(diagnostics.status().reloadRequired,false);
 await fs.writeFile(path.join(directory,'engine/orchestrate.workflow.js'),'// changed workflow');
 assert.equal(diagnostics.status().reloadRequired,true);
 assert.notEqual(diagnostics.status().loadedScriptHash,diagnostics.status().diskScriptHash);
 await fs.writeFile(path.join(directory,'engine/orchestrate.workflow.js'),'// workflow');
 await fs.writeFile(path.join(directory,'source/example.mjs'),'// changed import');
 assert.equal(diagnostics.status().reloadRequired,true);
});
