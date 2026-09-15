import { authRoute, getSession } from './auth.js';
const json = (data, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const db = env => { if (!env.DB) throw new Error('Database unavailable'); return env.DB; };
const assetBody = a => a.bin ? Uint8Array.from(atob(a.body), c => c.charCodeAt(0)) : a.body;
// Static assets served WITHOUT login (needed for styling and PWA install).
const PUBLIC_ASSETS = ['/styles.css', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
function valid(data) {
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  return data && Array.isArray(data.services) && data.services.length <= 100 && data.services.every(s=>typeof s==='string' && s.length<=200) && data.staffByDay && data.orderByDay && data.entries && typeof data.entries==='object' && !Array.isArray(data.entries) && Object.values(data.entries).every(s=>typeof s==='string' && s.length<=200) && days.every(day=>Array.isArray(data.staffByDay[day]) && data.staffByDay[day].length<=100 && data.staffByDay[day].every(p=>p && typeof p.id==='string' && typeof p.name==='string' && p.name.length<=200) && Array.isArray(data.orderByDay[day]) && data.orderByDay[day].length<=100 && data.orderByDay[day].every(id=>id===null || typeof id==='string'));
}
async function handle(request, env) {
  const url = new URL(request.url);
  try {
    const auth = await authRoute(request, env, ASSETS);
    if (auth) return auth;
    if (request.method === 'GET' && PUBLIC_ASSETS.includes(url.pathname)) {
      const a = ASSETS[url.pathname];
      if (a) return new Response(assetBody(a),{headers:{'Content-Type':a.type}});
    }
    const session = await getSession(request, env);
    if (!session) return url.pathname.startsWith('/api/') ? json({error:'Sign in required'},401) : Response.redirect(url.origin + '/login',302);
    if (url.pathname === '/api/account') return json({email:session.username});
    if (url.pathname !== '/api/board') {
      if (request.method !== 'GET') return json({error:'Method not allowed'},405);
      const asset = ASSETS[url.pathname === '/' ? '/index.html' : url.pathname];
      return asset ? new Response(assetBody(asset),{headers:{'Content-Type':asset.type}}) : new Response('Not found',{status:404});
    }
   if(request.method==='GET') {
    const row=await db(env).prepare('SELECT revision, data FROM board WHERE id = 1').first();
    return json(row ? {revision:row.revision,data:JSON.parse(row.data)} : {revision:0,data:null});
   }
   if(request.method!=='PUT') return json({error:'Method not allowed'},405);
   if(request.headers.get('Origin')!==url.origin) return json({error:'Invalid origin'},403);
   const raw=await request.text();
   if(raw.length>500000) return json({error:'Too large'},413);
   const {revision,data}=JSON.parse(raw);
   if(!Number.isSafeInteger(revision) || revision<0 || !valid(data)) return json({error:'Invalid board'},400);
   const result=revision===0 ? await db(env).prepare('INSERT INTO board (id, revision, data) VALUES (1, 1, ?) ON CONFLICT(id) DO NOTHING').bind(JSON.stringify(data)).run() : await db(env).prepare('UPDATE board SET data = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(JSON.stringify(data),revision).run();
   return result.meta.changes ? json({revision:revision+1}) : json({error:'Board changed on another device'},409);
  } catch(error) {
    console.error('AVA request failed', error?.name || 'Error');
    return url.pathname.startsWith('/api/') ? json({error:'Tạm thời chưa kết nối được. Vui lòng thử lại.'},503) : new Response('Tạm thời chưa kết nối được. Vui lòng tải lại trang.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
}
export default { async fetch(request,env) {
  const response = await handle(request,env);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
  return new Response(response.body,{status:response.status,headers});
}};
