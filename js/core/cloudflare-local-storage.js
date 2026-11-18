/* The same BastStorage API, with V2/user-scoped local and IndexedDB copies. */
(function(global){
  'use strict';
  const pending = new Set(), databases = new Map();
  function openDatabase(owner) {
    if(!databases.has(owner)) databases.set(owner,new Promise((resolve,reject)=>{
      const request=indexedDB.open('BastComptaDB-v2-'+owner,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('values');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    }));
    return databases.get(owner);
  }
  async function operation(owner,key,value,write) {
    const db=await openDatabase(owner);
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('values',write?'readwrite':'readonly'),store=tx.objectStore('values');
      const request=write?(value===null?store.delete(key):store.put(value,key)):store.get(key);
      tx.oncomplete=()=>resolve(request.result ?? null);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  function mirror(key,value) {
    const owner=global.BastCloudV2.state.user;
    const task=operation(owner,key,value,true).catch(error=>console.warn('Copie IndexedDB V2 indisponible.',error));
    pending.add(task);task.finally(()=>pending.delete(task));return task;
  }
  async function get(key,fallback=null) {
    const local=localStorage.getItem(key);if(local!==null)return local;
    const stored=await operation(global.BastCloudV2.state.user,key,null,false);return stored ?? fallback;
  }
  async function set(key,value){localStorage.setItem(key,value);await mirror(key,String(value));return true;}
  async function getJson(key,fallback=null){try {return JSON.parse(await get(key,JSON.stringify(fallback)));}catch{return fallback;}}
  global.BastV2Storage={mirror,get,set,getJson,setJson:(key,value,pretty=false)=>set(key,JSON.stringify(value,null,pretty?2:0)),
    remove:async key=>{localStorage.removeItem(key);await mirror(key,null);return true;},flush:()=>Promise.all([...pending]),
    mirrorExistingLocalStorage:()=>Promise.all(Object.keys(localStorage).map(key=>mirror(key,localStorage.getItem(key)))),
    restoreMissingLocalStorageFromIndexedDB:async()=>{
      for(const key of global.BastComptaStorageKeys?.important || []) {
        if(localStorage.getItem(key)!==null)continue;
        const stored=await operation(global.BastCloudV2.state.user,key,null,false);
        if(typeof stored==='string')localStorage.setItem(key,stored);
      }
    },get dbName(){return 'BastComptaDB-v2-'+global.BastCloudV2.state.user;}};
})(window);
