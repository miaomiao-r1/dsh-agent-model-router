async function body(req){
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)throw Object.assign(Error('请求超过 64 KiB'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('请求不是合法 JSON'),{status:400});}
}
function send(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
export function createHttpHandler({service,connection}){
  return async(req,res)=>{
    try{
      const admission=connection.admit(req);
      if(!admission||'rejection' in admission){send(res,admission?.rejection||503,{error:'请从已登录的 DSH 页面访问'});return;}
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/agent-model-router/state'){send(res,200,await service.view());return;}
      if(req.method==='POST'&&url.pathname==='/agent-model-router/settings'){
        if(!String(req.headers['content-type']||'').startsWith('application/json')){send(res,415,{error:'需要 application/json'});return;}
        send(res,200,{settings:await service.save(await body(req))});return;
      }
      if(req.method==='POST'&&url.pathname==='/agent-model-router/mode'){
        if(!String(req.headers['content-type']||'').startsWith('application/json')){send(res,415,{error:'需要 application/json'});return;}
        send(res,200,{settings:await service.setEnabled(await body(req))});return;
      }
      send(res,404,{error:'接口不存在'});
    }catch(error){send(res,error.status||error.statusCode||400,{error:error.message,code:error.code||'REQUEST_ERROR'});}
  };
}
