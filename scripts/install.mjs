import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
export async function install({source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),profile='desktop'}={}){
 if(!/^[\w-]+$/.test(profile))throw Error('Invalid profile name');
 source=await fs.realpath(source);home=path.resolve(home);
 const directory=path.join(home,'profiles',profile),manifest=path.join(directory,'package.json');
 const before=await fs.readFile(manifest,'utf8'),config=JSON.parse(before);
 const name='dsh-agent-model-router',link=path.join(directory,'node_modules',name);
 if(config.dependencies?.[name]||config.dsh?.profile?.bundles?.includes(name))throw Error('同名插件已注册，请先检查：'+manifest);
 try{await fs.lstat(link);throw Error('同名安装路径已存在，请先检查：'+link);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8')).name!==name)throw Error('Source package mismatch');
 const backupDirectory=path.join(home,'agent-model-router','backups');await fs.mkdir(backupDirectory,{recursive:true});
 const backup=path.join(backupDirectory,'profile-'+profile+'-'+Date.now()+'.json');await fs.writeFile(backup,before,{flag:'wx',mode:0o600});
 config.dependencies??={};config.dependencies[name]='file:'+source.replaceAll('\\','/');
 config.dsh??={};config.dsh.profile??={};config.dsh.profile.bundles??=[];config.dsh.profile.bundles.push(name);
 // All existing parsed fields must survive; only two plugin-owned entries may be added.
 const comparison=structuredClone(config);delete comparison.dependencies[name];comparison.dsh.profile.bundles=comparison.dsh.profile.bundles.filter(x=>x!==name);
 if(JSON.stringify(comparison)!==JSON.stringify(JSON.parse(before)))throw Error('Install would change unrelated profile fields');
 const temp=manifest+'.'+crypto.randomUUID()+'.tmp';let madeLink=false;
 try{
  await fs.mkdir(path.dirname(link),{recursive:true});await fs.symlink(source,link,process.platform==='win32'?'junction':'dir');madeLink=true;
  await fs.writeFile(temp,JSON.stringify(config,null,2)+'\n',{flag:'wx'});
  if(await fs.readFile(manifest,'utf8')!==before)throw Error('Profile changed during install; no overwrite');
  await fs.rename(temp,manifest);
 }catch(error){if(madeLink)await fs.unlink(link).catch(()=>{});throw error;}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
 return {profile,source,manifest,link,backup,changes:['dependencies.'+name,'dsh.profile.bundles + '+name],restartRequired:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await install(),null,2));
