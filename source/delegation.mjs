export function assessDelegation(value={}){
 if(!Number.isSafeInteger(value.scopeCount)||value.scopeCount<1)throw Error('scopeCount 必须为正整数');
 if(value.risk!==undefined&&!['low','medium','high'].includes(value.risk))throw Error('risk 必须为 low/medium/high');
 for(const key of ['explicitRequest','needsIndependentCheck'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error(key+' 必须为布尔值');
 if(value.bounded!==undefined&&typeof value.bounded!=='boolean')throw Error('bounded 必须为布尔值');
 if(value.taskKind!==undefined&&!['conversation','exploration','implementation','testing','research','review','vision','decision'].includes(value.taskKind))throw Error('taskKind 无效');
 if(value.effort!==undefined&&!['small','substantial'].includes(value.effort))throw Error('effort 必须为 small/substantial');
 if(value.complexity!==undefined&&!['simple','moderate','complex'].includes(value.complexity))throw Error('complexity 必须为 simple/moderate/complex');
 const complexity=value.complexity||'moderate';
 const ownsDecision=value.taskKind==='decision'||complexity==='complex';
 const usefulSingle=value.bounded===true&&value.effort==='substantial'&&['exploration','implementation','testing','research','review','vision'].includes(value.taskKind);
 const route=!ownsDecision&&(value.explicitRequest||value.needsIndependentCheck||value.scopeCount>1||usefulSingle)?'delegate':'root';
 return {route,complexity,reason:ownsDecision?(complexity==='complex'?'复杂度为 complex，方案与决策由根代理（Manager）处理':'方案与高风险决策由根代理处理'):value.explicitRequest?'用户明确要求多代理':value.needsIndependentCheck?'需要独立验证或审查':usefulSingle?'边界明确且工作量足够，单范围也可委派':value.scopeCount>1?'存在多个工作范围，可委派已明确的执行部分':'简单或尚未明确的任务由根代理处理',managerOwnsDecisions:true,parallelAllowed:false,note:'范围数不等于工作量。多个范围不自动授权并行；根保留决策与最终验收。'};
}
