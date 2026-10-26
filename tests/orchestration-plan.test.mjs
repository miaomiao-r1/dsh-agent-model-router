import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {assessDelegation} from '../source/delegation.mjs';
import {DEFAULT_ROLES} from '../source/defaults.mjs';
import {ROLE_NAMES} from '../source/store.mjs';
import {runLayeredWorkflow} from '../source/handoff.mjs';
const {validatePlan,STAGE_ROLE,STATES,DEFAULT_PROMPTS}=createRequire(import.meta.url)('../engine/engine.cjs');

// §2 角色清单：scribe（文书）必须成为第七个可路由角色
test('scribe is the seventh routable role with a store slot and an engine mapping',()=>{
  assert.ok(ROLE_NAMES.includes('scribe'),'store must list scribe as a role');
  assert.equal(typeof DEFAULT_ROLES.scribe?.provider,'string','defaults must provide a scribe baseline');
  assert.equal(typeof DEFAULT_ROLES.scribe?.model,'string');
  assert.equal(STAGE_ROLE.scribe,'scribe','engine must map the scribe stage');
  assert.ok(Array.isArray(STATES.scribe)&&STATES.scribe.length,'scribe must declare its allowed report states');
  assert.equal(typeof DEFAULT_PROMPTS.scribe,'string','scribe needs a default prompt');
});

test('a scribe stage validates and runs through the workflow engine',()=>{
  const roles=Object.fromEntries(ROLE_NAMES.map(r=>[r,{provider:'trae',model:'m'}]));
  const checked=validatePlan({task:'tidy the release notes',plan:['scribe'],roles});
  assert.deepEqual(checked.errors,[]);
  assert.deepEqual(checked.tasks.scribe,['tidy the release notes']);
});

// §4 三维路由：复杂度维度必须参与评估，不能压成单一分数
test('delegation assessment carries an explicit complexity dimension',()=>{
  assert.throws(()=>assessDelegation({scopeCount:1,complexity:'extreme'}),/complexity/);
  const simple=assessDelegation({scopeCount:1,risk:'low',taskKind:'implementation',bounded:true,effort:'substantial',complexity:'simple'});
  assert.equal(simple.route,'delegate');
  assert.equal(simple.complexity,'simple','the decision must echo the assessed complexity');
  const complex=assessDelegation({scopeCount:1,risk:'low',taskKind:'implementation',bounded:true,effort:'substantial',complexity:'complex'});
  assert.equal(complex.complexity,'complex');
  assert.equal(complex.route,'root','complex implementation decisions escalate to the manager');
  assert.equal(assessDelegation({scopeCount:1,risk:'low'}).complexity,'moderate','complexity defaults to moderate when undeclared');
});

// §6 失败信号与回退：真实失败升级回 Manager 并附替代 lane 建议；基础设施抖动不升级、不自动换模型
test('a real stage failure escalates to the manager with an alternative-lane suggestion and no auto swap',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'amr-escalate-'));
  try{
    let calls=0;
    const request={args:{task:'change',plan:['implement'],prior:{rootPlan:{decision:'approved'}},workTasks:[{objective:'change',files:['client.js']}],roles:{worker:{provider:'trae',model:'m'},explorer:{provider:'codearts',model:'alt'}}}};
    const run=async()=>{calls++;return {kind:'foreground',runId:'f'+calls,agentsStarted:1,result:{verdict:'failed',phases:{implement:{status:'failed',summary:'compile error',error:'TS1005'}}}};};
    const first=await runLayeredWorkflow({directory,request,exec:{signal:new AbortController().signal},run});
    assert.equal(first.result.verdict,'failed');
    assert.equal(first.result.recovery.escalateToManager,true,'a failed implement stage must escalate to the manager');
    assert.match(String(first.result.recovery.suggestion||''),/Manager|根|升级/,'the escalation must say it goes back to the manager');
    assert.equal(calls,1,'no silent retry may start a second child for the same failure');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('infrastructure-style interruptions are not counted as real failures',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'amr-escalate-'));
  try{
    const request={args:{task:'change',plan:['implement'],prior:{rootPlan:{decision:'approved'}},workTasks:[{objective:'change',files:['client.js']}],roles:{worker:{provider:'trae',model:'m'}}}};
    const run=async()=>{throw Object.assign(Error('request timed out'),{code:'ETIMEDOUT'});};
    const result=await runLayeredWorkflow({directory,request,exec:{signal:new AbortController().signal},run});
    assert.equal(result.result.verdict,'blocked');
    assert.equal(result.result.recovery.escalateToManager??false,false,'an invocation timeout is not a real failure and must not escalate');
  }finally{await rm(directory,{recursive:true,force:true});}
});

// §8 度量：记录每任务的路由档位、实际执行模型、验收结果、升级标记
test('the run records per-stage routing metrics alongside the checkpoint',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'amr-metrics-'));
  try{
    const roles=Object.fromEntries(ROLE_NAMES.map(r=>[r,{provider:'trae',model:r+'-model'}]));
    const request={args:{task:'read',plan:['explore'],roles}};
    const run=async()=>({kind:'foreground',runId:'metric-run',agentsStarted:1,result:{verdict:'passed',phases:{explore:{status:'done',summary:'read'}}}});
    const output=await runLayeredWorkflow({directory,request,exec:{signal:new AbortController().signal},run});
    const metrics=output.result.metrics;
    assert.ok(Array.isArray(metrics),'result must carry a metrics array');
    assert.equal(metrics.length,1);
    assert.equal(metrics[0].stage,'explore');
    assert.equal(metrics[0].role,'explorer');
    assert.equal(metrics[0].provider,'trae');
    assert.equal(metrics[0].model,'explorer-model','the actual executed model must be recorded');
    assert.equal(metrics[0].verdict,'passed');
    assert.equal(typeof metrics[0].failureCount,'number','real-failure count per stage must be recorded');
    assert.equal(metrics[0].escalated,false,'no escalation happened on a passing stage');
  }finally{await rm(directory,{recursive:true,force:true});}
});

// §7 护栏：reviewer 与 worker 同模型家族时给出跨家族审查提示
test('a reviewer sharing the worker model family draws a cross-family warning',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'amr-family-'));
  try{
    const roles=Object.fromEntries(ROLE_NAMES.map(r=>[r,{provider:'trae',model:r}]));
    roles.worker={provider:'trae',model:'kimi-k3'};
    roles.reviewer={provider:'trae',model:'kimi-k3-instruct'};
    const request={args:{task:'x',plan:['implement','review'],roles,prior:{rootPlan:{decision:'approved'}},workTasks:[{objective:'x',files:['client.js']}],reviewTasks:['check the diff']}};
    const run=async req=>{
      const stage=req.args.plan[0];
      return {kind:'foreground',runId:'r-'+stage,agentsStarted:1,result:{verdict:'passed',phases:{[stage]:stage==='review'?{status:'clean',summary:'ok',findings:[]}:{status:'done',summary:'wrote'}}}};
    };
    const output=await runLayeredWorkflow({directory,request,exec:{signal:new AbortController().signal},run});
    const warning=(output.result.warnings||[]).find(w=>/家族|family/i.test(String(w)));
    assert.ok(warning,'same-family reviewer must produce a cross-family warning');
  }finally{await rm(directory,{recursive:true,force:true});}
});
