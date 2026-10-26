import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

test('physical file identities reject different owners even with different path names',async()=>{
 const api=await import('../source/paths.mjs');assert.equal(typeof api.assertDistinctOwners,'function');
 assert.throws(()=>api.assertDistinctOwners([{owner:0,path:'one.txt',dev:5n,ino:42n},{owner:1,path:'two.txt',dev:5n,ino:42n}]),/hardlink|overlap/i);
 assert.doesNotThrow(()=>api.assertDistinctOwners([{owner:0,path:'one.txt',dev:5n,ino:42n},{owner:0,path:'two.txt',dev:5n,ino:42n},{owner:1,path:'other.txt',dev:6n,ino:42n}]));
});

test('resolved archive locations must stay within their physical archive root',async()=>{
 const api=await import('../source/runs.mjs');assert.equal(typeof api.assertRunLocation,'function');
 const root=path.resolve('artifacts/runs');
 assert.doesNotThrow(()=>api.assertRunLocation(root,path.join(root,'a'.repeat(64))));
 assert.throws(()=>api.assertRunLocation(root,path.resolve('outside-archive')),/outside|归档/i);
});
