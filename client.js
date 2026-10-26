(() => {
  window.__ModuleLoader__.load({id:'dsh-agent-model-router',factory:(require)=>{
    const React=require('react'),el=React.createElement;
    const ROLES=[['visioner','识图','识别图片内容、文字与布局'],['explorer','探索','定位代码、文件和执行路径'],['worker','实现','按明确范围完成改动'],['tester','验证','执行测试并核对结果'],['researcher','查证','核实文档与技术事实'],['reviewer','审查','独立检查变更与风险'],['scribe','文书','格式化、整理与文档搬运']];
    const routeKey=r=>JSON.stringify([r.provider,r.model]);
    const clone=v=>JSON.parse(JSON.stringify(v));
    function filteredModels(models,query,provider){const q=query.trim().toLowerCase();return models.filter(m=>(!provider||m.provider===provider)&&(!q||[m.name,m.model,m.provider,m.providerName].join(' ').toLowerCase().includes(q)));}
    // Modality metadata is available only when the adapter advertises it. An
    // absent declaration means "unknown", not "text only", so the hint appears
    // only when the selected model explicitly declares text-only input.
    function modalityWarning(role,model){if(role!=='visioner'||!Array.isArray(model?.inputModalities))return '';return model.inputModalities.includes('image')?'':'该模型未声明图片输入能力，识图阶段可能失败。';}
    function runtimeText(runtime){
      if(!runtime)return {summary:'宿主尚未提供运行构建信息',warning:'请重新加载插件后查看实际运行版本。'};
      const summary='已加载 '+runtime.version+' · 构建 '+String(runtime.loadedBuildId||'未知').slice(0,12)+' · Node '+runtime.nodeVersion;
      const warning=runtime.reloadRequired?'源码与已加载构建不同，请重新加载本插件；仅新建会话不能加载新代码。':!runtime.capabilities?.toolGuard||!runtime.capabilities?.dispatchMiddleware?'宿主缺少角色边界所需的工具 guard / 执行中间件，请核对兼容版本。':'';
      return {summary,warning};
    }
    async function request(url,options={}){const response=await fetch('/agent-model-router/'+url,{...options,credentials:'same-origin',cache:'no-store'});let body;try{body=await response.json();}catch{throw Error('插件接口没有返回有效结果，请检查加载状态');}if(!response.ok)throw Object.assign(Error(body.error||'请求失败'),{status:response.status});return body;}
    const CSS=`
      .amr-page{--amr-bg:var(--dsw-alias-bg-module-platform,#fff);--amr-text:var(--dsw-alias-label-primary,#20242b);--amr-muted:var(--dsw-alias-label-secondary,#7a818d);--amr-line:rgba(128,140,160,.2);color:var(--amr-text);background:var(--amr-bg);height:100%;overflow:auto;font:inherit}
      .amr-content{max-width:920px;margin:0 auto;padding:48px 40px 36px}.amr-kicker{font-size:12px;color:var(--amr-muted);letter-spacing:.08em;margin-bottom:12px}.amr-title{font-size:28px;letter-spacing:-.03em;font-weight:650;margin:0 0 12px}.amr-sub{color:var(--amr-muted);line-height:1.8;font-size:14px;margin:0}.amr-header{margin-bottom:30px}.amr-global{display:inline-flex;align-items:center;gap:6px;font-size:12px;border:1px solid var(--amr-line);border-radius:20px;padding:5px 10px;margin-top:14px;color:var(--amr-muted)}
      .amr-mode{display:flex;align-items:center;justify-content:space-between;border:1px solid var(--amr-line);border-radius:12px;padding:17px 20px;margin-bottom:24px}.amr-mode-title{font-size:14px;font-weight:600}.amr-mode-hint{font-size:12px;color:var(--amr-muted);margin-top:5px;line-height:1.6}.amr-switch{width:44px;height:25px;border:0;border-radius:20px;padding:3px;background:#9da5b1;cursor:pointer;flex-shrink:0;margin-left:16px}.amr-switch[aria-checked=true]{background:#4c80ef}.amr-switch span{display:block;width:19px;height:19px;border-radius:50%;background:white;transition:transform .15s}.amr-switch[aria-checked=true] span{transform:translateX(19px)}.amr-switch:disabled{opacity:.4;cursor:default}.amr-switch:focus-visible{outline:2px solid #5689ff;outline-offset:3px}
      .amr-toolbar{display:flex;gap:12px;margin-bottom:18px;align-items:center}.amr-field{min-width:0;color:inherit;background:transparent;border:1px solid var(--amr-line);border-radius:9px;padding:10px 12px;line-height:1.5;font:inherit;font-size:13px}.amr-search{flex:1}.amr-field:focus-visible,.amr-btn:focus-visible{outline:2px solid #5689ff;outline-offset:2px}.amr-model{width:100%;max-width:100%}.amr-field option,.amr-field optgroup{background:var(--amr-bg);color:var(--amr-text)}
      .amr-rows{border:1px solid var(--amr-line);border-radius:12px;overflow:hidden}.amr-row{display:grid;grid-template-columns:38px minmax(170px,1fr) minmax(220px,1.3fr);gap:16px;padding:22px;align-items:center;border-bottom:1px solid var(--amr-line)}.amr-row:last-child{border-bottom:0}.amr-icon{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid var(--amr-line);border-radius:9px;color:#5480d5;font-size:12px;font-weight:650}.amr-label{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}.amr-role{font-size:12px;color:var(--amr-muted);font-weight:400}.amr-desc{font-size:12px;margin-top:7px;color:var(--amr-muted);line-height:1.5}.amr-route{font-size:11px;color:var(--amr-muted);margin-top:7px;overflow-wrap:anywhere}.amr-warning{color:#bf792b;font-size:12px;margin-top:6px}
      .amr-footer{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:22px}.amr-note{font-size:12px;color:var(--amr-muted);line-height:1.7}.amr-actions{display:flex;gap:10px;flex-shrink:0}.amr-btn{font:inherit;font-size:13px;padding:9px 16px;border-radius:8px;border:1px solid var(--amr-line);background:transparent;color:inherit;cursor:pointer}.amr-btn-primary{background:#4c80ef;border-color:#4c80ef;color:white}.amr-btn:disabled{opacity:.4;cursor:default}.amr-message{margin:16px 0;padding:12px 14px;border-radius:8px;font-size:13px;line-height:1.6;background:rgba(80,125,215,.08);color:inherit}.amr-error{background:rgba(190,95,55,.1);color:#b5663d}.amr-empty{padding:28px 0;color:var(--amr-muted)}
      @media(prefers-color-scheme:dark){.amr-page{--amr-bg:var(--dsw-alias-bg-module-platform,#17191d);--amr-text:var(--dsw-alias-label-primary,#e3e6ed);--amr-muted:var(--dsw-alias-label-secondary,#9299a6)}.amr-error{color:#dda27b}}
      @media(max-width:700px){.amr-content{padding:28px 18px}.amr-title{font-size:24px}.amr-toolbar{flex-wrap:wrap}.amr-search{flex-basis:100%}.amr-row{grid-template-columns:32px 1fr;padding:18px 14px;gap:12px}.amr-selection{grid-column:2}.amr-footer{align-items:flex-start;flex-direction:column}.amr-actions{align-self:flex-end}.amr-role{font-size:11px}}
    `;
    function ModelPage(){
      const [data,setData]=React.useState(null),[choices,setChoices]=React.useState(null),[query,setQuery]=React.useState(''),[provider,setProvider]=React.useState('');
      const [loading,setLoading]=React.useState(true),[saving,setSaving]=React.useState(false),[notice,setNotice]=React.useState(''),[error,setError]=React.useState('');
      const mounted=React.useRef(false),serial=React.useRef(0),dirtyRef=React.useRef(false),savingRef=React.useRef(false);
      const dirty=Boolean(data&&choices&&JSON.stringify(data.settings.roles)!==JSON.stringify(choices));dirtyRef.current=dirty;
      const load=React.useCallback(async(reset=false)=>{
        if(savingRef.current)return;const ticket=++serial.current;setLoading(true);setError('');
        try{const payload=await request('state');if(!mounted.current||ticket!==serial.current)return;
          if(!dirtyRef.current||reset){setData(payload);setChoices(clone(payload.settings.roles));dirtyRef.current=false;}
          else{setData(previous=>({...previous,catalogue:payload.catalogue,availability:payload.availability,runtime:payload.runtime}));setNotice('已刷新启用模型。未保存的选择保留；若其他页面已修改配置，保存时会提示冲突。');}
          if(!payload.catalogue.ok)setError(payload.catalogue.error||'模型目录不可用');
        }catch(e){if(mounted.current&&ticket===serial.current){setError(e.message);setData(previous=>previous?{...previous,catalogue:{ok:false,models:[]}}:null);}}
        finally{if(mounted.current&&ticket===serial.current)setLoading(false);}
      },[]);
      React.useEffect(()=>{mounted.current=true;load();const focus=()=>load(),visible=()=>{if(!document.hidden)load();};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visible);return()=>{mounted.current=false;++serial.current;window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visible);};},[load]);
      const all=data?.catalogue?.models||[],enabled=new Set(all.map(routeKey));
      const runtime=runtimeText(data?.runtime),providerErrors=Object.entries(data?.catalogue?.errors||{});
      const matches=filteredModels(all,query,provider),groups=new Map();for(const m of matches){if(!groups.has(m.provider))groups.set(m.provider,{name:m.providerName||m.provider,models:[]});groups.get(m.provider).models.push(m);}
      const providers=[...new Map(all.map(m=>[m.provider,m.providerName||m.provider])).entries()];
      const valid=Boolean(choices&&ROLES.every(([role])=>enabled.has(routeKey(choices[role]))));
      async function save(){
        savingRef.current=true;setSaving(true);setError('');setNotice('');++serial.current;setLoading(false);
        try{const payload=await request('settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roles:choices,expectedVersion:data.settings.version})});if(!mounted.current)return;setData(previous=>({...previous,settings:payload.settings}));setChoices(clone(payload.settings.roles));dirtyRef.current=false;setNotice('已保存，后续启动的新会话生效。当前会话与正在运行的代理保持原映射。');}
        catch(e){if(mounted.current)setError(e.status===409?'配置已在其他页面更改。请重新载入后再选择，原配置未被覆盖。':e.message);}
        finally{savingRef.current=false;if(mounted.current)setSaving(false);}
      }
      async function toggleMode(){
        const next=!data.settings.enabled;savingRef.current=true;setSaving(true);setError('');setNotice('');++serial.current;setLoading(false);
        try{const payload=await request('mode',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:next,expectedVersion:data.settings.version})});if(!mounted.current)return;setData(previous=>({...previous,settings:payload.settings}));setNotice(next?'多代理模式已开启，后续调用可使用角色编排。模型选择仍按各会话创建时的版本生效。':'多代理模式已关闭，不再启动新编排。正在运行的任务继续完成。');}
        catch(e){if(mounted.current)setError(e.status===409?'配置已在其他页面更改，请重新载入后操作。':e.message);}
        finally{savingRef.current=false;if(mounted.current)setSaving(false);}
      }
      return el('div',{className:'amr-page'},el('main',{className:'amr-content'},
        el('header',{className:'amr-header'},el('div',{className:'amr-kicker'},'多角色编排'),el('h1',{className:'amr-title'},'代理模型'),el('p',{className:'amr-sub'},'为每个角色自由选择模型。目录来自当前 DeepSeek Harness 模型服务注册的全部通道，不限特定插件。'),el('span',{className:'amr-global'},'所有工作区共用 · 新会话生效')),
        data?el('section',{className:'amr-message',role:'status'},el('div',null,runtime.summary),runtime.warning?el('div',{className:'amr-warning'},runtime.warning):null,el('div',{className:'amr-note'},'此页显示最新全局映射；已有会话的实际版本请用 agent_role_models 查询。')):null,
        el('section',{className:'amr-mode'},el('div',null,el('div',{className:'amr-mode-title'},'多代理模式',data?' · '+(data.settings.enabled?'已开启':'已关闭'):''),el('div',{className:'amr-mode-hint'},'开关立即作用于本插件的新编排；已有任务不中断。')),el('button',{className:'amr-switch',role:'switch','aria-label':'多代理模式','aria-checked':Boolean(data?.settings.enabled),disabled:!data||loading||saving,onClick:toggleMode},el('span',{'aria-hidden':true}))),
        el('div',{className:'amr-toolbar'},el('input',{className:'amr-field amr-search',type:'search',value:query,placeholder:'搜索模型名称、ID 或通道','aria-label':'搜索模型',onChange:e=>setQuery(e.target.value)}),el('select',{className:'amr-field',value:provider,'aria-label':'筛选通道',onChange:e=>setProvider(e.target.value)},el('option',{value:''},'全部通道'),...providers.map(([id,name])=>el('option',{key:id,value:id},name))),el('button',{className:'amr-btn',onClick:()=>load(),disabled:loading||saving},loading?'刷新中…':'刷新')),
        error?el('div',{className:'amr-message amr-error',role:'alert'},error):null,
        providerErrors.length?el('div',{className:'amr-message',role:'status'},'部分通道读取失败；健康通道仍可使用。',...providerErrors.map(([name,message])=>el('div',{className:'amr-warning',key:name},name+'：'+message))):null,
        notice?el('div',{className:'amr-message',role:'status'},notice):null,
        !choices?el('div',{className:'amr-empty'},loading?'正在读取角色设置与模型目录…':'暂时无法读取插件设置。'):el('div',{className:'amr-rows'},...ROLES.map(([role,title,description],i)=>{
          const selected=routeKey(choices[role]),available=enabled.has(selected),shown=matches.some(m=>routeKey(m)===selected),chosen=all.find(m=>routeKey(m)===selected),visionNote=modalityWarning(role,chosen);
          return el('section',{className:'amr-row',key:role},el('div',{className:'amr-icon','aria-hidden':true},String(i+1).padStart(2,'0')),el('div',null,el('div',{className:'amr-label'},title,el('span',{className:'amr-role'},role)),el('div',{className:'amr-desc'},description)),el('div',{className:'amr-selection'},el('select',{className:'amr-field amr-model',value:selected,'aria-label':role+' 模型',disabled:loading||saving||!data.catalogue.ok,onChange:e=>{const [p,m]=JSON.parse(e.target.value);setChoices(previous=>({...previous,[role]:{provider:p,model:m}}));setNotice('');}},
            !shown?el('option',{value:selected,disabled:!available},available?'当前：'+choices[role].model:'不可用：'+choices[role].model):null,
            ...[...groups.entries()].map(([id,g])=>el('optgroup',{label:g.name,key:id},...g.models.map(m=>el('option',{key:routeKey(m),value:routeKey(m),...(m.description?{title:m.description}:{})},m.name))))),el('div',{className:'amr-route'},choices[role].provider+' / '+choices[role].model),!available?el('div',{className:'amr-warning'},'当前模型不在宿主模型目录中或通道不可用，请重新选择。'):null,visionNote?el('div',{className:'amr-warning'},visionNote):null));
        })),
        el('footer',{className:'amr-footer'},el('div',{className:'amr-note'},'目录由宿主模型服务提供，插件不内置通道白名单；可用不代表每次调用都成功，模型不可用后不会自动替换。',el('br'),data?'配置版本 '+data.settings.version+' · '+all.length+' 个可用模型':'仅修改角色映射，不改变主会话模型。'),el('div',{className:'amr-actions'},el('button',{className:'amr-btn',disabled:saving||loading,onClick:()=>load(true)},'重新载入'),el('button',{className:'amr-btn amr-btn-primary',disabled:!dirty||!valid||loading||saving||!data?.catalogue.ok,onClick:save},saving?'保存中…':'保存设置')))));
    }
    function apply(ctx){
      ctx.effect(()=>{const style=document.createElement('style');style.setAttribute('data-plugin','dsh-agent-model-router');style.textContent=CSS;document.head.appendChild(style);return()=>style.remove();},'agent model router styles');
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'agent-model-router',order:45,label:()=> '代理模型'},()=>el('svg',{width:18,height:18,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.4},el('path',{d:'M3 5h14M3 10h14M3 15h14'}),el('circle',{cx:7,cy:5,r:2,fill:'var(--amr-bg,currentColor)'}),el('circle',{cx:13,cy:10,r:2}),el('circle',{cx:8,cy:15,r:2}))));
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'agent-model-router'},()=>el(ModelPage)));
    }
    return {name:'dsh-agent-model-router',inject:['slots'],apply,__test:{ModelPage,filteredModels,modalityWarning,routeKey,runtimeText,CSS,ROLES}};
  }});
})();
