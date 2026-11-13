import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../../cloud-sync/worker.mjs';
import {deriveSyncIdentity,encryptSnapshot,decryptSnapshot} from '../src/lib/sync-crypto.ts';
import {SyncEngine} from '../src/lib/sync-engine.ts';
import {CloudConflictError} from '../src/lib/cloud-api.ts';
import {makeSnapshot,validateSnapshot} from '../src/lib/snapshot.ts';
import {applyOperation,freshRecord} from '../src/lib/progress.ts';
const db=new DatabaseSync(':memory:');db.exec(await fs.readFile(new URL('../../cloud-sync/schema.sql',import.meta.url),'utf8'));
const binding={
  prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;}};}};},
  withSession(){return this;}
};
const identity=await deriveSyncIdentity(crypto.getRandomValues(new Uint8Array(32)));
const env={DB:binding,VAULT_ID:identity.vaultId,ALLOWED_ORIGIN:'https://limcrence.github.io'};
const url=`https://sync.test/v1/vault/${identity.vaultId}`;
async function request(method,body,headers={}){return worker.fetch(new Request(url,{method,headers:{Origin:env.ALLOWED_ORIGIN,Authorization:`Bearer ${identity.token}`,...headers},...(body?{body:JSON.stringify(body)}:{})}),env);}
let loseNextResponse=false;
const api={read:async()=>{const r=await request('GET');assert.equal(r.status,200);return (await r.json()).record;},write:async value=>{const r=await request('PUT',value,{'Content-Type':'application/json'});if(r.status===409)throw new CloudConflictError();assert.equal(r.status,200);const result=await r.json();if(loseNextResponse){loseNextResponse=false;throw new Error('simulated lost response');}return result;}};
assert.equal((await request('GET',null,{Authorization:''})).status,401);
assert.equal((await request('GET',null,{Origin:'https://untrusted.test'})).status,403);
assert.equal((await request('OPTIONS',null,{Authorization:''})).status,204);
assert.equal(await api.read(),null);
const ids=new Set(['q1','q2']),engines=[];
function device(initial={}){
  let snapshot=makeSnapshot(initial,null),state,comparison;const store=new Map();
  const d={get snapshot(){return snapshot;},get state(){return state;},get comparison(){return comparison;},store,edit(note){snapshot=makeSnapshot(applyOperation(Object.fromEntries(snapshot.records.map(r=>[r.questionId,r])),{questionId:'q1',op:'note',value:note}),snapshot.session);engine.localChanged();}};
  const engine=new SyncEngine({identity,api,storage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},getSnapshot:()=>snapshot,applySnapshot:value=>{snapshot=value;},validate:value=>validateSnapshot(value,ids),onState:value=>{state=value;},onCompare:value=>{comparison=value;},debounceMs:100000});
  engines.push(engine);return {...d,get snapshot(){return snapshot;},get state(){return state;},get comparison(){return comparison;},engine};
}
try{
  const a=device({'q1':{...freshRecord('q1'),state:'mastered',note:'A initial',attempts:1,updatedAt:10,origin:'serious'}});
  await a.engine.manual();assert.equal(a.comparison.cloud,null);await a.engine.choose('local');assert.equal(a.state.phase,'idle');assert.equal((await api.read()).version,1);
  const b=device({'q2':{...freshRecord('q2'),note:'B local',updatedAt:9}});
  await b.engine.manual();assert.equal(b.comparison.cloud.records[0].note,'A initial');await b.engine.choose('cloud');assert.equal(b.snapshot.records[0].note,'A initial');assert.ok(JSON.parse(b.engine.recovery())[0].local.records.some(r=>r.note==='B local'));
  a.edit('A changed');await a.engine.sync();await b.engine.sync();assert.equal(b.snapshot.records[0].note,'A changed');
  a.edit('A concurrent');b.edit('B concurrent');await a.engine.sync();await b.engine.sync();assert.equal(b.state.phase,'conflict');assert.equal(b.snapshot.records[0].note,'B concurrent');await b.engine.choose('cloud');assert.equal(b.snapshot.records[0].note,'A concurrent');
  a.edit('A retry-safe');const previous=(await api.read()).version;loseNextResponse=true;await a.engine.sync();assert.equal(a.state.phase,'error');await a.engine.sync();assert.equal(a.state.phase,'idle');assert.equal((await api.read()).version,previous+1);assert.equal((await decryptSnapshot(identity,(await api.read()).payload)).records[0].note,'A retry-safe');
  await b.engine.manual();a.edit('A newer than comparison');await a.engine.sync();await b.engine.choose('local');assert.equal(b.state.phase,'conflict');assert.equal((await decryptSnapshot(identity,(await api.read()).payload)).records[0].note,'A newer than comparison');
  const remote=await api.read();const payload=await encryptSnapshot(identity,makeSnapshot({},null));
  const mutation=crypto.randomUUID();const write={expectedVersion:remote.version,mutationId:mutation,payload};
  const one=await api.write(write),two=await api.write(write);assert.equal(one.version,two.version);
  await assert.rejects(()=>api.write({...write,mutationId:crypto.randomUUID()}),CloudConflictError);
  const stored=db.prepare('SELECT payload FROM progress_vaults').get().payload;assert.ok(!stored.includes('A newer'));assert.ok(!stored.includes(identity.token));
  assert.throws(()=>validateSnapshot({format:'reading-desk-snapshot-v1',records:[],session:{ids:['q1'],index:3}},ids));
  console.log(JSON.stringify({manualLocalSelection:true,manualCloudSelection:true,replacedCopyBackedUp:true,automaticUploadAndDownload:true,concurrentEditsPrompt:true,lostResponseRetryIsIdempotent:true,staleSelectionCannotOverwrite:true,unauthorizedRejected:true,corsRestricted:true,encryptedOnlyInDatabase:true}));
}finally{engines.forEach(e=>e.dispose());db.close();}
