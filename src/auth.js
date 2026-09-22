import { scryptAsync } from '@noble/hashes/scrypt';

const COOKIE = '__Host-ava-session';
const LIFETIME = 24 * 60 * 60;
const REMEMBER_LIFETIME = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g), x => parseInt(x, 16));
const random = size => hex(crypto.getRandomValues(new Uint8Array(size)));
const digest = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
// Owner authorization on Cloudflare: the request must carry the secret setup key
// (env.OWNER_SETUP_KEY). The previous OpenAI header check is unsafe on Workers —
// any client can forge oai-authenticated-* headers, so it must not be trusted here.
const validSetupKey = (provided, env) => {
  const expected = env.OWNER_SETUP_KEY;
  if (!expected || typeof provided !== 'string' || provided.length === 0) return false;
  return constantEqual(encoder.encode(provided), encoder.encode(expected));
};
const jsonAuth = (data, status = 200, extra = {}) => Response.json(data, {status, headers: {'Cache-Control':'no-store', ...extra}});
const cookie = (token, age = null) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${age === null ? '' : '; Max-Age=' + age}`;
const readToken = request => {
  const value = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
};
let activeHashes = 0;
const hashPassword = async (password, salt) => {
  if (activeHashes >= 3) throw new Error('Busy');
  activeHashes++;
  try { return await scryptAsync(password, unhex(salt), {N:16384, r:8, p:5, dkLen:32, maxmem:32 * 1024 * 1024}); }
  finally { activeHashes--; }
};
const constantEqual = (a,b) => {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a[i] ^ b[i]; return diff === 0;
};
const parseInput = async request => {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('input');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('input');
  let body = '', size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error('input'); }
    body += decoder.decode(value, {stream:true});
  }
  body += decoder.decode();
  const data = JSON.parse(body);
  if (!data || typeof data.username !== 'string' || typeof data.password !== 'string' || data.username.length > 40 || data.password.length > 128) throw new Error('input');
  return {username:data.username.trim().toLowerCase(), password:data.password, remember:data.remember === true, setupKey:typeof data.setupKey === 'string' && data.setupKey.length <= 256 ? data.setupKey : ''};
};
async function throttle(request, env, scope = 'login') {
  const now = Date.now(), windowEnd = (Math.floor(now / 900000) + 1) * 900000;
  const key = await digest(scope + ':' + (request.headers.get('CF-Connecting-IP') || 'shared') + ':' + windowEnd);
  const row = await env.DB.prepare('INSERT INTO login_attempts (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(key, windowEnd).first();
  await env.DB.prepare('DELETE FROM login_attempts WHERE expires_at < ?').bind(now).run();
  return row.attempts <= 10;
}
export async function getSession(request, env) {
  const token = readToken(request);
  if (!token) return null;
  return env.DB.prepare('SELECT a.username FROM salon_sessions s JOIN salon_account a ON a.id = 1 AND a.epoch = s.epoch WHERE s.token_hash = ? AND s.expires_at > ?').bind(await digest(token), Date.now()).first();
}
// ---- Per-location view PIN (server-enforced) ----
// PIN config is stored in the board table at reserved ids 100+loc (101, 102) so
// no new D1 table is needed. An unlock cookie value is derived from the account
// epoch + the PIN hash, so it cannot be forged and rotates when either changes.
const PIN_LIFETIME = 400 * 24 * 60 * 60; // ~400 days: enter the PIN once per device (max a browser keeps a cookie)
const pinCookieName = loc => `__Host-ava-pin${loc}`;
const pinCookie = (loc, token, age) => `${pinCookieName(loc)}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${age === null ? '' : '; Max-Age=' + age}`;
const readPinCookie = (request, loc) => {
  const name = pinCookieName(loc);
  const value = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
};
const readJson = async (request, max = 2048) => {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return {};
  const reader = request.body?.getReader(); if (!reader) return {};
  let body = '', size = 0; const dec = new TextDecoder();
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); return {}; } body += dec.decode(value,{stream:true}); }
  body += dec.decode();
  try { const d = JSON.parse(body); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
};
async function pinRow(env, loc) {
  const row = await env.DB.prepare('SELECT data FROM board WHERE id = ?').bind(100 + loc).first();
  if (!row) return null;
  try { const d = JSON.parse(row.data); return d && d.hash && d.salt ? d : null; } catch { return null; }
}
async function expectedUnlock(env, loc, hashHex) {
  const account = await env.DB.prepare('SELECT epoch FROM salon_account WHERE id = 1').first();
  return digest((account?.epoch || '') + '|' + hashHex + '|' + loc);
}
const verifyPin = async (candidate, pin) => typeof candidate === 'string' && candidate.length > 0 && constantEqual(await hashPassword(candidate, pin.salt), unhex(pin.hash));
export async function pinGate(request, env, loc) {
  const pin = await pinRow(env, loc);
  if (!pin) return { pinSet: false, ok: true };
  const cookie = readPinCookie(request, loc);
  if (!cookie) return { pinSet: true, ok: false };
  const expected = await expectedUnlock(env, loc, pin.hash);
  return { pinSet: true, ok: constantEqual(encoder.encode(cookie), encoder.encode(expected)) };
}
export async function pinRoute(request, env, session) {
  const url = new URL(request.url), path = url.pathname;
  const loc = [1,2].includes(Number(url.searchParams.get('loc'))) ? Number(url.searchParams.get('loc')) : 1;
  if (path === '/api/pin/status' && request.method === 'GET') {
    const gate = await pinGate(request, env, loc);
    return jsonAuth({ pinSet: gate.pinSet, unlocked: gate.pinSet ? gate.ok : true });
  }
  if (request.method !== 'POST') return jsonAuth({error:'Method not allowed'},405);
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return jsonAuth({error:'Invalid request.'},403);
  const body = await readJson(request);
  if (path === '/api/pin/unlock') {
    if (!(await throttle(request, env, 'pin' + loc))) return jsonAuth({error:'Too many attempts. Please wait up to 15 minutes.'},429,{'Retry-After':'900'});
    const pin = await pinRow(env, loc);
    if (!pin) return jsonAuth({ok:true});
    if (!(await verifyPin(String(body.pin ?? ''), pin))) return jsonAuth({error:'Wrong PIN.'},401);
    const token = await expectedUnlock(env, loc, pin.hash);
    return jsonAuth({ok:true},200,{'Set-Cookie':pinCookie(loc, token, PIN_LIFETIME)});
  }
  // Setting or removing a PIN requires a signed-in owner.
  if (!session) return jsonAuth({error:'Sign in required'},401);
  if (path === '/api/pin/set') {
    const newPin = String(body.pin ?? '');
    if (!/^\d{4,10}$/.test(newPin)) return jsonAuth({error:'PIN must be 4-10 digits.'},400);
    const existing = await pinRow(env, loc);
    if (existing && !(await verifyPin(String(body.current ?? ''), existing))) return jsonAuth({error:'Wrong current PIN.'},403);
    const salt = random(32), hashHex = hex(await hashPassword(newPin, salt));
    await env.DB.prepare('INSERT INTO board (id, revision, data) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, revision = board.revision + 1').bind(100 + loc, JSON.stringify({hash:hashHex, salt})).run();
    const token = await expectedUnlock(env, loc, hashHex);
    return jsonAuth({ok:true},200,{'Set-Cookie':pinCookie(loc, token, PIN_LIFETIME)});
  }
  if (path === '/api/pin/remove') {
    const existing = await pinRow(env, loc);
    if (existing && !(await verifyPin(String(body.current ?? ''), existing))) return jsonAuth({error:'Wrong current PIN.'},403);
    await env.DB.prepare('DELETE FROM board WHERE id = ?').bind(100 + loc).run();
    return jsonAuth({ok:true},200,{'Set-Cookie':pinCookie(loc, '', 0)});
  }
  return jsonAuth({error:'Not found'},404);
}
export async function authRoute(request, env, assets) {
  const url = new URL(request.url), path = url.pathname;
  if (['/login', '/login.html', '/auth-ui.js'].includes(path)) {
    if (request.method !== 'GET') return jsonAuth({error:'Method not allowed'},405);
    if (path !== '/auth-ui.js' && await getSession(request,env)) return Response.redirect(url.origin + '/',302);
    const asset = assets[path === '/auth-ui.js' ? path : '/login.html'];
    return new Response(asset.body, {headers:{'Content-Type':asset.type,'Cache-Control':'no-store'}});
  }
  if (path === '/setup') {
    // The page itself carries no secret; the setup key is verified on the POST below.
    if (request.method !== 'GET') return jsonAuth({error:'Method not allowed'},405);
    return new Response(assets['/login.html'].body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  }
  if (!path.startsWith('/api/auth/')) return null;
  if (path === '/api/auth/status' && request.method === 'GET') {
    const account = await env.DB.prepare('SELECT username FROM salon_account WHERE id = 1').first();
    // The setup key is only needed to CHANGE an existing account; first-run is open.
    const keyRequired = !!env.OWNER_SETUP_KEY && !!account;
    return jsonAuth({configured:!!account, keyRequired, canSetup: true});
  }
  if (request.method !== 'POST') return jsonAuth({error:'Method not allowed'},405);
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return jsonAuth({error:'Invalid request.'},403);
  if (path === '/api/auth/logout') {
    const token = readToken(request);
    if (token) await env.DB.prepare('DELETE FROM salon_sessions WHERE token_hash = ?').bind(await digest(token)).run();
    return jsonAuth({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if (path === '/api/auth/setup') {
    let input; try { input = await parseInput(request); } catch { return jsonAuth({error:'Check the username and password.'},400); }
    // Authorization for creating/changing the shared account:
    //  - If OWNER_SETUP_KEY is set, the request must carry the correct key.
    //  - Otherwise: first-run bootstrap (no account yet) is open, and once an
    //    account exists, only a signed-in device can change it.
    const existing = await env.DB.prepare('SELECT id FROM salon_account WHERE id = 1').first();
    // First-run (no account yet) is always open. Changing an existing account
    // needs the setup key (if configured) or a signed-in device.
    const authorized = !existing
      ? true
      : (env.OWNER_SETUP_KEY ? validSetupKey(input.setupKey, env) : Boolean(await getSession(request, env)));
    if (!authorized) return jsonAuth({error: env.OWNER_SETUP_KEY
      ? 'Wrong setup key. Only the owner has it.'
      : 'An account already exists. Sign in first to change it (or set OWNER_SETUP_KEY to unlock).'},403);
    const {username,password} = input;
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || password.length < 15) return jsonAuth({error:'Username: 3-40 chars (a-z, digits, . _ -). Password: at least 15 characters.'},400);
    const salt = random(32), epoch = random(16), passwordHash = hex(await hashPassword(password,salt));
    await env.DB.batch([
      env.DB.prepare('INSERT INTO salon_account (id, username, password_hash, salt, epoch) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, salt = excluded.salt, epoch = excluded.epoch').bind(username,passwordHash,salt,epoch),
      env.DB.prepare('DELETE FROM salon_sessions')
    ]);
    return jsonAuth({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if (path === '/api/auth/login') {
    if (!(await throttle(request,env))) return jsonAuth({error:'Too many attempts. Please wait up to 15 minutes and try again.'},429,{'Retry-After':'900'});
    let input; try { input = await parseInput(request); } catch { return jsonAuth({error:'Incorrect username or password.'},400); }
    const account = await env.DB.prepare('SELECT username, password_hash, salt, epoch FROM salon_account WHERE id = 1').first();
    if (!account) return jsonAuth({error:'The owner has not set up the account yet. Please contact the owner.'},503);
    const candidate = await hashPassword(input.password,account.salt);
    if (!constantEqual(candidate,unhex(account.password_hash)) || input.username !== account.username) return jsonAuth({error:'Incorrect username or password.'},401);
    const token = random(32);
    const lifetime = input.remember ? REMEMBER_LIFETIME : LIFETIME;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO salon_sessions (token_hash, epoch, expires_at) VALUES (?, ?, ?)').bind(await digest(token),account.epoch,Date.now()+lifetime*1000),
      env.DB.prepare('DELETE FROM salon_sessions WHERE expires_at <= ?').bind(Date.now())
    ]);
    return jsonAuth({ok:true},200,{'Set-Cookie':cookie(token,input.remember ? lifetime : null)});
  }
  return jsonAuth({error:'Not found'},404);
}
