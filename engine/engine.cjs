"use strict";
// Authority for the generated inline workflow. Never edit the generated copy.
const STAGE_ROLE = { explore:"explorer", research:"researcher", implement:"worker", test:"tester", review:"reviewer", vision:"visioner", scribe:"scribe" };
const TASK_KEYS = { explore:"exploreTargets", research:"researchQuestions", implement:"workTasks", test:"testTasks", review:"reviewTasks", vision:"visionTargets", scribe:"scribeTasks" };
const STATES = {
  explorer:["done","blocked"], researcher:["done","blocked"],
  worker:["done","blocked","needs_decision","failed"],
  tester:["passed","failed","blocked"], reviewer:["clean","findings","blocked"],
  visioner:["done","blocked"], scribe:["done","blocked"]
};
const SCHEMAS=Object.fromEntries(Object.entries(STATES).map(([role,states])=>[role,{
  type:'object',required:['status','summary'],additionalProperties:true,
  properties:{status:{type:'string',enum:states},summary:{type:'string'},commands:{type:'string'},
    evidence:{type:'string'},blocking:{type:'boolean'},filesModified:{type:'array',items:{type:'string'}},
    findings:{type:'array',description:role==='reviewer'?'Concrete defects or issues only. For status clean, use an empty array; put successful checks in evidence and uncertainties in summary/uncertainties.':'Role-relevant observations or issues.',items:{type:'object',properties:{},additionalProperties:true}}}
}]));
const DEFAULT_PROMPTS = {
  explorer:"Gather repository evidence only. Do not edit files. Cite exact paths, call/data flow, existing tests, constraints and uncertainty.",
  researcher:"Verify only the delegated question using primary documentation or repository source. Do not edit files. Cite sources, versions and uncertainty.",
  worker:"Implement only the bounded task within the assigned files. You are not alone in the workspace: preserve others' changes. No unrelated refactors or unauthorized API/schema/dependency changes. Report needs_decision when scope grows. Validate actual changes.",
  tester:"Independently verify the delegated behavior. Record actual commands and results. Do not change production code. Modify tests only when explicitly authorized.",
  reviewer:"Review actual changes and test evidence independently. Do not edit files. Prioritize correctness, security, regression, concurrency, API and data integrity risks. Status clean requires blocking=false and an empty findings array. Findings are concrete defects/issues only; put successful checks in evidence, and residual uncertainty in summary or uncertainties. If defects exist, return status findings with explicit blocking. Missing required evidence means blocked.",
  visioner:"Describe only the provided images or visual inputs. Do not edit files. Report concrete findings: objects, text (OCR), layout, counts, colors, spatial relations, and uncertainty. Cite image references. If an image is unavailable or unreadable, return blocked with the reason.",
  scribe:"Handle only the delegated writing or formatting task. Do not touch core logic, code or configuration. Report what was produced, where, and any source material that was unavailable."
};
const text = v => typeof v === "string" && v.trim().length > 0;
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const posInt = v => Number.isSafeInteger(v) && v > 0;
const safePath = (value,workspace='') => {
  let absolute=value.replace(/\\/g,"/");
  if(workspace && !/^(?:[a-z]:\/|\/)/i.test(absolute))absolute=workspace.replace(/\\/g,'/')+'/'+absolute;
  if(/^[a-z]:\//i.test(absolute)||absolute.startsWith('//'))absolute=absolute.toLowerCase();
  const parts = absolute.split("/");
  const normalized=[];
  for(const part of parts) { if(!part || part==='.')continue; if(part==='..')normalized.pop();else normalized.push(part); }
  return normalized.join('/');
};

// Shared with the host-side layered runner: validate the entire request before
// any stage is allowed to start, rather than validating one split stage at a time.
function validatePlan(args={}, {requireRoles=true}={}) {
  const errors=[],tasks={},plan=args.plan===undefined?["explore","implement","test","review"]:args.plan;
  const roles=args.roles||{},cc=args.channelConcurrency||{};
  if(!text(args.task))errors.push('task must be a nonempty string');
  if(!Array.isArray(plan)||!plan.length)return {errors:[...errors,'plan must be a nonempty stage array'],tasks,plan};
  if(!object(roles)||!object(cc))errors.push('roles/channelConcurrency must be objects');
  if(args.prior!==undefined&&!object(args.prior))errors.push('prior must be an object');
  for(const key of ['constraints','acceptanceCriteria','visionInputs','visionTargets','capabilities'])if(args[key]!==undefined&&(!Array.isArray(args[key])||args[key].some(v=>!text(v))))errors.push(key+' must be an array of nonempty strings');
  for(const key of ['constraints','acceptanceCriteria'])if(args.prior?.[key]!=null&&(!Array.isArray(args.prior[key])||args.prior[key].some(v=>!text(v))))errors.push('prior.'+key+' must be an array of nonempty strings');
  if(new Set(plan).size!==plan.length)errors.push('duplicate stages not allowed');
  for(const stage of plan){
    if(!Object.hasOwn(STAGE_ROLE,stage)){errors.push('unknown stage: '+stage);continue;}
    const role=STAGE_ROLE[stage],r=roles[role];
    if((requireRoles||r!==undefined)&&(!object(r)||!text(r.provider)||!text(r.model)))errors.push('missing provider/model for '+role);
    if(r&&cc[r.provider]!==undefined&&!posInt(cc[r.provider]))errors.push('channel limit must be a positive integer: '+r.provider);
    const key=TASK_KEYS[stage],fallback=stage==='review'?'Review the assigned changes and their current evidence':args.task;
    const value=args[key]===undefined?[fallback]:args[key];
    if(!Array.isArray(value)||!value.length||value.some(v=>!text(v)&&!(object(v)&&text(v.objective))))errors.push('empty or invalid '+key);
    tasks[stage]=Array.isArray(value)?value:[];
  }
  for(const [before,after] of [['vision','explore'],['vision','research'],['vision','implement'],['vision','test'],['vision','review'],['explore','implement'],['research','implement'],['implement','test'],['implement','review'],['test','review']])if(plan.includes(before)&&plan.includes(after)&&plan.indexOf(before)>plan.indexOf(after))errors.push(before+' must precede '+after);
  const workers=tasks.implement||[];
  if(workers.length>1){
    const owners=[];
    for(const worker of workers){
      if(!object(worker)||!Array.isArray(worker.files)||!worker.files.length||worker.files.some(f=>!text(f)||/[*?]/.test(f))){errors.push('multiple workers need explicit exact file ownership');continue;}
      for(const file of worker.files){
        const canonical=safePath(file,args.workspace);
        if(!canonical||owners.some(p=>p===canonical||p.startsWith(canonical+'/')||canonical.startsWith(p+'/')))errors.push('overlapping worker ownership: '+file);
        owners.push(canonical);
      }
    }
  }
  return {errors,tasks,plan};
}

function decode(raw,role) {
  // DSH workflow agent(schema) returns null for unsuccessful runs or missing
  // structured output. The hook does not expose the child's stop reason.
  if(raw === null)
    return {status:"blocked",summary:"Host returned no structured result; inspect the child session stop reason (for example max-tokens, error, or missing structured output).",outputUnavailable:true};
  let value=raw;
  if(typeof value === "string") {
    try { value=JSON.parse(value.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"")); }
    catch { return {status:"blocked",summary:"Invalid agent result: expected JSON",invalid:true}; }
  }
  if(!object(value) || !STATES[role].includes(value.status) || !text(value.summary))
    return {status:"blocked",summary:"Invalid agent result: status/summary missing or unknown",invalid:true};
  if(role === "tester" && value.status === "passed" && (!text(value.commands) || !text(value.evidence)))
    return {status:"blocked",summary:"Passing tests require command and evidence",invalid:true};
  if(role === "reviewer" && value.status === "findings" && (typeof value.blocking !== "boolean" || !Array.isArray(value.findings) || !value.findings.length))
    return {status:"blocked",summary:"Review findings require explicit blocking boolean and nonempty findings",invalid:true};
  if(role === "reviewer" && value.status === "clean" && (value.blocking === true || (Array.isArray(value.findings) && value.findings.length)))
    return {status:"blocked",summary:"Inconsistent clean review with findings",invalid:true};
  return value;
}

