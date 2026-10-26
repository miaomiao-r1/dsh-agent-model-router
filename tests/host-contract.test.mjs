import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('native subagent contract detection recognizes the legacy foreground result shape',async()=>{
 const api=await import('../scripts/verify-host-contract.mjs').catch(()=>null);
 assert.equal(typeof api?.detectNativeSubagentContract,'function');
 const source=`output: { schema: { type: 'object', properties: { kind: { type: 'string', required: true, const: 'foreground' }, runId: { type: 'string', required: true }, output: { type: 'array', items: { type: 'json' } } } } };`;
 assert.equal(api.detectNativeSubagentContract(source),'foreground-runId-output-json-items');
});

test('native subagent contract detection recognizes activation results with startActivation structure',async()=>{
 const api=await import('../scripts/verify-host-contract.mjs').catch(()=>null);
 assert.equal(typeof api?.detectNativeSubagentContract,'function');
 const source=`output: { schema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'activation' }, subagentId: { type: 'string', required: true } } } };\nreturn { kind: 'activation', subagentId: (await runtimeCtx.subagents.startActivation({ provider: config.provider, label: args.description, request, signal: exec.signal, delivery: 'parent' })).childId };`;
 assert.equal(api.detectNativeSubagentContract(source),'activation-subagentId-startActivation');
});

test('activation contract takes precedence when both known source shapes are present',async()=>{
 const api=await import('../scripts/verify-host-contract.mjs').catch(()=>null);
 assert.equal(typeof api?.detectNativeSubagentContract,'function');
 const legacy=`output: { schema: { type: 'object', properties: { kind: { type: 'string', required: true, const: 'foreground' }, runId: { type: 'string', required: true }, output: { type: 'array', items: { type: 'json' } } } } };`;
 const activation=`output: { schema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'activation' }, subagentId: { type: 'string', required: true } } } }; runtimeCtx.subagents.startActivation({ provider: config.provider, label: args.description, request, signal: exec.signal, delivery: 'parent' });`;
 assert.equal(api.detectNativeSubagentContract(`${legacy}\n${activation}`),'activation-subagentId-startActivation');
});

test('native subagent contract detection rejects unknown or incomplete shapes',async()=>{
 const api=await import('../scripts/verify-host-contract.mjs').catch(()=>null);
 assert.equal(typeof api?.detectNativeSubagentContract,'function');
 assert.equal(api.detectNativeSubagentContract(`activation subagentId startActivation`),null);
 assert.equal(api.detectNativeSubagentContract(`output: { schema: { type: 'object', properties: { kind: { const: 'foreground' }, runId: { type: 'string' }, output: { type: 'array', items: { type: 'json' } } } } };`),null);
 assert.equal(api.detectNativeSubagentContract(`output: { schema: { type: 'object', additionalProperties: false, kind: { type: 'string', required: true, const: 'activation' }, subagentId: { type: 'string', required: true } } }; subagents.startActivation({ provider, label, request, signal, delivery: 'parent' });`),null);
});

test('native ABI probe reads bounded ASAR entries and rejects traversal or truncated content',async t=>{
 const api=await import('../scripts/verify-host-contract.mjs').catch(()=>null);assert.equal(typeof api?.readAsarFile,'function');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'amr-asar-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const body=Buffer.from('{"version":"0.2.0-rc.2"}');
 const json=Buffer.from(JSON.stringify({files:{'package.json':{offset:'0',size:body.length}}}));
 const aligned=Math.ceil(json.length/4)*4,prefix=Buffer.alloc(16);prefix.writeUInt32LE(4,0);prefix.writeUInt32LE(8+aligned,4);prefix.writeUInt32LE(4+aligned,8);prefix.writeUInt32LE(json.length,12);
 const archive=path.join(directory,'test.asar');await fs.writeFile(archive,Buffer.concat([prefix,json,Buffer.alloc(aligned-json.length),body]));
 assert.equal(api.readAsarFile(archive,'package.json').toString(),body.toString());
 assert.throws(()=>api.readAsarFile(archive,'../package.json'),/path|traversal/i);
 await fs.truncate(archive,16+aligned+1);
 assert.throws(()=>api.readAsarFile(archive,'package.json'),/truncated|bounds/i);
});
