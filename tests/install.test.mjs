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
