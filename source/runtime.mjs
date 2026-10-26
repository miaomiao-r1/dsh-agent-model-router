import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');

function readBuild(root){
 const files=['package.json','index.js','client.js','engine/engine.cjs','engine/orchestrate.workflow.js',
  ...fs.readdirSync(path.join(root,'source')).filter(name=>name.endsWith('.mjs')).map(name=>'source/'+name)].sort();
 const parts=files.map(file=>file+'\0'+hash(fs.readFileSync(path.join(root,file))));
 return {buildId:hash(parts.join('\n')),scriptHash:hash(fs.readFileSync(path.join(root,'engine/orchestrate.workflow.js'))),version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version};
}

// Capture this when the plugin is applied. Re-reading files later does not prove
// that Node's already-imported modules or the browser module have been reloaded.
export class RuntimeDiagnostics{
 constructor({root,capabilities={}}){
  this.root=root;this.capabilities=capabilities;this.loaded=readBuild(root);this.loadedAt=Date.now();
 }
 status(){
  let disk,error;
  try{disk=readBuild(this.root);}catch(e){error=String(e.message||e);}
  const capabilities=typeof this.capabilities==='function'?this.capabilities():this.capabilities;
  return {version:this.loaded.version,diskVersion:disk?.version??null,nodeVersion:process.version,minimumNode:'22.13.0',loadedAt:this.loadedAt,
   loadedBuildId:this.loaded.buildId,diskBuildId:disk?.buildId??null,loadedScriptHash:this.loaded.scriptHash,diskScriptHash:disk?.scriptHash??null,
   reloadRequired:!disk||disk.buildId!==this.loaded.buildId,capabilities:{...capabilities},
   ...(error?{error}:{}),hostContract:'tools.guard + tools/execute + sandbox/mode',
   verification:'Capability detection and build identity are not proof of a completed real-model acceptance run.'};
 }
}
