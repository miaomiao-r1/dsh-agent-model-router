import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
async function restoreManifest(file,expected,before,backup){
 const changed=()=>Object.assign(new Error(`Profile changed during failed uninstall; not restored. Restore manually from backup: ${backup}`),{code:'ERR_PROFILE_CHANGED'});
 let current;try{current=await fs.readFile(file,'utf8');}catch(error){throw new Error(`Cannot verify profile after failed uninstall. Restore manually from backup: ${backup}`,{cause:error});}
 if(current!==expected)throw changed();
 const temp=file+'.'+crypto.randomUUID()+'.restore.tmp';
 try{
  await fs.writeFile(temp,before,{flag:'wx'});
  current=await fs.readFile(file,'utf8');if(current!==expected)throw changed();
  await fs.rename(temp,file);
 }catch(error){if(error.code==='ERR_PROFILE_CHANGED')throw error;throw new Error(`Could not restore profile after failed uninstall. Restore manually from backup: ${backup}`,{cause:error});}
 finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
export async function uninstall({home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),profile='desktop'}={}){
 if(!/^[\w-]+$/.test(profile))throw Error('Invalid profile');
 const file=path.join(home,'profiles',profile,'package.json'),before=await fs.readFile(file,'utf8'),config=JSON.parse(before),name='dsh-agent-model-router';
 const hasDependency=Object.hasOwn(config.dependencies??{},name),bundles=config.dsh?.profile?.bundles,hasBundle=Array.isArray(bundles)&&bundles.includes(name);
 if(!hasDependency&&!hasBundle)return {removed:false};
 const link=path.join(home,'profiles',profile,'node_modules',name);let item;
 try{item=await fs.lstat(link);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(item&&!item.isSymbolicLink())throw Error('安装位置不是本插件链接，停止以免删除用户文件：'+link);
 if(hasDependency)delete config.dependencies[name];if(hasBundle)config.dsh.profile.bundles=bundles.filter(x=>x!==name);
 const backupDirectory=path.join(home,'agent-model-router','backups');await fs.mkdir(backupDirectory,{recursive:true});const backup=path.join(backupDirectory,'uninstall-'+Date.now()+'.json');await fs.writeFile(backup,before,{flag:'wx',mode:0o600});
 const updated=JSON.stringify(config,null,2)+'\n',temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,updated,{flag:'wx'});if(await fs.readFile(file,'utf8')!==before)throw Error('Profile changed; no overwrite');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
 if(item){try{await fs.unlink(link);}catch(error){if(error.code!=='ENOENT'){await restoreManifest(file,updated,before,backup);throw error;}}}
 return {removed:true,settingsPreserved:true,sourcePreserved:true,restartRequired:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await uninstall(),null,2));