async function orchestrate(args={},hooks={}) {
  const out={task:args.task ?? null,plan:args.plan===undefined?["explore","implement","test","review"]:args.plan,
    phases:{},phaseStatus:{},validationErrors:[],warnings:[],taskComplete:false};
  const roles=args.roles || {}, cc=args.channelConcurrency || {};
  const log=hooks.log || (()=>{}), phase=hooks.phase || (()=>{});
  const prior=object(args.prior)?args.prior:{};
  const evidence={explore:prior.explore ?? null,research:prior.research ?? null,
    impl:prior.impl ?? null,test:prior.test ?? null,review:prior.review ?? null,
    vision:prior.vision ?? null,
    rootPlan:prior.rootPlan ?? args.planFromRoot ?? null,
    constraints:prior.constraints ?? args.constraints ?? null,
    acceptanceCriteria:prior.acceptanceCriteria ?? args.acceptanceCriteria ?? null,
    handoffPolicy:prior.handoffPolicy ?? null};
  const validated=validatePlan(args),tasks=validated.tasks,errors=out.validationErrors;
  errors.push(...validated.errors);
  function finish(verdict) {
    out.verdict=verdict; out.canAccept=verdict==='passed';out.handoff={...evidence};
    out.summary={verdict,canAccept:out.canAccept,scope:"requested_phases",taskComplete:false,
      phases:out.phaseStatus,channelConcurrency:cc,
      note:"Phase results are agent reports, not proof of backend identity or final task acceptance. Root must verify actual artifacts and evidence."};
    return out;
  }
  if(typeof hooks.agent !== 'function' || typeof hooks.parallel !== 'function')errors.push("agent and parallel hooks required");
  if(errors.length)return finish('blocked');
  const resultInstructions=role=>"\nFinish by calling the host structured_output tool once with one JSON object matching the supplied schema; plain final text is not a structured result. Required: status ("+STATES[role].join('|')+") and nonempty summary. Keep the report concise and stop after gathering the delegated evidence. Preserve exact failures, uncertainty/unresolved questions, decisions, constraints, file locations and evidenceIndex. Read referenced full reports and actual files before relying on excerpts. Missing sources or unapproved decisions require blocked/needs_decision, not guessing. Tester passed requires nonempty commands and evidence. Reviewer findings requires findings array and explicit boolean blocking. Do not claim unperformed verification.";
  for(const stage of out.plan) {
    const role=STAGE_ROLE[stage],r=roles[role],items=tasks[stage],results=[];
    const limit=cc[r.provider] ?? 1;
    phase(stage);
    for(let offset=0;offset<items.length;offset+=limit) {
      const thunks=items.slice(offset,offset+limit).map((item,j)=>async()=>{
        const label=role+" · "+r.provider+"/"+r.model+" #"+(offset+j+1);
        const contract=object(item)?item:{objective:item};
        const custom=args.rolePrompts && args.rolePrompts[role];
        const prompt=(text(custom)?custom:DEFAULT_PROMPTS[role])+resultInstructions(role)+
          "\nOverall task: "+args.task+"\nDelegation contract: "+JSON.stringify(contract)+
          (stage==='vision'?"\nVisual inputs (use the image-reading tool on these references; never infer unreadable image contents): "+JSON.stringify([...new Set([...(args.visionInputs||[]),...(args.visionTargets||[])])]):'')+
          "\nRoot plan, constraints, acceptance and phase evidence: "+JSON.stringify(evidence);
        try {
          const value=decode(await hooks.agent(prompt,{provider:r.provider,model:r.model,label,schema:SCHEMAS[role]}),role);
          log("Completed "+label+" · "+value.status+" (requested route; backend identity unverified)");
          return value;
        } catch(error) {
          return {status:'blocked',summary:'Agent invocation threw',error:String(error?.message || error),crashed:true};
        }
      });
      // Every thunk captures invocation failures so the batch waits for all siblings.
      let batch;
      try { batch=await hooks.parallel(thunks); }
      catch(error) {results.push({status:'blocked',summary:'parallel failed',error:String(error?.message || error),crashed:true});break;}
      if(!Array.isArray(batch) || batch.length!==thunks.length) {results.push({status:'blocked',summary:'parallel returned wrong result count',invalid:true});break;}
      batch=batch.map(v=>decode(v,role));
      results.push(...batch);
      if(batch.some(v=>v.status==='blocked'||v.status==='needs_decision'||v.status==='failed'||(v.status==='findings'&&v.blocking)))break;
    }
    const blocked=results.some(v=>v.status==='blocked'||v.status==='needs_decision'||(v.status==='findings' && v.blocking));
    const failed=results.some(v=>v.status==='failed');
    const passed=results.length===items.length && !blocked && !failed;
    out.phases[stage]=results.length===1?results[0]:results;
    evidence[stage==='implement'?'impl':stage]=out.phases[stage];
    out.phaseStatus[stage]={executed:results.length>0,count:results.length,expected:items.length,passed,failed,blocked};
    if(!passed) {
      for(const pending of out.plan.slice(out.plan.indexOf(stage)+1))out.phaseStatus[pending]={executed:false,skipped:true,reason:'previous phase did not pass'};
      return finish(blocked?'blocked':'failed');
    }
  }
  return finish('passed');
}
module.exports={orchestrate,validatePlan,STAGE_ROLE,DEFAULT_PROMPTS,SCHEMAS,posInt,decode,STATES};
