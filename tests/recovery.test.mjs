import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runLayeredWorkflow} from '../source/handoff.mjs';
import {RunLedger} from '../source/runs.mjs';

const exec=id=>({agent:{session:{header:{id,createdAt:1}}}});
const request={script:'tested-script',args:{task:'idempotent change',plan:['implement','test'],prior:{rootPlan:'approved'},operationId:'one-operation'}};
const success=stage=>({kind:'foreground',runId:'native-'+stage,agentsStarted:1,result:{verdict:'passed',phases:{[stage]:{status:stage==='test'?'passed':'done',summary:stage,commands:'node check',evidence:'exit=0'}}}});
async function temp(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'amr-recovery-'));t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:50}));return directory;}

test('replaying the same operation after completion never starts another worker',async t=>{
 const directory=await temp(t);let calls=0;
 const options={directory,request,exec:exec('owner'),run:async req=>{calls++;return success(req.args.plan[0]);}};
 const first=await runLayeredWorkflow(options),second=await runLayeredWorkflow(options);
 assert.equal(calls,2);assert.equal(second.result.recovery.replayed,true);
 assert.equal(second.result.operationId,first.result.operationId);
});

test('resume skips a durably completed implementation after testing was blocked',async t=>{
 const directory=await temp(t);let writes=0,tests=0;
 const run=async req=>{const stage=req.args.plan[0];if(stage==='implement'){writes++;return success(stage);}tests++;return tests===1?{kind:'foreground',runId:'blocked-test',agentsStarted:1,result:{verdict:'blocked',phases:{test:{status:'blocked',summary:'temporary test dependency'}}}}:success(stage);};
 const first=await runLayeredWorkflow({directory,request,exec:exec('owner'),run});
 const resumed=await runLayeredWorkflow({directory,request:{...request,args:{...request.args,resumeFrom:first.result.operationId}},exec:exec('owner'),run});
 assert.equal(writes,1);assert.equal(tests,2);assert.equal(resumed.result.verdict,'passed');
 assert.equal(resumed.result.recovery.resumed,true);
});

test('resume rejects a different session and changed inputs',async t=>{
 const directory=await temp(t);
 const first=await runLayeredWorkflow({directory,request,exec:exec('owner'),run:async req=>success(req.args.plan[0])});
 const input={...request,args:{...request.args,resumeFrom:first.result.operationId}};
 let calls=0;
 const other=await runLayeredWorkflow({directory,request:input,exec:exec('other'),run:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(other.result.verdict,'blocked');assert.match(JSON.stringify(other.result.errors),/session|owner/i);
 const changed=await runLayeredWorkflow({directory,request:{...input,args:{...input.args,task:'different work'}},exec:exec('owner'),run:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(changed.result.verdict,'blocked');assert.match(JSON.stringify(changed.result.errors),/input|fingerprint/i);
});

test('unknown write outcomes cannot be automatically resumed',async t=>{
 const directory=await temp(t);let calls=0;
 const run=async()=>{calls++;throw Error('connection lost after possible write');};
 const first=await runLayeredWorkflow({directory,request,exec:exec('owner'),run});
 const resumed=await runLayeredWorkflow({directory,request:{...request,args:{...request.args,resumeFrom:first.result.operationId}},exec:exec('owner'),run});
 assert.equal(calls,1);assert.equal(resumed.result.verdict,'blocked');assert.equal(resumed.result.recovery.requiresInspection,true);
});

test('simultaneous identical operations cannot both dispatch a writer',async t=>{
 const directory=await temp(t);let writes=0;
 const options={directory,request,exec:exec('owner'),run:async req=>{if(req.args.plan[0]==='implement')writes++;await new Promise(r=>setTimeout(r,25));return success(req.args.plan[0]);}};
 const results=await Promise.all([runLayeredWorkflow(options),runLayeredWorkflow(options)]);
 assert.equal(writes,1);assert.ok(results.some(r=>r.result.verdict==='passed'));
 assert.ok(results.some(r=>r.result.recovery.inProgress||r.result.recovery.replayed));
});

test('a pre-existing operation-directory junction cannot redirect archives outside the root',async t=>{
 const directory=await temp(t),outside=await temp(t);const id='a'.repeat(64);
 await fs.symlink(outside,path.join(directory,id),'junction');let calls=0;
 const output=await runLayeredWorkflow({directory,request:{...request,args:{...request.args,resumeFrom:id}},exec:exec('owner'),run:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(output.result.verdict,'blocked');
 assert.match(JSON.stringify(output.result.errors),/symlink|junction|outside|link|归档/i);
 assert.deepEqual(await fs.readdir(outside),[]);
});

test('a cleanup failure preserves completed stage identifiers and requests inspection',async t=>{
 const directory=await temp(t),original=RunLedger.prototype.close;
 RunLedger.prototype.close=async function(){await original.call(this);throw Error('simulated lease cleanup failure');};
 t.after(()=>{RunLedger.prototype.close=original;});
 const output=await runLayeredWorkflow({directory,request,exec:exec('cleanup-owner'),run:async req=>success(req.args.plan[0])});
 assert.equal(output.runId,'native-test');assert.equal(output.agentsStarted,2);
 assert.equal(output.result.verdict,'blocked');assert.equal(output.result.recovery.requiresInspection,true);
 assert.ok(output.result.errors.some(e=>e.kind==='cleanup'));
});

test('a hardlinked execution database is rejected before it can modify its alias',async t=>{
 const directory=await temp(t),outside=await temp(t);
 const options={directory,request,exec:exec('hardlink-owner'),run:async req=>success(req.args.plan[0])};
 const first=await runLayeredWorkflow(options),database=path.join(directory,first.result.operationId,'execution.sqlite');
 const alias=path.join(outside,'unrelated.sqlite');await fs.link(database,alias);
 const before=await fs.readFile(alias),output=await runLayeredWorkflow(options);
 assert.equal(output.result.verdict,'blocked');assert.match(JSON.stringify(output.result.errors),/hardlink|multiple links/i);
 assert.deepEqual(await fs.readFile(alias),before);
});
