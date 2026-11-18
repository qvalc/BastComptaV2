import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudProfileAccess} from '../js/cloudflare-profile.js';
test('existing V1 profile is only read; V2 changes are written to Cloudflare and other UIDs are refused',async()=>{
  const oldWindow=globalThis.window,calls=[];let cloudData=null;
  const repo={files:[],read:async()=>new Blob([JSON.stringify(cloudData)]),write:async input=>{calls.push(input);cloudData=JSON.parse(await input.content.text());repo.files=[{id:'fictive-file',name:input.metadata.name}];}};
  globalThis.window={BastCloudV2:{state:{auth:{currentUser:{uid:'fictive'}}},ensure:async()=>repo}};
  try {
    let reads=0;
    const api=cloudProfileAccess(async()=>{reads++;return {exists:()=>true,data:()=>({plan:'owner',pseudo:'Original'})};});
    const ref={path:'users/fictive'};
    await api.updateDoc(ref,{pseudo:'V2 name'});
    assert.equal(reads,1);assert.equal(calls.length,1);assert.equal(calls[0].metadata.name,'bastcompta-v2-account.json');
    assert.deepEqual(cloudData,{plan:'owner',pseudo:'V2 name'});
    assert.equal((await api.getDoc(ref)).data().pseudo,'V2 name');
    await assert.rejects(api.setDoc({path:'users/another-owner'},{plan:'owner'}),/compte V2/);
  } finally {if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
