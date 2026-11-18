import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/core/cloudflare-bootstrap.js',import.meta.url),'utf8');
class Storage {
  getItem(key){return Object.hasOwn(this,key)?this[key]:null;}
  setItem(key,value){this[key]=String(value);}
  removeItem(key){delete this[key];}
}
test('V2 storage is isolated from V1 and other users; legacy CRUD is routed only to Cloudflare',async()=>{
  const raw=new Storage();raw.setItem('comptabilite-local-v1','V1 untouched');const calls=[];
  const configurations=[];
  class Repo {
    constructor(config){configurations.push(config);this.files=[];this.connected=false;}
    async connect(){this.connected=true;return this;}
    close(){this.connected=false;}
    list(){return this.files;}
    async write(input){calls.push(input);return {id:'fictive-id',...input.metadata};}
  }
  const native=[],listeners=[];
  class LogicalStorageEvent {
    constructor(type,values){this.type=type;Object.assign(this,values);this.stopped=false;}
    stopImmediatePropagation(){this.stopped=true;}
  }
  const context={URL,Response,Blob,FormData,Map,Set,Promise,console,localStorage:raw,sessionStorage:new Storage(),location:{href:'http://127.0.0.1:4173/'},
    fetch:async url=>{native.push(url);return new Response('{}');},BastCloudFiles:{Repository:Repo},StorageEvent:LogicalStorageEvent,
    addEventListener:(type,callback)=>{if(type==='storage')listeners.push(callback);},
    dispatchEvent:event=>{for(const callback of listeners){callback(event);if(event.stopped)break;}}};
  context.window=context;context.parent=context;vm.createContext(context);vm.runInContext(source,context);
  context.localStorage.setItem('firebase:authUser:v2','fictive auth persistence');
  const auth={currentUser:{uid:'one',email:'fictive@example.invalid',getIdToken:async()=> 'fictive'}};
  await context.BastCloudV2.bind(auth);
  assert.equal(context.localStorage.getItem('firebase:authUser:v2'),'fictive auth persistence');
  assert.equal(context.localStorage.getItem('comptabilite-local-v1'),null);
  context.localStorage.setItem('comptabilite-local-v1','V2 owner one');
  assert.equal(raw.getItem('comptabilite-local-v1'),'V1 untouched');
  auth.currentUser={...auth.currentUser,uid:'two'};await context.BastCloudV2.bind(auth);
  const received=[];context.addEventListener('storage',event=>received.push(event.key));
  context.dispatchEvent(new LogicalStorageEvent('storage',{key:'bastcompta-v2:two:comptabilite-local-v1',newValue:'new'}));
  context.dispatchEvent(new LogicalStorageEvent('storage',{key:'bastcompta-v2:one:comptabilite-local-v1',newValue:'private'}));
  assert.deepEqual(received,['comptabilite-local-v1']);
  assert.equal(context.localStorage.getItem('comptabilite-local-v1'),null);
  context.localStorage.clear();assert.equal(raw.getItem('bastcompta-v2:one:comptabilite-local-v1'),'V2 owner one');
  const form=new FormData();form.append('metadata',new Blob(['{"name":"fictive.json"}'],{type:'application/json'}));form.append('file',new Blob(['{}']));
  const response=await context.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:'POST',body:form});
  assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].metadata.name,'fictive.json');assert.equal(native.length,0);
  context.BastCloudV2.disconnect();context.location.href='https://qvalc.github.io/BastComptaV2/index.html';
  await context.BastCloudV2.ensure();assert.equal(configurations.at(-1).base,'https://bastcompta-v2-preview.seb-n.workers.dev/__cloudflare');
  context.BastCloudV2.disconnect();context.location.href='https://qvalc.github.io/another-repo/index.html';
  await context.BastCloudV2.ensure();assert.equal(configurations.at(-1).base,'/__cloudflare');
});
