import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// This probe reads the installed official source as data. It never starts DSH,
// changes a profile, executes vendor source, or requests a model.
export function readAsarFile(archive,file){
 if(typeof file!=='string'||file.split('/').some(p=>!p||p==='.'||p==='..')||file.includes('\\'))throw Error('Invalid ASAR path / traversal');
 const fd=fs.openSync(archive,'r');
 try{
  const size=fs.fstatSync(fd).size,prefix=Buffer.alloc(16);
  if(fs.readSync(fd,prefix,0,16,0)!==16)throw Error('Truncated ASAR prefix');
  const headerLength=prefix.readUInt32LE(12),dataStart=8+prefix.readUInt32LE(4);
  if(headerLength<2||headerLength>64*1024*1024||16+headerLength>size||dataStart<16+headerLength)throw Error('Invalid ASAR header bounds');
  const header=Buffer.alloc(headerLength);
  if(fs.readSync(fd,header,0,headerLength,16)!==headerLength)throw Error('Truncated ASAR header');
  let entry=JSON.parse(header.toString('utf8'));
  for(const part of file.split('/')){if(!entry.files||!Object.hasOwn(entry.files,part))throw Error('Missing native module: '+file);entry=entry.files[part];}
  const length=Number(entry.size),offset=dataStart+Number(entry.offset);
  if(entry.unpacked)throw Error('Probe requires an archived source entry: '+file);
  if(!Number.isSafeInteger(length)||length<0||length>64*1024*1024||!Number.isSafeInteger(offset)||offset<dataStart||offset+length>size)throw Error('Truncated ASAR entry / bounds: '+file);
  const content=Buffer.alloc(length);
  if(fs.readSync(fd,content,0,length,offset)!==length)throw Error('Truncated ASAR entry: '+file);
  if(entry.integrity?.algorithm==='SHA256')assert.equal(createHash('sha256').update(content).digest('hex'),entry.integrity.hash,'ASAR source integrity mismatch: '+file);
  return content;
 }finally{fs.closeSync(fd);}
}

// Match only the two source-level result schemas and lifecycle call shapes this
// probe knows how to validate. The ASAR source remains data; no vendor code runs.
export function detectNativeSubagentContract(source){
 if(typeof source!=='string')return null;
 const scalarField=(field,type,extra)=>new RegExp(`\\b${field}\\s*:\\s*\\{(?=[^{}]*\\btype\\s*:\\s*["']${type}["'])(?=[^{}]*\\brequired\\s*:\\s*true)${extra||''}[^{}]*\\}`,'s');
 const foreground=/\bkind\s*:\s*\{(?=[^{}]*\btype\s*:\s*["']string["'])(?=[^{}]*\brequired\s*:\s*true)(?=[^{}]*\bconst\s*:\s*["']foreground["'])[^{}]*\}/s.test(source)
  &&scalarField('runId','string').test(source)
  &&/\boutput\s*:\s*\{\s*type\s*:\s*["']array["'][\s\S]{0,300}?\bitems\s*:\s*\{\s*type\s*:\s*["']json["']\s*\}/s.test(source);
 const activationSchema=/\boutput\s*:\s*\{\s*schema\s*:\s*\{\s*type\s*:\s*["']object["'][\s\S]{0,1200}?\badditionalProperties\s*:\s*false[\s\S]{0,200}?\bproperties\s*:\s*\{[\s\S]{0,300}?\bkind\s*:\s*\{(?=[^{}]*\btype\s*:\s*["']string["'])(?=[^{}]*\brequired\s*:\s*true)(?=[^{}]*\bconst\s*:\s*["']activation["'])[^{}]*\}[\s\S]{0,300}?\bsubagentId\s*:\s*\{(?=[^{}]*\btype\s*:\s*["']string["'])(?=[^{}]*\brequired\s*:\s*true)[^{}]*\}/s.test(source);
 const activationCall=/\bsubagents\.startActivation\s*\(\s*\{\s*provider\s*:\s*[^,]+,\s*label\s*:\s*[^,]+,\s*request\s*,\s*signal\s*:\s*[^,]+,\s*delivery\s*:\s*["']parent["']\s*\}\s*\)/s.test(source);
 if(activationSchema&&activationCall)return 'activation-subagentId-startActivation';
 if(foreground)return 'foreground-runId-output-json-items';
 return null;
}

export function verifyHostContract(archive){
 const prefix='dsh/node_modules/@deepseek-ai/';
 const read=name=>readAsarFile(archive,prefix+name).toString('utf8');
 const version=JSON.parse(read('dsh/package.json')).version;
 const catalog=read('dsh-tool-cordis/lib/types/api-catalog.js');
 const child=read('dsh-subagent/lib/types/child-agent.js');
 const subagent=read('dsh-tool-subagent/lib/index.js');
 const tools=read('dsh-tools/lib/index.js');
 const workflow=read('dsh-workflow-ptc/lib/index.js');
 const nativeSubagentContract=detectNativeSubagentContract(subagent);
 const checks={
  monotonicToolGuard:catalog.includes('guard(guard: ToolGuard)')&&catalog.includes('string | undefined'),
  aroundDispatch:catalog.includes("name: 'tools/execute'")&&catalog.includes('ToolDispatchExecution')&&catalog.includes('next: () => Promise<ToolExecutionResult>'),
  executionPrecheck:catalog.includes("name: 'tools/pre-execute'")&&tools.includes('tools/pre-execute'),
  childLifecycle:catalog.includes("name: 'agent/created'")&&catalog.includes('parentSession')&&child.includes('delegationDepth'),
  childReadOnlyEvent:child.includes("append('sandbox/mode'")&&catalog.includes("read-only"),
  childOwnershipEvent:catalog.includes("name: 'workflow/agent-start'")&&catalog.includes('childId: SessionId'),
  nativeSubagentContract:nativeSubagentContract!==null,
  dispatchResultValidation:tools.includes('normalizeDispatchResult'),
  workflowModelRouting:workflow.includes('subagents.start')&&workflow.includes('provider')&&workflow.includes('model')&&workflow.includes('outputSchema')
 };
 for(const [name,ok] of Object.entries(checks))assert.ok(ok,'Installed host contract missing: '+name);
 assert.ok(nativeSubagentContract,'Installed host contract missing: nativeSubagentContract');
 return {observedHostVersion:version,archive,nativeSubagentContract,checks,structuralOnly:true,realExecution:false,realModelRequests:0,checkedAt:new Date().toISOString()};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),argument=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
 const archive=argument('--asar')||path.join(os.homedir(),'AppData/Local/Programs/DeepSeek Harness/resources/app.asar');
 const output=argument('--output')||path.resolve('artifacts/native-host-contract.json');
 try{
  const report=verifyHostContract(archive);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
