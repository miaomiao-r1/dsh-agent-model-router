import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {runLayeredWorkflow} from '../source/handoff.mjs';
import {RouterService} from '../source/router.mjs';
const {orchestrate}=createRequire(import.meta.url)('../engine/engine.cjs');
const roles=Object.fromEntries(['explorer','worker','tester','researcher','reviewer','visioner'].map(r=>[r,{provider:'trae',model:'m'}]));
const parallel=tasks=>Promise.all(tasks.map(fn=>fn()));
const memoryArchive=async(_value,name)=>path.resolve('artifacts',name+'.json');
const exec={agent:{session:{header:{id:'reliability',createdAt:1}}}};
const args=extra=>({task:'bounded task',roles,prior:{rootPlan:'approved'},...extra});
const resultFor=(stage,summary=stage)=>({kind:'foreground',runId:'run-'+stage,agentsStarted:1,result:{verdict:'passed',phases:{[stage]:{status:stage==='test'?'passed':stage==='review'?'clean':'done',summary,commands:'node verify.mjs',evidence:'exit=0'}}}});

test('visionInputs reach the actual vision agent prompt',async()=>{
 let prompt;
 await orchestrate(args({plan:['vision'],visionInputs:['C:/images/exact-image.png']}),{agent:async p=>{prompt=p;return {status:'done',summary:'seen'};},parallel});
 assert.match(prompt,/C:\/images\/exact-image\.png/);
});

test('implementation invalidates old tests and review before the new reviewer starts',async()=>{
 let prior;
 const output=await runLayeredWorkflow({exec,directory:'unused',writeReport:memoryArchive,request:{args:args({plan:['implement','review'],prior:{rootPlan:'approved',test:{status:'passed',summary:'OLD PASS'},review:{status:'clean',summary:'OLD CLEAN'}}})},run:async req=>{if(req.args.plan[0]==='review')prior=req.args.prior;return resultFor(req.args.plan[0]);}});
 assert.equal(prior.test,null);
 assert.ok(!JSON.stringify(output.result.handoff).includes('OLD PASS'));
});

test('test rerun invalidates old review even when testing fails',async()=>{
 const output=await runLayeredWorkflow({exec,directory:'unused',writeReport:memoryArchive,request:{args:args({plan:['test'],prior:{review:{status:'clean',summary:'OLD CLEAN'}}})},run:async()=>({kind:'foreground',runId:'failed-test',agentsStarted:1,result:{verdict:'failed',phases:{test:{status:'failed',summary:'broken'}}}})});
 assert.equal(output.result.handoff.review,null);
});

test('new constraints are merged and new acceptance criteria reach the child',async()=>{
 let prior;
 await runLayeredWorkflow({exec,directory:'unused',writeReport:memoryArchive,request:{args:args({plan:['explore'],constraints:['No API changes'],acceptanceCriteria:['NEW acceptance'],prior:{constraints:['Read only'],acceptanceCriteria:['OLD acceptance']}})},run:async req=>{prior=req.args.prior;return resultFor('explore');}});
 assert.deepEqual(prior.constraints,['Read only','No API changes']);
 assert.deepEqual(prior.acceptanceCriteria,['NEW acceptance']);
});

test('an invalid downstream task is rejected before any upstream child starts',async()=>{
 let calls=0;
 const output=await runLayeredWorkflow({exec,directory:'unused',writeReport:memoryArchive,request:{args:args({plan:['implement','test'],testTasks:[]})},run:async req=>{calls++;return {kind:'foreground',runId:'r',agentsStarted:1,result:await orchestrate(req.args,{agent:async()=>({status:'done',summary:'edited'}),parallel})};}});
 assert.equal(calls,0);
 assert.equal(output.result.verdict,'blocked');
 assert.match(output.result.validationErrors.join(' '),/testTasks/);
});

test('relative and absolute worker paths cannot own the same file',async()=>{
 const cwd=process.cwd();let calls=0;
 const output=await runLayeredWorkflow({exec,directory:'unused',writeReport:memoryArchive,request:{args:args({workspace:cwd,plan:['implement'],workTasks:[{objective:'one',files:['client.js']},{objective:'two',files:[path.join(cwd,'client.js')]}]})},run:async()=>{calls++;return resultFor('implement');}});
 assert.equal(calls,0);
 assert.match(output.result.validationErrors.join(' '),/overlap/i);
});

test('a real symlink alias cannot bypass worker ownership',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'amr-path-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await fs.mkdir(path.join(directory,'real'));await fs.symlink(path.join(directory,'real'),path.join(directory,'alias'),'junction');
 let calls=0;
 const output=await runLayeredWorkflow({exec,directory:'unused',writeReport:memoryArchive,request:{args:args({workspace:directory,plan:['implement'],workTasks:[{objective:'one',files:['real/new.mjs']},{objective:'two',files:['alias/new.mjs']}]})},run:async()=>{calls++;return resultFor('implement');}});
 assert.equal(calls,0);assert.equal(output.result.verdict,'blocked');
});

