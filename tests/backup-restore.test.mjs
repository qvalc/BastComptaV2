import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/core/backup-restore.js';
const restore=globalThis.BastBackupRestore;
function archive(owner='one'){
  const entries={
    'manifest-bastcompta.json':{owner:{uid:owner},files:[{category:'googleDriveAppData',id:'old-pdf',name:'invoice.pdf',path:'invoice.pdf'},{category:'googleDriveAppData',id:'old-json',name:'account.json',path:'account.json'}],driveFiles:[{id:'old-pdf',mimeType:'application/pdf'}]},
    '01-donnees-locales/impots-ipp-local.json':{incomeYear:2025,taxYear:2026,priorLosses:123,privateChecklist:{children:true}},
    '01-donnees-locales/comptabilite-local.json':{purchases:[{pdfFileId:'old-pdf',amount:321}]},
    'account.json':{pdfFileId:'old-pdf'},'invoice.pdf':'%PDF-fictive'
  };
  return {file(name){if(!(name in entries))return null;return {async:async type=>{const text=typeof entries[name]==='string'?entries[name]:JSON.stringify(entries[name]);return type==='string'?text:new TextEncoder().encode(text);}};}};
}
test('restore prepares all inputs, preserves IPP, remaps local and remote attachment IDs and PDF type',async()=>{
  const plan=await restore.prepare(archive(),'one'),store=new Map();let files=[];
  const result=await restore.restore(plan,{includeFiles:true,repository:{appendCopies:async entries=>{files=entries;}},storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}});
  assert.equal(files[0].mimeType,'application/pdf');assert.equal(await files[0].content.text(),'%PDF-fictive');
  assert.equal(JSON.parse(store.get('comptabilite-local-v1')).purchases[0].pdfFileId,files[0].id);
  assert.equal(JSON.parse(await files[1].content.text()).pdfFileId,files[0].id);
  assert.deepEqual(JSON.parse(store.get('bastcompta-impots-belgique-v1')),plan.local['bastcompta-impots-belgique-v1']);
  assert.equal(result.files,2);assert.equal(result.localKeys,2);
});
test('wrong owner and remote failure cannot replace local data',async()=>{
  await assert.rejects(restore.prepare(archive(),'other'),/Propriétaire/);
  const plan=await restore.prepare(archive(),'one');let writes=0;
  await assert.rejects(restore.restore(plan,{includeFiles:true,repository:{appendCopies:async()=>{throw Error('Conflict');}},storage:{getItem:()=> 'existing',setItem:()=>writes++}}),/Conflict/);
  assert.equal(writes,0);
});
test('a local storage failure rolls back the previous values',async()=>{
  const plan=await restore.prepare(archive(),'one'),store=new Map(Object.keys(plan.local).map(k=>[k,'previous']));let calls=0;
  await assert.rejects(restore.restore(plan,{includeFiles:false,storage:{getItem:k=>store.get(k),setItem:(k,v)=>{if(++calls===2)throw Error('Quota');store.set(k,v);},removeItem:k=>store.delete(k)}}),/Quota/);
  assert.ok([...store.values()].every(value=>value==='previous'));
});
test('a session change during the copy cannot write into the next account',async()=>{
  const plan=await restore.prepare(archive(),'one');let current=true,writes=0;
  await assert.rejects(restore.restore(plan,{includeFiles:true,isCurrent:()=>current,repository:{appendCopies:async()=>{current=false;}},storage:{getItem:()=>null,setItem:()=>writes++}}),/compte connecté/);
  assert.equal(writes,0);
});
