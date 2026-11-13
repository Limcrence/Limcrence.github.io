const MAX_BYTES=1_550_000;
export default {
  async fetch(request,env){
    try{return await handle(request,env);}catch(error){
      console.error('reading-sync-request-failed',error instanceof Error?error.stack:String(error));
      return new Response(JSON.stringify({error:'service_error',detail:error instanceof Error?error.message:'unknown'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
  }
};
async function handle(request,env){
    const origin=request.headers.get('Origin');
    const allowed=origin===env.ALLOWED_ORIGIN||(env.DEV_ORIGIN&&origin===env.DEV_ORIGIN)||(env.DEV_ORIGIN_2&&origin===env.DEV_ORIGIN_2);
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',...(allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}:{})};
    const reply=(value,status=200)=>new Response(value===null?null:JSON.stringify(value),{status,headers});
    if(origin&&!allowed)return reply({error:'origin_not_allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    const url=new URL(request.url),match=url.pathname.match(/^\/v1\/vault\/([a-f0-9]{64})$/);
    if(!match||match[1]!==env.VAULT_ID)return reply({error:'not_found'},404);
    const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if(!token)return reply({error:'unauthorized'},401);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==env.VAULT_ID)return reply({error:'unauthorized'},401);
    const db=env.DB.withSession?env.DB.withSession('first-primary'):env.DB;
    try{
      if(request.method==='GET'){
        const row=await db.prepare('SELECT revision, updated_at, mutation_id, payload FROM progress_vaults WHERE vault_id = ?').bind(env.VAULT_ID).first();
        return reply({record:row?{version:row.revision,updatedAt:row.updated_at,mutationId:row.mutation_id,payload:JSON.parse(row.payload)}:null});
      }
      if(request.method!=='PUT')return reply({error:'method_not_allowed'},405);
      if(Number(request.headers.get('Content-Length')||0)>MAX_BYTES)return reply({error:'too_large'},413);
      const raw=await request.text();if(new TextEncoder().encode(raw).length>MAX_BYTES)return reply({error:'too_large'},413);
      let body;try{body=JSON.parse(raw);}catch{return reply({error:'invalid_json'},400);}
      const p=body.payload;
      if((body.expectedVersion!==null&&(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1))||typeof body.mutationId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.mutationId)||p?.format!=='reading-progress-aesgcm-v1'||typeof p.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(p.iv)||typeof p.data!=='string'||p.data.length<24||p.data.length>1_500_000||!/^[A-Za-z0-9+/]+=*$/.test(p.data))return reply({error:'invalid_snapshot'},400);
      const existing=await db.prepare('SELECT revision, updated_at, mutation_id FROM progress_vaults WHERE vault_id = ?').bind(env.VAULT_ID).first();
      if(existing?.mutation_id===body.mutationId)return reply({version:existing.revision,updatedAt:existing.updated_at});
      const now=Date.now(),payload=JSON.stringify(p);
      const result=body.expectedVersion===null
        ?await db.prepare('INSERT INTO progress_vaults (vault_id,revision,updated_at,mutation_id,payload) VALUES (?,1,?,?,?) ON CONFLICT(vault_id) DO NOTHING RETURNING revision,updated_at').bind(env.VAULT_ID,now,body.mutationId,payload).first()
        :await db.prepare('UPDATE progress_vaults SET revision=revision+1,updated_at=?,mutation_id=?,payload=? WHERE vault_id=? AND revision=? RETURNING revision,updated_at').bind(now,body.mutationId,payload,env.VAULT_ID,body.expectedVersion).first();
      if(!result)return reply({error:'version_conflict'},409);
      return reply({version:result.revision,updatedAt:result.updated_at});
    }catch{return reply({error:'storage_unavailable'},503);}
}
