export function assessDelegation(value={}){
 if(!Number.isSafeInteger(value.scopeCount)||value.scopeCount<1)throw Error('scopeCount 必须为正整数');
 if(value.risk!==undefined&&!['low','medium','high'].includes(value.risk))throw Error('risk 必须为 low/medium/high');
 for(const key of ['explicitRequest','needsIndependentCheck'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error(key+' 必须为布尔值');
 const route=value.explicitRequest||value.needsIndependentCheck||value.scopeCount>1?'delegate':'root';
 return {route,reason:value.explicitRequest?'用户明确要求多代理':value.needsIndependentCheck?'需要独立验证或审查':value.scopeCount>1?'存在多个工作范围，可委派已明确的执行部分':'单范围任务由根代理处理',managerOwnsDecisions:true,parallelAllowed:false,note:'多个范围不自动代表可以并行；模糊需求与高风险决策仍由根负责。这是显式任务评估，不是文本自动分类。'};
}
