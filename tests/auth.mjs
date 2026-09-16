import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../dist/worker.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0000_fuzzy_famine.sql', import.meta.url),'utf8'));
sqlite.prepare('INSERT INTO board (id,revision,data) VALUES (1,1,?)').run(JSON.stringify({existing:true}));
sqlite.exec(readFileSync(new URL('../drizzle/0001_thankful_valkyrie.sql', import.meta.url),'utf8'));
const SETUP_KEY = 'owner-setup-key-' + crypto.randomUUID();
const env = {OWNER_SETUP_KEY:SETUP_KEY,DB:{
  prepare(sql) {
    let args = [];
    return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args) || null;},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}};}};
  },
  async batch(items){sqlite.exec('BEGIN');try {const out=[];for(const item of items)out.push(await item.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}
}};
const base='https://ava.test';
const call=(path,{method='GET',body,headers={}}={})=>worker.fetch(new Request(base+path,{method,headers:{...(method==='POST'||method==='PUT'?{'Origin':base,'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
const cookie=response=>response.headers.get('Set-Cookie').split(';')[0];
const credentials={username:'salon-test',password:crypto.randomUUID()+'-Password'};
const setupBody={...credentials,setupKey:SETUP_KEY};

// Anonymous access is blocked; the login and setup pages are public (the key gates the write).
assert.equal((await call('/')).status,302);
assert.equal((await call('/login')).status,200);
assert.equal((await call('/setup')).status,200,'Setup page is public; the setup key gates the write');
assert.equal((await call('/api/board')).status,401);
assert.equal((await (await call('/api/auth/status')).json()).canSetup,true,'canSetup reflects OWNER_SETUP_KEY');

// Cross-origin setup is always rejected (CSRF).
assert.equal((await call('/api/auth/setup',{method:'POST',body:setupBody,headers:{Origin:'https://evil.test'}})).status,403,'Cross-origin setup is rejected');
// First-run setup is open (no key needed) and preserves existing turns.
assert.equal((await call('/api/auth/setup',{method:'POST',body:credentials})).status,200,'First-run setup is open');
assert.equal(sqlite.prepare('SELECT data FROM board').get().data,'{"existing":true}','Setup preserves existing turns');
assert.notEqual(sqlite.prepare('SELECT password_hash FROM salon_account').get().password_hash,credentials.password);
// Once an account exists, changing it requires the setup key.
assert.equal((await call('/api/auth/setup',{method:'POST',body:credentials})).status,403,'Change without key is rejected once configured');
assert.equal((await call('/api/auth/setup',{method:'POST',body:{...credentials,setupKey:'wrong'}})).status,403,'Wrong key is rejected');
assert.equal((await call('/api/auth/setup',{method:'POST',body:setupBody})).status,200,'Correct key allows changes');

// Login by shared salon password.
const login=(remember=false)=>call('/api/auth/login',{method:'POST',body:{...credentials,remember}});
assert.equal((await call('/api/auth/login',{method:'POST',body:{...credentials,password:'wrong'}})).status,401);
const a=await login(),b=await login(true);assert.equal(a.status,200);assert.equal(b.status,200);
assert.doesNotMatch(a.headers.get('Set-Cookie'),/Max-Age/);
assert.match(b.headers.get('Set-Cookie'),/Max-Age=2592000/);
const expiries=sqlite.prepare('SELECT expires_at FROM salon_sessions ORDER BY expires_at').all();
assert.ok(expiries[1].expires_at-expiries[0].expires_at >= 29*86400000);
const ah={Cookie:cookie(a)},bh={Cookie:cookie(b)};assert.notEqual(ah.Cookie,bh.Cookie,'Each device gets its own session');
assert.match(a.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
assert.equal((await call('/',{headers:ah})).status,200);
assert.equal((await call('/login',{headers:bh})).status,302,'Remembered login skips login page');
assert.equal((await (await call('/api/account',{headers:ah})).json()).email,credentials.username);

// Two devices share one board with conflict protection and CSRF checks.
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const data={services:['Dip'],staffByDay:Object.fromEntries(days.map(d=>[d,[{id:'tech1',name:'Tyson'}]])),orderByDay:Object.fromEntries(days.map(d=>[d,['tech1']])),entries:{'Monday|tech1|1':'Dip'}};
assert.equal((await call('/api/board',{method:'PUT',body:{revision:1,data},headers:ah})).status,200);
assert.deepEqual((await (await call('/api/board',{headers:bh})).json()).data,data,'Laptop reads phone edits');
assert.equal((await call('/api/board',{method:'PUT',body:{revision:1,data},headers:bh})).status,409,'Stale writes cannot overwrite');
assert.equal((await call('/api/board',{method:'PUT',body:{revision:2,data},headers:{...ah,Origin:'https://evil.test'}})).status,403);

// Logout ends only this device; password change revokes every session.
assert.equal((await call('/api/auth/logout',{method:'POST',headers:ah})).status,200);
assert.equal((await call('/api/board',{headers:ah})).status,401);
assert.equal((await call('/api/board',{headers:bh})).status,200,'Logout only ends this device session');
assert.equal((await call('/api/auth/setup',{method:'POST',body:{...credentials,password:credentials.password+'new',setupKey:SETUP_KEY}})).status,200);
assert.equal((await call('/api/board',{headers:bh})).status,401,'Password change revokes all old sessions');
assert.equal((await login()).status,401,'Old password no longer works');
assert.deepEqual(JSON.parse(sqlite.prepare('SELECT data FROM board').get().data),data);
sqlite.prepare('UPDATE login_attempts SET attempts = 10').run();
assert.equal((await login()).status,429,'Login attempts are rate limited');
console.log('Passed: setup-key ownership, password hashing/login, two device shared data, conflict protection, CSRF, logout, password change, migration preservation and rate limit.');
