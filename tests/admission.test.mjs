import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RouterService} from '../source/router.mjs';

const roleNames=['explorer','worker','tester','researcher','reviewer','visioner'];
const roles=Object.fromEntries(roleNames.map(role=>[role,{provider:'trae',model:'enabled'}]));
const exec={agent:{session:{header:{id:'admission-root',createdAt:1,cwd:process.cwd()}}}};

function fixture(){
 const requests=[];
 const service=new RouterService({
  llm:{listProviders:async()=>[{id:'trae',name:'TRAE'}],listModels:async()=>[{provider:'trae',id:'enabled',name:'Enabled'}]},
  store:{read:async()=>({enabled:true}),forSession:async()=>({version:1,roles})},
  runWorkflow:async request=>{requests.push(request);return {kind:'foreground',runId:'admission-run',agentsStarted:1,result:{verdict:'passed'}};}
 });
 return {service,requests};
}

test('implementation plan with a downstream test stage requires approved test commands before dispatch',async()=>{
 const f=fixture();
 await assert.rejects(f.service.execute({task:'Implement the approved file change',plan:['implement','test','review'],prior:{rootPlan:{files:['artifacts/admission-owned.txt']}}},exec),/testCommands|测试命令/);
 assert.equal(f.requests.length,0);
});

test('testCommands are forwarded as testTasks for a test-only plan',async()=>{
 const f=fixture();
 const commandList=['Write-Output ok'];
 await f.service.execute({task:'Run the approved check',plan:['test'],testCommands:commandList},exec);
 assert.deepEqual(f.requests[0].args.testTasks,commandList);
 assert.deepEqual(f.requests[0].args.testCommands,commandList);
});

test('explicit testTasks are normalized to testCommands',async()=>{
 const f=fixture();
 const commandList=['Write-Output ok'];
 await f.service.execute({task:'Run the approved check',plan:['test'],testTasks:commandList},exec);
 assert.deepEqual(f.requests[0].args.testCommands,commandList);
});

test('empty or blank testCommands are rejected before dispatch',async()=>{
 for(const testCommands of [[],['']]){
  const invalid=fixture();
  await assert.rejects(invalid.service.execute({task:'Run the approved check',plan:['test'],testCommands},exec),/testCommands|测试命令/);
  assert.equal(invalid.requests.length,0);
 }
});
