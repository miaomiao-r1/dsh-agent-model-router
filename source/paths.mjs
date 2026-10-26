import fs from 'node:fs/promises';
import path from 'node:path';

// Resolve the closest existing ancestor too: workers frequently create new files,
// whose parent can already be a junction/symlink into another worker's directory.
async function physicalPath(file) {
  const tail=[];let current=file;
  for(;;){
    try{return path.join(await fs.realpath(current),...tail.reverse());}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const parent=path.dirname(current);
      if(parent===current)throw error;
      tail.push(path.basename(current));current=parent;
    }
  }
}
const inside=(root,file)=>{const relative=path.relative(root,file);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};

export function assertDistinctOwners(entries){
  const owners=new Map();
  for(const entry of entries){
    const key=String(entry.dev)+':'+String(entry.ino);
    if(String(entry.ino)==='0')continue;
    const prior=owners.get(key);
    if(prior&&prior.owner!==entry.owner)throw Error('overlapping hardlink worker ownership: '+prior.path+' / '+entry.path);
    owners.set(key,entry);
  }
}

export async function prepareWorkerPaths(args) {
  if(!Array.isArray(args.workTasks))return args;
  const workspace=path.resolve(args.workspace||process.cwd());
  const realWorkspace=await physicalPath(workspace),workTasks=[],identities=[];
  for(const [owner,task] of args.workTasks.entries()){
    if(!task||typeof task!=='object'||!Array.isArray(task.files)){workTasks.push(task);continue;}
    const files=[];
    for(const file of task.files){
      if(typeof file!=='string'||!file.trim()||/[*?\0]/.test(file))throw Error('worker files must be exact nonempty paths');
      // Alternate data streams and Win32 trailing-dot/space aliases are not exact
      // portable file ownership; reject them instead of assigning two spellings.
      if(process.platform==='win32'&&(file.replace(/^[a-z]:/i,'').includes(':')||file.split(/[\\/]/).some(p=>p!=='.'&&p!=='..'&&/[. ]$/.test(p))))throw Error('ambiguous Windows worker path: '+file);
      const absolute=path.resolve(workspace,file);
      if(!inside(workspace,absolute))throw Error('worker path outside the calling workspace: '+file);
      const physical=await physicalPath(absolute);
      if(!inside(realWorkspace,physical))throw Error('worker symlink escapes the calling workspace: '+file);
      try{
        const info=await fs.stat(physical,{bigint:true});
        if(info.isFile())identities.push({owner,path:physical,dev:info.dev,ino:info.ino});
      }catch(error){if(error.code!=='ENOENT')throw error;}
      files.push(physical);
    }
    workTasks.push({...task,files});
  }
  assertDistinctOwners(identities);
  return {...args,workspace:realWorkspace,workTasks};
}
