import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runLayeredWorkflow} from '../source/handoff.mjs';
import {assessDelegation} from '../source/delegation.mjs';

test('simple tasks stay with root while explicit multi-agent and independent checks can delegate',()=>{
 assert.equal(assessDelegation({scopeCount:1,risk:'low'}).route,'root');
 assert.equal(assessDelegation({scopeCount:2,risk:'low'}).route,'delegate');
 assert.equal(assessDelegation({scopeCount:1,risk:'high'}).route,'root');
 assert.equal(assessDelegation({scopeCount:1,risk:'high',needsIndependentCheck:true}).route,'delegate');
 assert.equal(assessDelegation({scopeCount:1,risk:'low',explicitRequest:true}).route,'delegate');
 assert.throws(()=>assessDelegation({scopeCount:-1}),/scopeCount/);
});

test('layered handoff preserves full reports on disk and filters role context',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'amr-handoff-'));
 try{
  const calls=[],long='detail '.repeat(4000),constraints=['Do not change APIs'];
  const run=async request=>{
   calls.push(request);
   const stage=request.args.plan[0];
   const report={status:stage==='test'?'passed':stage==='review'?'clean':'done',summary:long,evidence:long,commands:'npm test',uncertainty:'Needs inspection',filesModified:['app.js']};
   const prior=request.args.prior;
   return {kind:'foreground',runId:'run-'+stage,agentsStarted:1,result:{verdict:'passed',phases:{[stage]:report},handoff:{...prior,[stage==='implement'?'impl':stage]:report}}};
  };
  const result=await runLayeredWorkflow({request:{args:{task:'x',plan:['explore','implement','test','review'],constraints,prior:{rootPlan:{decision:'approved'},research:{status:'done',summary:'irrelevant background'}}}},exec:{signal:new AbortController().signal},run,directory});
  assert.equal(calls.length,4);
  assert.equal(result.agentsStarted,4);
  assert.equal(result.result.handoff.explore.summary,long);
  assert.deepEqual(calls[1].args.prior.constraints,constraints);
  assert.equal(calls[2].args.prior.explore,null,'tester does not receive unrelated explore report');
  assert.ok(calls[3].args.prior.test.commands.includes('npm test'));
  assert.ok(calls[1].args.prior.explore.summary.length<2000);
  assert.equal(calls[1].args.prior.explore.uncertainty,'Needs inspection');
  const archive=JSON.parse(await readFile(result.result.reportFiles[1].path,'utf8'));
  assert.equal(archive.result.phases.explore.evidence,long);
  assert.ok(calls[1].args.prior.explore.source.path.endsWith('.json'));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('failed stages prevent downstream execution and retain reports',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'amr-handoff-'));
 try{
  let calls=0;
  const result=await runLayeredWorkflow({directory,request:{args:{plan:['test','review'],task:'x'}},exec:{},run:async()=>{calls++;return {kind:'foreground',runId:'failed-run',agentsStarted:1,result:{verdict:'failed',phases:{test:{status:'failed',summary:'broken',error:'exact failure'}}}};}});
  assert.equal(calls,1);assert.equal(result.result.verdict,'failed');assert.equal(result.result.handoff.test.error,'exact failure');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('archive failure prevents any child start',async()=>{
 let calls=0;
 await assert.rejects(runLayeredWorkflow({directory:'unused',request:{args:{task:'x',plan:['explore']}},exec:{},writeReport:async()=>{throw Error('disk unavailable');},run:async()=>{calls++;}}),/disk unavailable/);
 assert.equal(calls,0);
});

test('implementation without a root plan returns needs_decision without starting a worker',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'amr-handoff-'));
 try{
  let calls=0;
  const result=await runLayeredWorkflow({directory,request:{args:{task:'change',plan:['implement']}},exec:{},run:async()=>{calls++;}});
  assert.equal(calls,0);assert.equal(result.result.verdict,'blocked');assert.equal(result.result.handoff.impl.status,'needs_decision');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('cancellation between stages prevents the next child from starting',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'amr-handoff-')),controller=new AbortController();
 try{
  let calls=0;
  await assert.rejects(runLayeredWorkflow({directory,request:{args:{task:'x',plan:['explore','research']}},exec:{signal:controller.signal},run:async()=>{calls++;controller.abort();return {kind:'foreground',runId:'r',agentsStarted:1,result:{verdict:'passed',phases:{explore:{status:'done',summary:'x'}}}};}}));
  assert.equal(calls,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
