/* Cloudflare file repository. The imported objects are immutable; V2 changes
   are published by optimistic updates to a separate versioned D1 catalogue. */
(function(global) {
  'use strict';
  const INDEX = 'bastcompta-v2-files', IMPORT = 'migration-copy-20261117';
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  function readRevision(response) {
    // A CDN can weaken ETag when it compresses the JSON. The application uses
    // the underlying D1 revision, not the compressed representation's validator.
    const value=response.headers.get('X-BastCompta-Revision') ?? response.headers.get('etag');
    const match=String(value || '').trim().match(/^(?:W\/)?"([1-9][0-9]{0,14})"$/);
    if(!match)throw new Error('Révision Cloudflare absente ou invalide : sauvegarde bloquée.');
    return '"'+match[1]+'"';
  }
  async function digest(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2,'0')).join('');
  }
  function validateFile(file) {
    if (!file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || !file.name ||
        !uuid.test(file.r2Id) || !/^[a-f0-9]{64}$/i.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 10485760) {
      throw new Error('Index Cloudflare invalide : fichier incohérent.');
    }
    return file;
  }
  function validateFiles(files) {
    if (!Array.isArray(files)) throw new Error('Index Cloudflare invalide.');
    const ids = new Set();
    files.forEach(file => { validateFile(file); if (ids.has(file.id)) throw new Error('Identifiant Cloudflare en double.'); ids.add(file.id); });
    return files;
  }
  // Small parser for the actual file query grammar; unknown clauses fail closed.
  function queryFilter(query = '') {
    if (!query.trim()) return () => true;
    const tokens = query.match(/'(?:\\.|[^'\\])*'|!=|=|\(|\)|\b(?:and|or|contains|true|false|name|mimeType|trashed)\b|\S+/g) || [];
    let position = 0;
    const take = expected => { if (tokens[position++] !== expected) throw new Error('Filtre de fichiers non pris en charge.'); };
    const literal = token => { if (!/^'(?:\\.|[^'\\])*'$/.test(token || '')) throw new Error('Filtre invalide.'); return token.slice(1,-1).replace(/\\(['\\])/g,'$1'); };
    function atom() {
      if (tokens[position] === '(') { position++; const value = disjunction(); take(')'); return value; }
      const field = tokens[position++], op = tokens[position++], token = tokens[position++];
      if (!['name','mimeType','trashed'].includes(field) || !['=','!=','contains'].includes(op)) throw new Error('Filtre de fichiers non pris en charge.');
      const value = field === 'trashed' ? (token === 'true' ? true : token === 'false' ? false : (() => {throw new Error('Filtre invalide.');})()) : literal(token);
      return file => op === 'contains' ? String(file[field] || '').includes(value) : op === '!=' ? file[field] !== value : (field === 'trashed' ? !!file[field] : file[field]) === value;
    }
    function conjunction() { let left = atom(); while (tokens[position] === 'and') { position++; const a = left, b = atom(); left = file => a(file) && b(file); } return left; }
    function disjunction() { let left = conjunction(); while (tokens[position] === 'or') { position++; const a = left, b = conjunction(); left = file => a(file) || b(file); } return left; }
    const predicate = disjunction(); if (position !== tokens.length) throw new Error('Filtre de fichiers non pris en charge.'); return predicate;
  }
  class Repository {
    constructor({fetcher = global.fetch.bind(global), base = '/__cloudflare', tokenProvider} = {}) {
      this.fetcher = fetcher; this.base = base; this.tokenProvider = tokenProvider; this.files = []; this.revision = null; this.connected = false; this.tail = Promise.resolve(); this.epoch = 0;
    }
    async request(path, options = {}) {
      const epoch=this.epoch;
      const token = await this.tokenProvider?.(); if (!token) throw new Error('Connectez-vous à BastCompta avec Firebase.');
      if(epoch!==this.epoch)throw new Error('Session Cloudflare fermée.');
      const response = await this.fetcher(this.base + path, {...options, credentials:'omit', redirect:'error', cache:'no-store', headers:{...options.headers, Authorization:'Bearer ' + token}});
      if(epoch!==this.epoch)throw new Error('Session Cloudflare fermée.');
      if (!response.ok && response.status !== 404) {
        const error = new Error(response.status === 412 ? 'Le fichier a changé dans une autre session. Rechargez Cloudflare avant de réessayer ; votre copie locale est conservée.' : `Cloudflare a refusé l’opération (${response.status}).`);
        error.status = response.status; throw error;
      }
      return response;
    }
    close() { this.epoch++; this.connected = false; this.files = []; this.revision = null; }
    async connect() {
      const epoch = ++this.epoch;
      const me = await this.request('/v1/me'); if (!me.ok) throw new Error('Compte Cloudflare non autorisé.');
      const response = await this.request('/v1/data/' + INDEX);
      let files, revision = null;
      if (response.status === 404) {
        const imported = await this.request('/v1/data/' + IMPORT); if (!imported.ok) throw new Error('Copie initiale Cloudflare absente.');
        const source = await imported.json();
        if (source.format !== 'bastcompta-migration-copy-v1' || source.mode !== 'copy-only' || source.phase !== 'verified' || source.verifiedCount !== 82 || source.files?.length !== 82) throw new Error('La copie des 82 fichiers n’est pas vérifiée.');
        files = source.files.map(file => ({...file,id:file.originalId,trashed:false}));
        if (source.totalBytes !== files.reduce((sum,file)=>sum+file.size,0)) throw new Error('Taille totale de la copie incorrecte.');
      } else {
        const payload = await response.json();
        if (payload.format !== 'bastcompta-v2-file-index-v1') throw new Error('Format de l’index V2 inconnu.');
        files = payload.files; revision = readRevision(response);
      }
      validateFiles(files);
      if (epoch !== this.epoch) throw new Error('Connexion Cloudflare annulée.');
      this.files = files; this.revision = revision; this.connected = true; return this;
    }
    list(params = {}) {
      if (!this.connected) throw new Error('Cloudflare non connecté.');
      let files = this.files.filter(queryFilter(params.q));
      if (params.orderBy) {
        const [key,order] = params.orderBy.split(/\s+/);
        if (['name','modifiedTime','createdTime'].includes(key)) files = files.slice().sort((a,b)=>String(a[key] || '').localeCompare(String(b[key] || '')) * (order === 'desc' ? -1 : 1));
      }
      return structuredClone(files);
    }
    async read(id) {
      const file = this.files.find(entry => entry.id === id); if (!this.connected || !file) throw new Error('Fichier Cloudflare introuvable.');
      const response = await this.request('/v1/files/' + file.r2Id); if (!response.ok) throw new Error('Pièce jointe Cloudflare absente.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== file.size || await digest(bytes) !== file.sha256.toLowerCase()) throw new Error('Contrôle d’intégrité Cloudflare en échec : lecture refusée.');
      return new Blob([bytes],{type:file.mimeType || 'application/octet-stream'});
    }
    enqueue(action) { const result = this.tail.then(action); this.tail = result.catch(()=>{}); return result; }
    async commit(files, epoch) {
      if (epoch !== this.epoch || !this.connected) throw new Error('Session Cloudflare fermée.');
      validateFiles(files);
      const response = await this.request('/v1/data/' + INDEX,{method:'PUT',headers:{'Content-Type':'application/json',...(this.revision ? {'If-Match':this.revision} : {'If-None-Match':'*'})},body:JSON.stringify({format:'bastcompta-v2-file-index-v1',files})});
      if (!response.ok) throw new Error('Enregistrement de l’index Cloudflare impossible.');
      // Do not invent a revision from a PUT response; confirm the authoritative
      // payload and its ETag before reporting the file as durably saved.
      const confirmed = await this.request('/v1/data/' + INDEX);
      const payload = await confirmed.json();
      if (JSON.stringify(payload.files) !== JSON.stringify(files)) throw new Error('Une autre session a modifié l’index après l’enregistrement. Rechargez avant de continuer.');
      const revision = readRevision(confirmed);
      if (epoch !== this.epoch) throw new Error('Session fermée.');
      this.files = files; this.revision = revision;
    }
    write({id = '', metadata = {}, content}) {
      const epoch = this.epoch;
      return this.enqueue(async () => {
        if (!this.connected || epoch !== this.epoch) throw new Error('Cloudflare non connecté.');
        const previous = id && this.files.find(file=>file.id === id); if (id && !previous) throw new Error('Fichier à modifier introuvable.');
        metadata = Object.fromEntries(Object.entries(metadata).filter(([key])=>['name','mimeType','appProperties','description','trashed'].includes(key)));
        const now = new Date().toISOString();
        const file = {...previous,...metadata,id:id || crypto.randomUUID(),name:metadata.name || previous?.name,modifiedTime:now,createdTime:previous?.createdTime || now,trashed:metadata.trashed ?? previous?.trashed ?? false};
        if (content !== undefined) {
          const blob = content instanceof Blob ? content : new Blob([content]);
          if (blob.size > 10485760) throw new Error('Le service Cloudflare accepte au maximum 10 Mio par fichier. Le fichier local est conservé.');
          const sha256 = await digest(await blob.arrayBuffer());
          if(epoch!==this.epoch || !this.connected)throw new Error('Session Cloudflare fermée.');
          const uploaded = await this.request('/v1/files',{method:'POST',headers:{'Content-Type':blob.type || 'application/octet-stream'},body:blob});
          if (!uploaded.ok) throw new Error('Envoi Cloudflare impossible.');
          const result = await uploaded.json();
          if (!uuid.test(result.id) || result.sha256 !== sha256 || result.size !== blob.size) throw new Error('L’envoi Cloudflare n’a pas confirmé l’intégrité du fichier.');
          const check = await this.request('/v1/files/' + result.id);
          if (!check.ok || await digest(await check.arrayBuffer()) !== sha256) throw new Error('La relecture du fichier envoyé ne correspond pas.');
          Object.assign(file,{r2Id:result.id,sha256,size:blob.size,mimeType:metadata.mimeType || blob.type || previous?.mimeType || 'application/octet-stream'});
        } else if (!previous) throw new Error('Contenu du nouveau fichier absent.');
        const next = this.files.filter(entry=>entry.id !== file.id).concat(file);
        await this.commit(next,epoch); return structuredClone(file);
      });
    }
    remove(id) {
      // Keep the R2 bytes and a tombstone; never delete an imported object.
      return this.write({id,metadata:{trashed:true}});
    }
  }
  global.BastCloudFiles = Object.freeze({Repository,queryFilter,digest,validateFiles});
})(globalThis);
