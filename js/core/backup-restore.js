/* Prepare a restore completely before writing; append copies, never replace files by name. */
(function(global){
  'use strict';
  const locals={
    'devis-facture-local.json':'devis-facture-style-vrai-document',
    'comptabilite-local.json':'comptabilite-local-v1',
    'suivi-client-local.json':'bastcompta-chantiers-v1',
    'personnel-local.json':'bastcompta-personnel-v1',
    'fournisseurs-local.json':'bastcompta-fournisseurs-v1',
    'impots-ipp-local.json':'bastcompta-impots-belgique-v1'
  };
  function remap(value,ids){
    if(typeof value==='string')return ids.get(value) || value;
    if(Array.isArray(value))return value.map(item=>remap(item,ids));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,remap(item,ids)]));
    return value;
  }
  async function prepare(zip,uid){
    if(!uid)throw Error('Utilisateur non connecté.');
    const manifestFile=zip.file('manifest-bastcompta.json');
    const manifest=manifestFile?JSON.parse(await manifestFile.async('string')):null;
    if(!manifest?.owner?.uid || manifest.owner.uid!==uid)throw Error('Propriétaire de la sauvegarde différent ou absent. Restauration bloquée.');
    const local={};
    for(const [name,key]of Object.entries(locals)){
      const file=zip.file('01-donnees-locales/'+name);
      if(file)local[key]=JSON.parse(await file.async('string'));
    }
    const tariffs=zip.file('01-donnees-locales/tarifs-local.json');
    if(tariffs){const data=JSON.parse(await tariffs.async('string'));if(Array.isArray(data.tarifs))local['bastcompta_tarifs_v7_vierge_sans_fiche']=data.tarifs;if(Array.isArray(data.categories))local['bastcompta_tarifs_categories_v3_vierge_sans_fiche']=data.categories;}
    const files=[],ids=new Set();
    for(const entry of manifest.files || []){
      if(entry.category!=='googleDriveAppData')continue;
      const item=entry.path&&zip.file(entry.path);
      if(!item)throw Error('Fichier du manifeste absent du ZIP.');
      const info=(manifest.driveFiles || []).find(file=>file.id===entry.id) || {};
      if(!entry.id || ids.has(entry.id))throw Error('Identifiant absent ou en double dans la sauvegarde.');
      ids.add(entry.id);
      const name=entry.name || info.name || entry.path.split('/').pop();
      const bytes=await item.async('uint8array');
      const mimeType=info.mimeType || (/\.json$/i.test(name)?'application/json':/\.pdf$/i.test(name)?'application/pdf':/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':'application/octet-stream');
      if(bytes.length>10485760)throw Error('Un fichier de la sauvegarde dépasse 10 Mio. Aucune restauration commencée.');
      const json=/\.json$/i.test(name)?JSON.parse(new TextDecoder().decode(bytes)):undefined;
      files.push({originalId:entry.id,name,mimeType,bytes,json});
    }
    return {local,files};
  }
  async function restore(plan,{repository,storage,includeFiles,isCurrent=()=>true}){
    if(!isCurrent())throw Error('Le compte connecté a changé. Restauration interrompue.');
    const ids=new Map(includeFiles?plan.files.map(file=>[file.originalId,crypto.randomUUID()]):[]);
    const entries=plan.files.map(file=>({id:ids.get(file.originalId),name:file.name,mimeType:file.mimeType,
      content:new Blob([file.json===undefined?file.bytes:JSON.stringify(remap(file.json,ids))],{type:file.mimeType})}));
    // Validate and serialize local data before touching the remote catalogue.
    const values=Object.fromEntries(Object.entries(plan.local).map(([key,value])=>[key,JSON.stringify(remap(value,ids))]));
    if(includeFiles&&entries.length)await repository.appendCopies(entries);
    if(!isCurrent())throw Error('Le compte connecté a changé. Les données locales sont conservées.');
    const previous=new Map(Object.keys(values).map(key=>[key,storage.getItem(key)]));
    try{for(const [key,value]of Object.entries(values))storage.setItem(key,value);}
    catch(error){for(const [key,value]of previous){if(value===null)storage.removeItem(key);else storage.setItem(key,value);}throw error;}
    return {files:includeFiles?entries.length:0,localKeys:Object.keys(values).length,idMap:ids};
  }
  global.BastBackupRestore=Object.freeze({prepare,restore,remap});
})(globalThis);
