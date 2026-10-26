import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyUnpacked} from '../scripts/verify-package.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'amr-package-test-'));
  t.after(async()=>{
    assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));
    await fs.rm(directory,{recursive:true,force:true});
  });
  for(const file of ['package.json','index.js','client.js','cordis.patch.yml','source','engine','scripts','LICENSE','THIRD-PARTY-LICENSE.txt','README.md']){
    await fs.cp(path.join(root,file),path.join(directory,file),{recursive:true});
  }
  return directory;
}
test('release verifier rejects an archive missing the workflow loaded at runtime',async t=>{
  const directory=await fixture(t);
  await fs.unlink(path.join(directory,'engine/orchestrate.workflow.js'));
  await assert.rejects(verifyUnpacked(directory),/orchestrate\.workflow\.js/);
});
test('release verifier rejects a manifest entry that leaves the installed package',async t=>{
  const directory=await fixture(t);
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
  manifest.main='../index.js';
  await fs.writeFile(path.join(directory,'package.json'),JSON.stringify(manifest));
  await assert.rejects(verifyUnpacked(directory),/outside|包外/);
});
test('release verifier accepts a complete package including a workflow function body',async t=>{
  const directory=await fixture(t);
  const result=await verifyUnpacked(directory);
  assert.equal(result.name,'dsh-agent-model-router');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
  assert.equal(result.version,manifest.version);
  assert.match(result.buildId,/^[a-f0-9]{64}$/);
  assert.equal(result.minimumNode,'22.13.0');
});
