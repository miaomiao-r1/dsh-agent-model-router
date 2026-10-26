import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../client.js',import.meta.url),'utf8');
function load(){let plugin;const document={createElement:()=>({setAttribute(){},remove(){}}),head:{appendChild(){}}};const React={createElement:(...args)=>args};vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(name=>{assert.equal(name,'react');return React;});}}},document,fetch:()=>{throw Error('No requests during registration');}});return plugin;}
test('left navigation and page register the same ID',()=>{const plugin=load(),slots=[];plugin.apply({effect:fn=>fn(),slots:{inject:(name,fn)=>fn(),register:(entry,view)=>{slots.push({entry,view});return()=>{};}}});assert.equal(slots[0].entry.name,'sidebar.panellist');assert.equal(slots[0].entry.id,'agent-model-router');assert.equal(slots[0].entry.label(),'代理模型');assert.equal(slots[1].entry.key,slots[0].entry.id);});
test('exact model ID with slash and casing survives selection key',()=>{const plugin=load();assert.equal(plugin.__test.routeKey({provider:'our-free-model',model:'moonshotai/Kimi-K3'}),'["our-free-model","moonshotai/Kimi-K3"]');});
test('search and provider filter preserve distinct route IDs',()=>{const plugin=load();const models=[{provider:'trae',model:'a',name:'GLM',providerName:'TRAE'},{provider:'codearts',model:'GLM-5.2',name:'GLM',providerName:'CodeArts'}];assert.equal(plugin.__test.filteredModels(models,'glm','codearts').length,1);assert.equal(plugin.__test.filteredModels(models,'GLM-5.2','')[0].model,'GLM-5.2');});
test('interface includes new-session save wording and immediate mode switch',()=>{assert.match(source,/后续启动的新会话生效/);assert.match(source,/role:'switch'/);assert.match(source,/保存设置/);assert.match(source,/React\.useEffect/);assert.match(source,/visibilitychange/);});
test('page copy advertises the whole harness catalogue instead of one plugin',()=>{assert.match(source,/DeepSeek Harness/);assert.match(source,/注册的全部通道/);assert.match(source,/插件不内置通道白名单/);assert.doesNotMatch(source,/目录来自 dsh-our-free-model/);});
test('vision modality hint appears only when an adapter explicitly declares text-only input',()=>{const plugin=load();const warning='该模型未声明图片输入能力，识图阶段可能失败。';assert.equal(plugin.__test.modalityWarning('visioner',{inputModalities:['text']}),warning);assert.equal(plugin.__test.modalityWarning('visioner',{inputModalities:['text','image']}),'');assert.equal(plugin.__test.modalityWarning('visioner',{}),'');assert.equal(plugin.__test.modalityWarning('visioner',undefined),'');assert.equal(plugin.__test.modalityWarning('worker',{inputModalities:['text']}),'');});
test('role list includes the visioner role for image recognition',()=>{const plugin=load();assert.ok(plugin.__test.ROLES.some(([role])=>role==='visioner'));});

test('runtime display reports the loaded build and explains reload rather than new-session recovery',()=>{
 const plugin=load();assert.equal(typeof plugin.__test.runtimeText,'function');
 const text=plugin.__test.runtimeText({version:'1.0.0-rc.2',loadedBuildId:'a'.repeat(64),nodeVersion:'v24.15.0',reloadRequired:true,capabilities:{toolGuard:true,dispatchMiddleware:true}});
 assert.match(text.summary,/1\.0\.0-rc\.2/);assert.match(text.summary,/aaaaaaaaaaaa/);
 assert.match(text.warning,/重载|重新加载/);assert.match(text.warning,/新建会话/);
});
