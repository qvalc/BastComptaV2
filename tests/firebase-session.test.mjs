import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeV2Auth,createPortalSession,terrainSessionUrl} from '../js/core/firebase-session.js';
test('Terrain loads the corrected HTML even if its previous iframe is cached',()=>{
  const url=new URL(terrainSessionUrl('terrain.html?embedded=1','https://qvalc.github.io/BastComptaV2/'));
  assert.equal(url.origin,'https://qvalc.github.io');assert.equal(url.pathname,'/BastComptaV2/terrain.html');
  assert.equal(url.searchParams.get('embedded'),'1');assert.equal(url.searchParams.get('v2Session'),'local-auth-20261118');
});
test('portal and Terrain select LOCAL before Firebase can migrate a different frame session',()=>{
  const local={type:'LOCAL'},calls=[];
  const sdk=(app,options)=>{calls.push({app,options});return {app,options};};
  initializeV2Auth('portal',sdk,local);initializeV2Auth('terrain',sdk,local);
  assert.ok(calls.every(call=>call.options.persistence===local));
  for(const name of ['index','terrain']){
    const source=readFileSync(new URL(`../js/${name}.js`,import.meta.url),'utf8');
    assert.match(source,/initializeV2Auth\(app, initializeAuth, browserLocalPersistence\)/);
    assert.ok(!/\bgetAuth\s*\(|\bsetPersistence\s*\(/.test(source));
  }
});
test('explicit login retries a failed portal load even when Firebase UID did not change',async()=>{
  const user={uid:'fictive'},errors=[];let attempts=0,closed=0;
  const session=createPortalSession({currentUser:()=>user,open:async()=>{if(++attempts===1)throw new Error('temporary Cloudflare failure');},close:()=>closed++,onError:error=>errors.push(error.message)});
  assert.equal(await session.enter(user),false);
  assert.equal(await session.enter(user),true);
  assert.equal(attempts,2);assert.equal(closed,0);assert.equal(errors.length,1);
});
test('concurrent auth callback and login submit share one initialization',async()=>{
  const user={uid:'fictive'};let release,calls=0;
  const session=createPortalSession({currentUser:()=>user,open:()=>{calls++;return new Promise(resolve=>{release=resolve;});},close(){},onError(){}});
  const first=session.enter(user),second=session.enter(user);assert.equal(first,second);
  await Promise.resolve();release();assert.equal(await first,true);assert.equal(calls,1);
});
test('a late loading result cannot reopen a portal after a genuine sign-out',async()=>{
  let user={uid:'fictive'},release,closed=0,errorCount=0;
  const session=createPortalSession({currentUser:()=>user,open:()=>new Promise(resolve=>{release=resolve;}),close:()=>closed++,onError:()=>errorCount++});
  const loading=session.enter(user);await Promise.resolve();user=null;await session.enter(null);release();
  assert.equal(await loading,false);assert.equal(closed,1);assert.equal(errorCount,0);
});
