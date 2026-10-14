import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const required=['index.js','client.js','cordis.patch.yml','source/defaults.mjs','source/store.mjs','source/router.mjs','source/http.mjs','source/delegation.mjs','source/handoff.mjs','engine/engine.cjs','engine/orchestrate.workflow.js','scripts/install.mjs','scripts/uninstall.mjs','LICENSE','THIRD-PARTY-LICENSE.txt','README.md'];
function inside(directory,file){
  assert.equal(typeof file,'string','Manifest entry must be a path');
  const target=path.resolve(directory,file),relative=path.relative(directory,target);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Manifest entry is outside package / 包外路径');
  return target;
}
export async function verifyUnpacked(directory){
  directory=path.resolve(directory);
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
  assert.equal(manifest.name,'dsh-agent-model-router');
  assert.equal(manifest.dsh.version,manifest.version,'DSH and package versions must match');
  for(const entry of [manifest.main,manifest.exports['.'],manifest.exports['./client'],manifest.dsh.bundle.patch]){
    assert.ok((await fs.stat(inside(directory,entry))).isFile());
  }
  for(const file of required){
    assert.ok((await fs.stat(path.join(directory,file))).isFile(),'Missing runtime file: '+file);
    if(file.endsWith('.workflow.js')){
      // DSH evaluates workflow scripts inside an async function; top-level return is valid there.
      const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
      new AsyncFunction('args','agent','parallel','phase','log',await fs.readFile(path.join(directory,file),'utf8'));
    }else if(/\.(?:js|mjs|cjs)$/.test(file))execFileSync(process.execPath,['--check',path.join(directory,file)],{windowsHide:true,stdio:'pipe'});
  }
  const patch=await fs.readFile(path.join(directory,manifest.dsh.bundle.patch),'utf8');
  assert.match(patch,/id: dsh-agent-model-router/);
  assert.match(patch,/name: dsh-agent-model-router/);
  const host=await import(pathToFileURL(path.join(directory,manifest.main)).href);
  assert.equal(typeof host.apply,'function');
  assert.deepEqual(host.inject,['llm','tools']);
  return {name:manifest.name,version:manifest.version,runtimeFiles:required.length};
}

async function verifyRelease(){
  assert.ok(process.env.npm_execpath,'Run this script using npm run verify:package');
  const artifacts=path.join(root,'artifacts');
  await fs.mkdir(artifacts,{recursive:true});
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'amr-release-'));
  try{
    const packed=JSON.parse(execFileSync(process.execPath,[process.env.npm_execpath,'pack','--json','--ignore-scripts','--pack-destination',artifacts,'--cache',path.join(scratch,'cache')],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:2*1024*1024}))[0];
    const archive=inside(artifacts,packed.filename);
    const extract=path.join(scratch,'extracted');await fs.mkdir(extract);
    const tar=process.platform==='win32'?path.join(process.env.SystemRoot||'C:/Windows','System32','tar.exe'):'tar';
    execFileSync(tar,['-xzf',archive,'-C',extract],{windowsHide:true,stdio:'pipe'});
    const installed=path.join(extract,'package'),metadata=await verifyUnpacked(installed);
    for(const file of required){
      assert.deepEqual(await fs.readFile(path.join(installed,file)),await fs.readFile(path.join(root,file)),'Packed file differs: '+file);
    }
    // This checks the development installer against an extracted archive, not the native DSH CLI.
    const home=path.join(scratch,'dsh-home'),profileDirectory=path.join(home,'profiles','desktop');
    await fs.mkdir(profileDirectory,{recursive:true});
    const original={name:'isolated-release-verification',dependencies:{existing:'1.0.0'},dsh:{profile:{bundles:['existing']}},unrelated:{keep:true}};
    const profileManifest=path.join(profileDirectory,'package.json');
    await fs.writeFile(profileManifest,JSON.stringify(original));
    const {install}=await import(pathToFileURL(path.join(installed,'scripts/install.mjs')).href);
    const {uninstall}=await import(pathToFileURL(path.join(installed,'scripts/uninstall.mjs')).href);
    const result=await install({source:installed,home});
    assert.equal(await fs.realpath(result.link),await fs.realpath(installed));
    await uninstall({home});
    assert.deepEqual(JSON.parse(await fs.readFile(profileManifest,'utf8')),original);
    console.log(JSON.stringify({...metadata,archive,bytes:packed.size,integrity:packed.integrity,archiveVerified:true,developmentInstallerRoundTrip:true,nativeDshInstall:'not tested',realOrchestration:'not tested'},null,2));
  }finally{
    assert.equal(path.dirname(scratch),path.resolve(os.tmpdir()));
    assert.ok(path.basename(scratch).startsWith('amr-release-'));
    await fs.rm(scratch,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  verifyRelease().catch(error=>{console.error(error);process.exitCode=1;});
}