test('post-execution archive failure returns the completed run and original failure',async()=>{
 const output=await runLayeredWorkflow({exec,directory:'unused',request:{args:args({plan:['implement','test']})},writeReport:async(value,name)=>{if(name!=='00-input')throw Error('disk full after execution');return 'input.json';},run:async()=>resultFor('implement')});
 assert.equal(output.agentsStarted,1);assert.equal(output.result.phases.implement.status,'done');
 assert.equal(output.result.runs[0].runId,'run-implement');assert.match(JSON.stringify(output.result.errors),/disk full/);
 assert.equal(output.result.verdict,'blocked');assert.equal(output.result.recovery.safeToRetry,false);
});

test('a later host exception preserves earlier completed phases',async()=>{
 let calls=0;
 const output=await runLayeredWorkflow({exec,directory:'unused',writeReport:memoryArchive,request:{args:args({plan:['implement','test']})},run:async req=>{calls++;if(calls===2)throw Error('host failed');return resultFor(req.args.plan[0]);}});
 assert.equal(output.result.phases.implement.status,'done');assert.match(JSON.stringify(output.result.errors),/host failed/);
 assert.equal(output.result.runs[0].runId,'run-implement');assert.equal(output.result.verdict,'blocked');
});

test('unrelated provider catalogue failure does not block a healthy required role',async()=>{
 let called=false;
 const service=new RouterService({llm:{listProviders:async()=>[{id:'trae'},{id:'codearts'}],listModels:async p=>{if(p==='codearts')throw Error('offline unused provider');return [{provider:'trae',id:'m',name:'Healthy'}];}},store:{read:async()=>({enabled:true}),forSession:async()=>({version:1,roles})},runWorkflow:async()=>{called=true;return resultFor('explore');}});
 const result=await service.execute({task:'read',plan:['explore']},exec);
 assert.equal(called,true);assert.equal(result.agentsStarted,1);
 const catalogue=await service.catalogue();assert.equal(catalogue.partial,true);assert.match(catalogue.errors.codearts,/offline/);
});

test('the required failed provider still blocks orchestration without a fallback',async()=>{
 let called=false;
 const service=new RouterService({llm:{listProviders:async()=>[{id:'trae'}],listModels:async()=>{throw Error('required offline');}},store:{read:async()=>({enabled:true}),forSession:async()=>({version:1,roles})},runWorkflow:async()=>{called=true;}});
 await assert.rejects(service.execute({task:'read',plan:['explore']},exec),/offline|不可用|停用/);
 assert.equal(called,false);
});

test('the production router preflights downstream tasks even with an injected runner',async()=>{
 let called=false;
 const service=new RouterService({llm:{listProviders:async()=>[{id:'trae'}],listModels:async()=>[{provider:'trae',id:'m',name:'M'}]},store:{read:async()=>({enabled:true}),forSession:async()=>({version:1,roles})},runWorkflow:async()=>{called=true;return resultFor('implement');}});
 await assert.rejects(service.execute({task:'change',plan:['implement','test'],prior:{rootPlan:'approved'},testTasks:[]},exec),/testTasks/);
 assert.equal(called,false);
});

test('caller cannot spoof the filesystem workspace',async()=>{
 const service=new RouterService({llm:{listProviders:async()=>[{id:'trae'}],listModels:async()=>[{provider:'trae',id:'m',name:'M'}]},store:{read:async()=>({enabled:true}),forSession:async()=>({version:1,roles})},runWorkflow:async()=>resultFor('explore')});
 await assert.rejects(service.execute({task:'x',workspace:'C:/elsewhere'},exec),/workspace|工作区|覆盖/);
});

test('hardlink aliases cannot be assigned to different workers',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'amr-hardlink-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await fs.writeFile(path.join(directory,'one.txt'),'original');await fs.link(path.join(directory,'one.txt'),path.join(directory,'two.txt'));
 let calls=0;
 const output=await runLayeredWorkflow({exec,directory:'unused',writeReport:memoryArchive,request:{args:args({workspace:directory,plan:['implement'],workTasks:[{objective:'one',files:['one.txt']},{objective:'two',files:['two.txt']}]})},run:async()=>{calls++;return resultFor('implement');}});
 assert.equal(calls,0);assert.match(output.result.validationErrors.join(' '),/hardlink|硬链接|overlap/i);
});

test('an aborted admission or initial archive failure returns structured recovery information',async()=>{
 const controller=new AbortController();controller.abort('admission cancelled');let calls=0;
 const cancelled=await runLayeredWorkflow({exec:{...exec,signal:controller.signal},directory:'unused',writeReport:memoryArchive,request:{args:args({plan:['explore']})},run:async()=>{calls++;}});
 assert.equal(cancelled.result.verdict,'blocked');assert.equal(cancelled.result.errors[0].kind,'cancelled');
 const failed=await runLayeredWorkflow({exec,directory:'unused',writeReport:async()=>{throw Error('admission disk full');},request:{args:args({plan:['explore']})},run:async()=>{calls++;}});
 assert.equal(failed.result.verdict,'blocked');assert.equal(failed.result.recovery.safeToRetry,true);assert.match(JSON.stringify(failed.result.errors),/disk full/);assert.equal(calls,0);
});
