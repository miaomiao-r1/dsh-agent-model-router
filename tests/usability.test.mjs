import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RouterService} from '../source/router.mjs';
import {assessDelegation} from '../source/delegation.mjs';
import {runLayeredWorkflow} from '../source/handoff.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const roles=Object.fromEntries(['explorer','worker','tester','researcher','reviewer','visioner'].map(r=>[r,{provider:'trae',model:'m'}]));
const exec={agent:{session:{header:{id:'root',createdAt:1,cwd:process.cwd()}}}};

test('a bounded substantial single-scope implementation can delegate',()=>{
 assert.equal(assessDelegation({scopeCount:1,risk:'low',taskKind:'implementation',bounded:true,effort:'substantial'}).route,'delegate');
 assert.equal(assessDelegation({scopeCount:1,risk:'low',taskKind:'implementation',bounded:true,effort:'small'}).route,'root');
 assert.equal(assessDelegation({scopeCount:2,risk:'high',taskKind:'decision',explicitRequest:true}).route,'root');
});

test('missing root plan defaults to exploration rather than a doomed full pipeline',async()=>{
 let request;
 const service=new RouterService({llm:{listProviders:async()=>[{id:'trae'}],listModels:async()=>[{provider:'trae',id:'m',name:'M'}]},store:{read:async()=>({enabled:true}),forSession:async()=>({version:1,roles})},runWorkflow:async req=>{request=req;return {kind:'foreground',runId:'r',agentsStarted:1,result:{verdict:'passed'}};}});
 await service.execute({task:'investigate and change'},exec);
 assert.deepEqual(request.args.plan,['explore']);
});

test('subagents are rejected at the orchestration entry even without a prompt guard',async()=>{
 const service=new RouterService({llm:{listProviders:async()=>[{id:'trae'}],listModels:async()=>[{provider:'trae',id:'m',name:'M'}]},store:{read:async()=>({enabled:true}),forSession:async()=>({version:1,roles})},runWorkflow:async()=>({kind:'foreground',runId:'r',agentsStarted:1,result:{verdict:'passed'}})});
 await assert.rejects(service.execute({task:'nested',plan:['explore']},{agent:{session:{header:{id:'child',createdAt:1,parentSession:'root',origin:'subagent',delegationDepth:1}}}}),/嵌套|nested|根/);
});

test('long reports are returned once as excerpts and hydrated from the ledger on continuation',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'amr-brief-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const detail='VERY_LONG_ORIGINAL_DETAIL'.repeat(600);
 const output=await runLayeredWorkflow({exec,directory,request:{args:{task:'read',plan:['explore'],roles}},run:async()=>({kind:'foreground',runId:'r',agentsStarted:1,result:{verdict:'passed',phases:{explore:{status:'done',summary:detail,evidence:detail}}}})});
 assert.ok(JSON.stringify(output).length<12000);
 assert.ok(output.result.handoff.explore.source.path);
 const file=JSON.parse(await fs.readFile(output.result.handoff.explore.source.path,'utf8'));
 assert.equal(file.result.phases.explore.summary,detail);
 assert.ok(!JSON.stringify(output.result.phases).includes(detail));
});
