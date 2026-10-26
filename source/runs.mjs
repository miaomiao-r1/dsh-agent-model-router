import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {acquireLock,releaseLock} from './lock.mjs';

function stable(value){
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const digest=value=>createHash('sha256').update(stable(value)).digest('hex');

export function assertRunLocation(root,folder){
 const relative=path.relative(root,folder);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('operation directory is outside the physical archive root');
}

export class RunLedger{
 static async open({directory,request,owner}){
  const {operationId,resumeFrom,...args}=request.args;
  if(operationId!==undefined&&(typeof operationId!=='string'||!operationId.trim()||operationId.length>160))throw Error('operationId must be a nonempty string of at most 160 characters');
  if(resumeFrom!==undefined&&(typeof resumeFrom!=='string'||!/^[a-f0-9]{64}$/.test(resumeFrom)))throw Error('invalid resumeFrom operation identifier');
  const fingerprint=digest({args,script:request.script||''});
  const id=resumeFrom||digest({owner,key:operationId||fingerprint});
  await fs.mkdir(directory,{recursive:true});
  const archiveRoot=await fs.realpath(directory);
  const folder=path.join(archiveRoot,id);
  await fs.mkdir(folder,{recursive:true});
  if((await fs.lstat(folder)).isSymbolicLink())throw Error('operation archive directory must not be a symlink/junction');
  assertRunLocation(archiveRoot,await fs.realpath(folder));
  for(const name of ['ledger.json','execution.sqlite']){
   try{
    const info=await fs.lstat(path.join(folder,name));
    if(info.isSymbolicLink())throw Error('operation archive file must not be a symlink: '+name);
    if(info.nlink>1)throw Error('operation archive file must not be a hardlink with multiple links: '+name);
   }
   catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const lease=await acquireLock(path.join(folder,'execution'));
  const ledger=new RunLedger();Object.assign(ledger,{id,folder,lease,file:path.join(folder,'ledger.json')});
  try{
   try{ledger.value=JSON.parse(await fs.readFile(ledger.file,'utf8'));}
   catch(error){if(error.code!=='ENOENT')throw error;if(resumeFrom)throw Error('resume operation does not exist');}
   if(ledger.value){
    if(ledger.value.schema!==1||ledger.value.id!==id)throw Error('invalid operation ledger');
    if(ledger.value.owner!==owner)throw Error('operation belongs to a different session owner');
    if(ledger.value.fingerprint!==fingerprint)throw Error('operation input fingerprint changed; use a new operationId');
   }else ledger.value={schema:1,id,owner,fingerprint,attempt:0,checkpoint:null,outcome:null,active:null};
   return ledger;
  }catch(error){await ledger.close();throw error;}
 }
 async save(change){
  const value={...this.value,...change,updatedAt:Date.now()};
  const temp=this.file+'.'+randomUUID()+'.tmp';
  let handle;
  try{
   handle=await fs.open(temp,'wx',0o600);
   await handle.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await handle.sync();await handle.close();handle=null;
   await fs.rename(temp,this.file);this.value=value;
  }finally{await handle?.close().catch(()=>{});await fs.rm(temp,{force:true}).catch(()=>{});}
 }
 async close(){if(this.lease){await releaseLock(this.lease);this.lease=null;}}
}
