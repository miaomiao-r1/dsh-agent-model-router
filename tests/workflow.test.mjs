import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const {orchestrate}=createRequire(import.meta.url)('../engine/engine.cjs');

test('host null result reports unavailable child output without blaming model schema',async()=>{
 const result=await orchestrate({task:'read package identity',plan:['explore','research'],roles:{explorer:{provider:'trae',model:'x'},researcher:{provider:'trae',model:'x'}}},{agent:async()=>null,parallel:thunks=>Promise.all(thunks.map(fn=>fn()))});
 assert.equal(result.verdict,'blocked');
 assert.equal(result.phases.explore.outputUnavailable,true);
 assert.equal(result.phases.explore.invalid,undefined);
 assert.match(result.phases.explore.summary,/no structured result/i);
 assert.match(result.phases.explore.summary,/child session/i);
 assert.equal(result.phaseStatus.research.skipped,true);
});

test('shipped workflow passes handoff recovery policy and critical constraints to the agent',async()=>{
 const body=await fs.readFile(new URL('../engine/orchestrate.workflow.js',import.meta.url),'utf8');
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 const execute=new AsyncFunction('args','agent','parallel','phase','log',body);
 let prompt;
 const result=await execute({task:'read',plan:['explore'],roles:{explorer:{provider:'trae',model:'x'}},prior:{constraints:['Do not recurse'],handoffPolicy:'Read full reports before using excerpts'}},async text=>{prompt=text;return {status:'done',summary:'listed'};},thunks=>Promise.all(thunks.map(fn=>fn())),()=>{},()=>{});
 assert.equal(result.verdict,'passed');assert.match(prompt,/Do not recurse/);assert.match(prompt,/Read full reports before using excerpts/);
});

test('vision stage routes to the visioner role and accepts done status',async()=>{
  const result=await orchestrate({task:'describe image',plan:['vision'],roles:{visioner:{provider:'trae',model:'v4.1-flash'}}},{agent:async()=>({status:'done',summary:'two buttons, red and blue'}),parallel:thunks=>Promise.all(thunks.map(fn=>fn()))});
  assert.equal(result.verdict,'passed');
  assert.equal(result.phases.vision.status,'done');
  assert.match(result.phases.vision.summary,/two buttons/);
});

test('vision stage blocks when the image is unavailable',async()=>{
  const result=await orchestrate({task:'describe image',plan:['vision'],roles:{visioner:{provider:'trae',model:'v4.1-flash'}}},{agent:async()=>({status:'blocked',summary:'image not readable'}),parallel:thunks=>Promise.all(thunks.map(fn=>fn()))});
  assert.equal(result.verdict,'blocked');
  assert.equal(result.phases.vision.status,'blocked');
});

test('vision must precede explore when both are in the plan',async()=>{
  const result=await orchestrate({task:'x',plan:['explore','vision'],roles:{explorer:{provider:'trae',model:'x'},visioner:{provider:'trae',model:'x'}}},{agent:async()=>({status:'done',summary:'ok'}),parallel:thunks=>Promise.all(thunks.map(fn=>fn()))});
  assert.equal(result.verdict,'blocked');
  assert.ok(result.validationErrors.some(e=>/vision must precede explore/.test(e)));
});

test('review schema explains that clean reviews have no issue findings and keeps contradictions blocked',async()=>{
 let prompt,schema;
 const args={task:'review actual file',plan:['review'],roles:{reviewer:{provider:'trae',model:'review'}}};
 const result=await orchestrate(args,{agent:async(text,options)=>{prompt=text;schema=options.schema;return {status:'clean',summary:'no defects',blocking:false,findings:[]};},parallel:thunks=>Promise.all(thunks.map(fn=>fn()))});
 assert.equal(result.verdict,'passed');
 assert.match(prompt,/clean requires.*empty findings/i);
 assert.match(schema.properties.findings.description,/defects|issues/i);
 const invalid=await orchestrate(args,{agent:async()=>({status:'clean',summary:'no defects',findings:[{claim:'a positive observation'}]}),parallel:thunks=>Promise.all(thunks.map(fn=>fn()))});
 assert.equal(invalid.verdict,'blocked');assert.equal(invalid.phases.review.invalid,true);
});
