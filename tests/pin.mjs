import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../dist/worker.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0000_fuzzy_famine.sql', import.meta.url),'utf8'));
sqlite.exec(readFileSync(new URL('../drizzle/0001_thankful_valkyrie.sql', import.meta.url),'utf8'));
const env = {DB:{
  prepare(sql) {
    let args = [];
    return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args) || null;},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}};}};
  },
  async batch(items){sqlite.exec('BEGIN');try {const out=[];for(const item of items)out.push(await item.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}
}};
const base='https://ava.test';
const call=(path,{method='GET',body,headers={}}={})=>worker.fetch(new Request(base+path,{method,headers:{...(method==='POST'||method==='PUT'?{'Origin':base,'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
const cookie=response=>response.headers.get('Set-Cookie').split(';')[0];

// Owner account + signed-in session.
const credentials={username:'salon-test',password:crypto.randomUUID()+'-Password'};
assert.equal((await call('/api/auth/setup',{method:'POST',body:credentials})).status,200);
const session=cookie(await call('/api/auth/login',{method:'POST',body:credentials}));
const sh={Cookie:session};

// No PIN yet: both locations are viewable.
assert.equal((await call('/api/board?loc=1',{headers:sh})).status,200,'loc1 open before any PIN');
assert.equal((await call('/api/board?loc=2',{headers:sh})).status,200,'loc2 open before any PIN');
assert.equal((await (await call('/api/pin/status?loc=2',{headers:sh})).json()).pinSet,false);

// Set a PIN on location 2 (requires session). Setter is unlocked immediately.
const setRes=await call('/api/pin/set?loc=2',{method:'POST',body:{pin:'123456'},headers:sh});
assert.equal(setRes.status,200,'Owner can set a PIN');
assert.match(setRes.headers.get('Set-Cookie'),/^__Host-ava-pin2=[a-f0-9]{64}; .*HttpOnly; Secure/,'Set-PIN returns an unlock cookie');
const pin2=cookie(setRes);

// Location 2 is now gated; location 1 stays open.
assert.equal((await call('/api/board?loc=2',{headers:sh})).status,403,'loc2 blocked without PIN unlock');
assert.equal((await (await call('/api/board?loc=2',{headers:sh})).json()).pinRequired,true);
assert.equal((await call('/api/board?loc=1',{headers:sh})).status,200,'loc1 unaffected by loc2 PIN');
// PUT is gated too (cannot save without unlock).
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const data={services:[],staffByDay:Object.fromEntries(days.map(d=>[d,[]])),orderByDay:Object.fromEntries(days.map(d=>[d,[]])),entries:{}};
assert.equal((await call('/api/board?loc=2',{method:'PUT',body:{revision:0,data},headers:sh})).status,403,'PUT blocked without PIN unlock');

// Wrong PIN rejected; correct PIN unlocks and returns a matching cookie.
assert.equal((await call('/api/pin/unlock?loc=2',{method:'POST',body:{pin:'000000'},headers:sh})).status,401,'Wrong PIN rejected');
const unlockRes=await call('/api/pin/unlock?loc=2',{method:'POST',body:{pin:'123456'},headers:sh});
assert.equal(unlockRes.status,200,'Correct PIN unlocks');
const pin2b=cookie(unlockRes);
assert.equal(pin2b,pin2,'Unlock cookie is deterministic for the same PIN');

// With the unlock cookie, the board is viewable again.
assert.equal((await call('/api/board?loc=2',{headers:{Cookie:session+'; '+pin2b}})).status,200,'loc2 viewable after unlock');
assert.equal((await (await call('/api/pin/status?loc=2',{headers:{Cookie:session+'; '+pin2b}})).json()).unlocked,true);

// "Lock now" re-locks this device without needing the PIN; viewing needs the PIN again.
const lockRes=await call('/api/pin/lock?loc=2',{method:'POST',body:{},headers:{Cookie:session+'; '+pin2b}});
assert.equal(lockRes.status,200,'Lock succeeds');
assert.match(lockRes.headers.get('Set-Cookie'),/^__Host-ava-pin2=;.*Max-Age=0/,'Lock clears the unlock cookie');
assert.equal((await call('/api/board?loc=2',{headers:{Cookie:session+'; '+cookie(lockRes)}})).status,403,'loc2 locked again after Lock');
assert.equal((await call('/api/pin/lock?loc=2',{method:'POST',body:{}})).status,401,'Lock needs sign-in');
// Re-unlock with the correct PIN works again.
assert.equal((await call('/api/pin/unlock?loc=2',{method:'POST',body:{pin:'123456'},headers:sh})).status,200,'Re-unlock after lock');

// Changing the PIN requires the current PIN; a wrong/absent current is rejected.
assert.equal((await call('/api/pin/set?loc=2',{method:'POST',body:{pin:'999999'},headers:sh})).status,403,'Change needs current PIN');
assert.equal((await call('/api/pin/set?loc=2',{method:'POST',body:{pin:'999999',current:'123456'},headers:sh})).status,200,'Change with current PIN works');
assert.notEqual(cookie(await call('/api/pin/unlock?loc=2',{method:'POST',body:{pin:'999999'},headers:sh})),pin2,'New PIN yields a new unlock token');

// Unlock requires a session too (board is behind login).
assert.equal((await call('/api/pin/unlock?loc=2',{method:'POST',body:{pin:'999999'}})).status,401,'Unlock needs sign-in');

// Turning off the PIN reopens the location.
assert.equal((await call('/api/pin/remove?loc=2',{method:'POST',body:{current:'999999'},headers:sh})).status,200,'Owner can turn off PIN');
assert.equal((await call('/api/board?loc=2',{headers:sh})).status,200,'loc2 open again after PIN removed');

console.log('Passed: per-location PIN gate (set/unlock/change/remove), board GET+PUT blocked until unlocked, deterministic unlock token, sign-in required.');
