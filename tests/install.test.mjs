import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {install} from '../scripts/install.mjs';
import {uninstall} from '../scripts/uninstall.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('installation adds only its own registration and uninstall preserves unrelated fields',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'amr-install-'));const directory=path.join(home,'profiles','desktop');await fs.mkdir(directory,{recursive:true});
 const original={name:'test',dependencies:{existing:'1.0'},dsh:{profile:{bundles:['existing']}},unrelated:{keep:'yes'}};const manifest=path.join(directory,'package.json');await fs.writeFile(manifest,JSON.stringify(original));
 try{const installed=await install({home,source});assert.equal(await fs.realpath(installed.link),await fs.realpath(source));const after=JSON.parse(await fs.readFile(manifest,'utf8'));assert.equal(after.unrelated.keep,'yes');assert.equal(after.dependencies.existing,'1.0');await assert.rejects(install({home,source}),/同名/);await uninstall({home});assert.deepEqual(JSON.parse(await fs.readFile(manifest,'utf8')),original);assert(await fs.stat(source));assert(await fs.stat(path.join(home,'agent-model-router','backups')));}finally{await fs.rm(home,{recursive:true,force:true});}
});

test('uninstall removes its bundle without creating dependencies',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'amr-uninstall-bundle-'));const directory=path.join(home,'profiles','desktop');await fs.mkdir(directory,{recursive:true});
 const original={dsh:{profile:{bundles:['dsh-agent-model-router','existing']}}};const manifest=path.join(directory,'package.json');await fs.writeFile(manifest,JSON.stringify(original));
 try{await uninstall({home});const after=JSON.parse(await fs.readFile(manifest,'utf8'));assert.deepEqual(after,{dsh:{profile:{bundles:['existing']}}});assert.equal(Object.hasOwn(after,'dependencies'),false);}finally{await fs.rm(home,{recursive:true,force:true});}
});

test('uninstall removes its dependency without creating dsh profile fields',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'amr-uninstall-dependency-'));const directory=path.join(home,'profiles','desktop');await fs.mkdir(directory,{recursive:true});
 const original={dependencies:{'dsh-agent-model-router':'file:link'},unrelated:{keep:true}};const manifest=path.join(directory,'package.json');await fs.writeFile(manifest,JSON.stringify(original));
 try{await uninstall({home});const after=JSON.parse(await fs.readFile(manifest,'utf8'));assert.deepEqual(after,{dependencies:{},unrelated:{keep:true}});assert.equal(Object.hasOwn(after,'dsh'),false);}finally{await fs.rm(home,{recursive:true,force:true});}
});

test('uninstall restores the manifest and preserves the link when unlink fails',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'amr-uninstall-unlink-failure-'));const directory=path.join(home,'profiles','desktop');await fs.mkdir(directory,{recursive:true});
 const original={name:'test',dependencies:{existing:'1.0'},dsh:{profile:{bundles:['existing']}},unrelated:{keep:'yes'}};const manifest=path.join(directory,'package.json');await fs.writeFile(manifest,JSON.stringify(original));
 let link;let patched=false;const originalUnlink=fs.unlink;
 try{
  const installed=await install({home,source});link=installed.link;const beforeUninstall=await fs.readFile(manifest,'utf8');const error=Object.assign(new Error('blocked unlink'),{code:'EACCES'});fs.unlink=async target=>{if(path.resolve(target)===path.resolve(link))throw error;return originalUnlink(target);};patched=true;
  await assert.rejects(uninstall({home}),caught=>caught===error);assert.equal(await fs.readFile(manifest,'utf8'),beforeUninstall);assert(await fs.lstat(link));
 }finally{if(patched)fs.unlink=originalUnlink;await fs.rm(home,{recursive:true,force:true});}
});

test('uninstall propagates lstat errors other than ENOENT',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'amr-uninstall-lstat-failure-'));const directory=path.join(home,'profiles','desktop');await fs.mkdir(directory,{recursive:true});
 const manifest=path.join(directory,'package.json');await fs.writeFile(manifest,JSON.stringify({dependencies:{},dsh:{profile:{bundles:[]}}}));
 let patched=false;const originalLstat=fs.lstat;
 try{
  const installed=await install({home,source});const before=await fs.readFile(manifest,'utf8');const error=Object.assign(new Error('blocked lstat'),{code:'EACCES'});fs.lstat=async target=>{if(path.resolve(target)===path.resolve(installed.link))throw error;return originalLstat(target);};patched=true;
  await assert.rejects(uninstall({home}),caught=>caught===error);assert.equal(await fs.readFile(manifest,'utf8'),before);
 }finally{if(patched)fs.lstat=originalLstat;await fs.rm(home,{recursive:true,force:true});}
});
