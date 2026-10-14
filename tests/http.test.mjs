import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHttpHandler} from '../source/http.mjs';
async function fixture(fn){
 const calls=[];
 const service={view:async()=>{calls.push('read');return {settings:{version:1,enabled:false},catalogue:{ok:true,models:[]}};},save:async body=>{calls.push(body);return {version:2};},setEnabled:async body=>{calls.push(body);return {version:2,enabled:body.enabled};}};
 const connection={admit:req=>req.headers.authorization==='Bearer fixture'?{peer:{}}:{rejection:401}};
 const server=createServer(createHttpHandler({service,connection}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await fn({calls,service,url:'http://127.0.0.1:'+server.address().port,headers:{authorization:'Bearer fixture','content-type':'application/json'}});}finally{await new Promise(r=>server.close(r));}
}
test('anonymous requests cannot read or save role settings',async()=>fixture(async f=>{const r=await fetch(f.url+'/agent-model-router/state');assert.equal(r.status,401);assert.equal(f.calls.length,0);}));
test('page opening fetches current state with no cache',async()=>fixture(async f=>{const r=await fetch(f.url+'/agent-model-router/state',{headers:f.headers});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(f.calls,['read']);}));
test('mode change uses authenticated dedicated endpoint',async()=>fixture(async f=>{const r=await fetch(f.url+'/agent-model-router/mode',{method:'POST',headers:f.headers,body:JSON.stringify({enabled:true,expectedVersion:1})});assert.equal(r.status,200);assert.equal((await r.json()).settings.enabled,true);assert.deepEqual(f.calls,[{enabled:true,expectedVersion:1}]);}));
test('version conflict is surfaced without success response',async()=>fixture(async f=>{f.service.save=async()=>{throw Object.assign(Error('stale'),{status:409,code:'CONFLICT'});};const r=await fetch(f.url+'/agent-model-router/settings',{method:'POST',headers:f.headers,body:'{}'});assert.equal(r.status,409);assert.equal((await r.json()).code,'CONFLICT');}));
test('non JSON writes are rejected',async()=>fixture(async f=>{const r=await fetch(f.url+'/agent-model-router/settings',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'text/plain'},body:'{}'});assert.equal(r.status,415);assert.equal(f.calls.length,0);}));
test('oversize writes never reach persistence',async()=>fixture(async f=>{const r=await fetch(f.url+'/agent-model-router/settings',{method:'POST',headers:f.headers,body:JSON.stringify({padding:'x'.repeat(70000)})});assert.equal(r.status,413);assert.equal(f.calls.length,0);}));
