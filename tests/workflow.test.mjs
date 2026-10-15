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
