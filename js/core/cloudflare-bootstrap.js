/* V2 bootstrap, loaded before the unchanged app scripts in every page. */
(function(global) {
  'use strict';
  const nativeFetch = global.fetch.bind(global);
  const rawLocal = global.localStorage, rawSession = global.sessionStorage;
  const state = {user:rawSession.getItem('bastcompta-v2-active-user') || 'anonymous',auth:null,repository:null,opening:null};
  function scoped(raw, owner) {
    const prefix = () => `bastcompta-v2:${owner ? state.user : 'session'}:`;
    // Firebase auth persistence must survive the transition anonymous -> UID.
    // Its named V2 app has a shared auth namespace; business values stay per UID.
    const authPrefix = 'bastcompta-v2:auth:';
    const physical = key => owner && String(key).startsWith('firebase:') ? authPrefix+key : prefix()+key;
    const keys = () => Object.keys(raw).filter(key=>key.startsWith(prefix()) || (owner && key.startsWith(authPrefix)))
      .map(key=>key.startsWith(authPrefix)?key.slice(authPrefix.length):key.slice(prefix().length));
    const api = {
      getItem:key=>raw.getItem(physical(key)),
      setItem(key,value) { raw.setItem(physical(key),String(value)); if (owner && !String(key).startsWith('firebase:')) global.BastV2Storage?.mirror(String(key),String(value)); },
      removeItem(key) {raw.removeItem(physical(key)); if(owner && !String(key).startsWith('firebase:')) global.BastV2Storage?.mirror(String(key),null);},
      clear() {keys().forEach(key=>api.removeItem(key));}, key:index=>keys()[index] ?? null,
      get length() {return keys().length;}
    };
    return new Proxy(api,{ownKeys:keys,getOwnPropertyDescriptor:(_obj,key)=>keys().includes(key) ? {enumerable:true,configurable:true,value:api.getItem(key)} : undefined,
      get:(obj,key)=>key in obj ? obj[key] : api.getItem(key),set:(_obj,key,value)=>{api.setItem(key,value);return true;}});
  }
  Object.defineProperty(global,'localStorage',{value:scoped(rawLocal,true)});
  Object.defineProperty(global,'sessionStorage',{value:scoped(rawSession,false)});
  // Preserve the original cross-frame refresh events with logical key names.
  const translatedEvents=new WeakSet();
  global.addEventListener?.('storage',event=>{
    if(translatedEvents.has(event))return;
    if(!event.key?.startsWith('bastcompta-v2:')) {event.stopImmediatePropagation();return;}
    const prefixes=[`bastcompta-v2:${state.user}:`,'bastcompta-v2:auth:','bastcompta-v2:session:'];
    const prefix=prefixes.find(value=>event.key.startsWith(value));
    event.stopImmediatePropagation();
    if(prefix){const translated=new StorageEvent('storage',{key:event.key.slice(prefix.length),oldValue:event.oldValue,newValue:event.newValue,url:event.url,storageArea:event.storageArea});translatedEvents.add(translated);global.dispatchEvent(translated);}
  },true);
  async function legacy(input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url,location.href);
    if (url.origin !== 'https://www.googleapis.com' || !/^\/(?:upload\/)?drive\/v3\/files(?:\/|$)/.test(url.pathname)) {
      if (url.origin === 'https://www.googleapis.com' && url.pathname === '/oauth2/v3/userinfo') return Response.json({email:state.auth?.currentUser?.email});
      return nativeFetch(input,options);
    }
    try {
      const repo = await ensure();
      const method = String(options.method || input?.method || 'GET').toUpperCase();
      const match = url.pathname.match(/^\/(?:upload\/)?drive\/v3\/files(?:\/([^/]+))?$/); if(!match) return new Response('Chemin Cloudflare inconnu',{status:404});
      const id = match[1] ? decodeURIComponent(match[1]) : '';
      if (method === 'GET' && !id) return Response.json({files:repo.list(Object.fromEntries(url.searchParams))});
      if (method === 'GET') {
        const file = repo.files.find(entry=>entry.id===id); if(!file) return new Response('Fichier absent',{status:404});
        if(url.searchParams.get('alt')==='media') return new Response(await repo.read(id),{headers:{'Content-Type':file.mimeType || 'application/octet-stream'}});
        return Response.json(file);
      }
      if (method === 'DELETE') {await repo.remove(id);return new Response(null,{status:204});}
      if (!['POST','PATCH'].includes(method)) return new Response('Méthode inconnue',{status:405});
      const form = options.body;
      let metadata, content;
      if (form instanceof FormData) {const part=form.get('metadata');metadata=JSON.parse(typeof part==='string'?part:await part.text());content=form.get('file') ?? undefined;}
      else metadata = typeof form === 'string' ? JSON.parse(form) : {};
      return Response.json(await repo.write({id,metadata,content}));
    } catch(error) {return Response.json({error:{message:error.message}},{status:error.status || 503});}
  }
  global.fetch = legacy;
  const gapi = {
    load:(_name,cb)=> typeof cb==='function'?cb():cb.callback(),
    client:{
      init:async()=>{},setToken(){},getToken:()=>({access_token:'cloudflare-v2'}),
      drive:{files:{list:async params=>({result:{files:(await ensure()).list(params)}})}}
    }
  };
  global.gapi = gapi;
  // Local compatibility entry points: no Google OAuth SDK is loaded or called.
  const oauth = {revoke(){},initTokenClient:options=>{
    const client = {...options,requestAccessToken:()=>ensure().then(()=>client.callback({access_token:'cloudflare-v2',expires_in:3600})).catch(error=>{client.callback({error:'cloudflare_unavailable'});client.error_callback?.(error);})};return client;
  }};
  global.google = {accounts:{oauth2:oauth}};
  async function ensure() {
    if (global.parent !== global && global.parent.BastCloudV2?.state.auth) return global.parent.BastCloudV2.ensure();
    if (!state.auth?.currentUser) throw new Error('Connectez-vous à BastCompta.');
    if (state.repository?.connected) return state.repository;
    if (state.opening) return state.opening;
    const firebaseUser=state.auth.currentUser;
    const page=new URL(location.href);
    const githubV2=page.origin==='https://qvalc.github.io' && (page.pathname==='/BastComptaV2' || page.pathname.startsWith('/BastComptaV2/'));
    const base=githubV2?'https://bastcompta-v2-preview.seb-n.workers.dev/__cloudflare':'/__cloudflare';
    state.repository = new global.BastCloudFiles.Repository({base,fetcher:nativeFetch,tokenProvider:()=>firebaseUser.getIdToken()});
    const repository = state.repository;
    state.opening = repository.connect().then(()=>repository).finally(()=>{state.opening=null;}); return state.opening;
  }
  async function bind(auth) {
    state.auth = auth;
    const user = auth.currentUser; if(!user) throw new Error('Compte Firebase absent.');
    if(state.user !== user.uid) {state.repository?.close();state.repository=null;state.opening=null;}
    state.user=user.uid;rawSession.setItem('bastcompta-v2-active-user',user.uid);
    const repo = await ensure();
    await global.BastV2Storage?.restoreMissingLocalStorageFromIndexedDB();
    const sources = {'bastcompta-impots-ipp-settings.json':'bastcompta-impots-belgique-v1','bastcompta-crm-sync.json':'devis-facture-style-vrai-document','bastcompta-chantiers-sync.json':'bastcompta-chantiers-v1','bastcompta-personnel-sync.json':'bastcompta-personnel-v1','bastcompta-fournisseurs-sync.json':'bastcompta-fournisseurs-v1','bastcompta-terrain-drafts.json':'bastcompta-terrain-drafts-v1'};
    const annual = repo.files.filter(file=>!file.trashed && /^comptabilite-.*-\d{4}\.json$/i.test(file.name)).sort((a,b)=>b.name.localeCompare(a.name));
    if(annual[0]) sources[annual[0].name]='comptabilite-local-v1';
    for(const [name,key] of Object.entries(sources)) {
      if(localStorage.getItem(key)!==null) continue; // Preserve an unsaved V2 local edit.
      const matches=repo.files.filter(file=>file.name===name&&!file.trashed);
      if(new Set(matches.map(file=>file.sha256)).size>1) throw new Error(`Plusieurs versions de ${name} : sélection explicite nécessaire.`);
      if(matches[0]) {
        const text=await(await repo.read(matches[0].id)).text();JSON.parse(text);
        if(state.user!==user.uid || auth.currentUser?.uid!==user.uid)throw new Error('Le compte Firebase a changé pendant le chargement.');
        localStorage.setItem(key,text);
      }
    }
    localStorage.setItem('bastcompta_google_was_connected','1'); return repo;
  }
  function disconnect(){state.repository?.close();state.repository=null;state.opening=null;}
  global.BastCloudV2 = {state,ensure,bind,disconnect,nativeFetch};
})(window);
