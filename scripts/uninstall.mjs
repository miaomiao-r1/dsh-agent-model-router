import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
export async function uninstall({home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),profile='desktop'}={}){
 if(!/^[\w-]+$/.test(profile))throw Error('Invalid profile');
 const file=path.join(home,'profiles',profile,'package.json'),before=await fs.readFile(file,'utf8'),config=JSON.parse(before),name='dsh-agent-model-router';
 if(!config.dependencies?.[name]&&!config.dsh?.profile?.bundles?.includes(name))return {removed:false};
 const link=path.join(home,'profiles',profile,'node_modules',name),item=await fs.lstat(link).catch(()=>null);
 if(item&&!item.isSymbolicLink())throw Error('安装位置不是本插件链接，停止以免删除用户文件：'+link);
 delete config.dependencies[name];config.dsh.profile.bundles=config.dsh.profile.bundles.filter(x=>x!==name);
 const backupDirectory=path.join(home,'agent-model-router','backups');await fs.mkdir(backupDirectory,{recursive:true});await fs.writeFile(path.join(backupDirectory,'uninstall-'+Date.now()+'.json'),before,{flag:'wx'});
 const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(config,null,2)+'\n',{flag:'wx'});if(await fs.readFile(file,'utf8')!==before)throw Error('Profile changed; no overwrite');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
 if(item)await fs.unlink(link);
 return {removed:true,settingsPreserved:true,sourcePreserved:true,restartRequired:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await uninstall(),null,2));
