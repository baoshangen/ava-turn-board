import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../dist/worker.js';

// No OWNER_SETUP_KEY configured: first-run setup is open, later changes need a session.
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
const credentials={username:'ava-salon',password:crypto.randomUUID()+'-Password'};

// Before setup: no key required, setup is open.
let status = await (await call('/api/auth/status')).json();
assert.equal(status.configured, false);
assert.equal(status.keyRequired, false, 'No OWNER_SETUP_KEY -> key not required');
assert.equal(status.canSetup, true, 'First-run setup is available');

// First-run bootstrap: create the account with no key.
assert.equal((await call('/api/auth/setup',{method:'POST',body:credentials})).status, 200, 'First setup is open');
assert.equal((await call('/api/auth/setup',{method:'POST',body:{...credentials,Origin:base},headers:{Origin:'https://evil.test'}})).status, 403, 'Cross-origin still blocked');

// After an account exists: an anonymous setup is rejected.
status = await (await call('/api/auth/status')).json();
assert.equal(status.configured, true);
assert.equal((await call('/api/auth/setup',{method:'POST',body:{...credentials,password:credentials.password+'x'}})).status, 403, 'Anonymous change blocked once configured');

// A signed-in device may change the account.
const login = await call('/api/auth/login',{method:'POST',body:credentials});
assert.equal(login.status, 200);
const auth = {Cookie: cookie(login)};
const newPassword = credentials.password + '-rotated';
assert.equal((await call('/api/auth/setup',{method:'POST',headers:auth,body:{...credentials,password:newPassword}})).status, 200, 'Signed-in change allowed');
assert.equal((await call('/api/auth/login',{method:'POST',body:credentials})).status, 401, 'Old password revoked');
assert.equal((await call('/api/auth/login',{method:'POST',body:{...credentials,password:newPassword}})).status, 200, 'New password works');
console.log('Passed: keyless first-run bootstrap, anonymous-change lockout, signed-in change.');
