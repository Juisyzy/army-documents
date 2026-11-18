import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,obj:object)=>new Response(JSON.stringify(obj),{status,headers});
const validStatic=(s:unknown):s is string=>typeof s==='string'&&/^\d{1,30}$/.test(s);
const validUUID=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const encoder=new TextEncoder();
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
const codeHash=async(uid:string,code:string,secret:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(`${secret}:${uid}:${code}`)));
const randomCode=()=>{const range=100000000,limit=Math.floor(4294967296/range)*range;let n:number;do{const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);n=bytes[0];}while(n>=limit);return String(n%range).padStart(8,'0');};

serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return reply(405,{error:'Метод не поддерживается'});
 const url=Deno.env.get('SUPABASE_URL'), service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), anon=Deno.env.get('SUPABASE_ANON_KEY'), secret=Deno.env.get('RESET_CODE_SECRET');
 if(!url||!service||!anon||!secret||secret.length<32)return reply(500,{error:'Функция не настроена: проверьте секреты'});
 const db=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
 let body:Record<string,unknown>;
 try{body=await req.json();}catch{return reply(400,{error:'Неверный запрос'});}
 const action=body.action;
 const lookup=async(s:string)=>{
   const {data}=await db.from('profiles').select('id,character_static,first_name,last_name,username,role').eq('character_static',s).maybeSingle();return data;
 };
 if(action==='request'){
   if(!validStatic(body.static_id))return reply(400,{error:'Некорректный статик'});
   const user=await lookup(body.static_id);
   if(user){
     const {data:old}=await db.from('password_recovery_requests').select('requested_at').eq('user_id',user.id).maybeSingle();
     if(!old||Date.now()-new Date(old.requested_at).getTime()>5*60*1000){
       await db.from('password_recovery_requests').upsert({user_id:user.id,requested_at:new Date().toISOString(),code_hash:null,expires_at:null,attempts:0,fulfilled_at:null});
     }
   }
   return reply(200,{ok:true}); // Не раскрываем существование аккаунта
 }
 if(action==='redeem'){
   if(!validStatic(body.static_id)||typeof body.code!=='string'||!/^\d{8}$/.test(body.code)||typeof body.new_password!=='string'||body.new_password.length<8||body.new_password.length>128)
     return reply(400,{error:'Проверьте статик, код и новый пароль (8–128 символов)'});
   const user=await lookup(body.static_id);
   if(!user)return reply(400,{error:'Неверный или просроченный код'});
   const {data:r}=await db.from('password_recovery_requests').select('*').eq('user_id',user.id).maybeSingle();
   if(!r?.code_hash||r.fulfilled_at||!r.expires_at||Date.now()>=new Date(r.expires_at).getTime()||r.attempts>=5)
     return reply(400,{error:'Неверный или просроченный код. Запросите новый у администратора.'});
   // Увеличиваем счётчик до проверки, чтобы ограничить подбор.
   const {data:locked}=await db.from('password_recovery_requests').update({attempts:r.attempts+1}).eq('user_id',user.id).eq('attempts',r.attempts).select('user_id').maybeSingle();
   if(!locked)return reply(429,{error:'Повторите попытку'});
   if(await codeHash(user.id,body.code,secret)!==r.code_hash)return reply(400,{error:'Неверный или просроченный код'});
   const {error}=await db.auth.admin.updateUserById(user.id,{password:body.new_password});
   if(error)return reply(500,{error:'Не удалось изменить пароль'});
   await db.from('password_recovery_requests').update({code_hash:null,expires_at:null,fulfilled_at:new Date().toISOString()}).eq('user_id',user.id);
   return reply(200,{ok:true});
 }
 // Все остальные операции — только для действующего администратора.
 const bearer=req.headers.get('Authorization');
 if(!bearer?.startsWith('Bearer '))return reply(401,{error:'Необходим вход администратора'});
 const {data:identity,error:authError}=await db.auth.getUser(bearer.slice(7));
 if(authError||!identity.user)return reply(401,{error:'Недействительная сессия'});
 const {data:admin}=await db.from('profiles').select('role').eq('id',identity.user.id).maybeSingle();
 if(admin?.role!=='admin')return reply(403,{error:'Недостаточно прав'});
 if(action==='list'){
   const {data:requests,error}=await db.from('password_recovery_requests').select('user_id,requested_at,fulfilled_at').is('fulfilled_at',null).order('requested_at',{ascending:false}).limit(100);
   if(error)return reply(500,{error:'Не удалось получить заявки'});
   const ids=(requests||[]).map(x=>x.user_id);
   const {data:users}=ids.length?await db.from('profiles').select('id,character_static,first_name,last_name,username').in('id',ids):{data:[]};
   const byId=new Map((users||[]).map(u=>[u.id,u]));
   return reply(200,{requests:(requests||[]).filter(r=>byId.has(r.user_id)).map(r=>({user_id:r.user_id,static_id:byId.get(r.user_id).character_static,name:[byId.get(r.user_id).first_name,byId.get(r.user_id).last_name].filter(Boolean).join(' ')||byId.get(r.user_id).username,requested_at:r.requested_at}))});
 }
 if(action==='generate'){
   if(!validUUID(body.user_id))return reply(400,{error:'Некорректный ID'});
   const {data:target}=await db.from('profiles').select('id,role').eq('id',body.user_id).maybeSingle();
   if(!target||target.role==='admin')return reply(403,{error:'Сброс для этого аккаунта запрещён'});
   const {data:r}=await db.from('password_recovery_requests').select('user_id,fulfilled_at').eq('user_id',target.id).maybeSingle();
   if(!r||r.fulfilled_at)return reply(404,{error:'Нет активной заявки'});
   const code=randomCode();
   const {error}=await db.from('password_recovery_requests').update({code_hash:await codeHash(target.id,code,secret),expires_at:new Date(Date.now()+24*60*60*1000).toISOString(),attempts:0}).eq('user_id',target.id);
   if(error)return reply(500,{error:'Не удалось создать код'});
   return reply(200,{ok:true,code});
 }
 return reply(400,{error:'Неизвестная операция'});
});
