import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/core/cloudflare-files.js';
const {Repository,digest,queryFilter}=globalThis.BastCloudFiles;

async function fixture({revisionHeaders=revision=>({ETag:`"${revision}"`})}={}) {
  const objects=new Map(), original=new TextEncoder().encode('{"fictive":true}'), sha=await digest(original);
  const files=Array.from({length:82},(_,i)=>{
    const id=crypto.randomUUID();objects.set(id,original);
    return {originalId:`original-${i}`,name:`fictive-${i}.json`,r2Id:id,mimeType:'application/json',size:original.byteLength,sha256:sha};
  });
  let index=null,revision=0;const calls=[];
  const fetcher=async(url,options={})=>{
    calls.push({url,options}); const method=options.method || 'GET';
    if(url.endsWith('/v1/me'))return Response.json({uid:'fictive-owner'});
    if(url.endsWith('/migration-copy-20261117'))return Response.json({format:'bastcompta-migration-copy-v1',mode:'copy-only',phase:'verified',verifiedCount:82,totalBytes:82*original.byteLength,files});
    if(url.endsWith('/bastcompta-v2-files')){
      if(method==='GET')return index?Response.json(index,{headers:revisionHeaders(revision)}):new Response(null,{status:404});
      if((revision&&options.headers['If-Match']!==`"${revision}"`)||(!revision&&options.headers['If-None-Match']!=='*'))return new Response(null,{status:412});
      index=JSON.parse(options.body);revision++;return Response.json({revision});
    }
    if(url.endsWith('/v1/files')&&method==='POST'){
      const bytes=new Uint8Array(await options.body.arrayBuffer()),id=crypto.randomUUID();objects.set(id,bytes);
      return Response.json({id,size:bytes.byteLength,sha256:await digest(bytes)});
    }
    const id=url.split('/').at(-1);return objects.has(id)?new Response(objects.get(id)):new Response(null,{status:404});
  };
  return {files,objects,calls,repository:()=>new Repository({fetcher,tokenProvider:async()=> 'fictive.token'}),get index(){return index;}};
}
test('connect reads 82 verified objects without any write and validates media bytes',async()=>{
  const f=await fixture(),repo=await f.repository().connect();
  assert.equal(repo.list({q:'trashed=false'}).length,82);
  assert.equal(await(await repo.read('original-0')).text(),'{"fictive":true}');
  assert.ok(f.calls.every(call=>!call.options.method || call.options.method==='GET'));
  f.objects.set(f.files[0].r2Id,new TextEncoder().encode('damaged'));
  await assert.rejects(repo.read('original-0'),/intégrité/);
});
test('create/update/delete retain original R2 objects and stable document IDs; catalogue can be reopened',async()=>{
  const f=await fixture(),repo=await f.repository().connect();
  const original=f.files[0].r2Id;
  const updated=await repo.write({id:'original-0',metadata:{name:'renamed.json'},content:new Blob(['{"new":true}'],{type:'application/json'})});
  assert.equal(updated.id,'original-0');assert.notEqual(updated.r2Id,original);assert.ok(f.objects.has(original));
  const added=await repo.write({metadata:{name:'new.json',appProperties:{workerId:'fiction'}},content:new Blob(['{}'])});
  assert.equal(repo.list().length,83);assert.equal(added.appProperties.workerId,'fiction');
  await repo.remove(updated.id);assert.equal(repo.list({q:'trashed=false'}).length,82);
  const reopened=await f.repository().connect();assert.equal(reopened.list({q:'trashed=true'})[0].id,updated.id);
  assert.ok(f.calls.every(call=>!call.url.includes('googleapis.com')));
  assert.ok(f.calls.filter(call=>call.options.method==='PUT').every(call=>call.url.endsWith('/bastcompta-v2-files')));
});
test('concurrent sessions fail safely instead of overwriting the other catalogue',async()=>{
  const f=await fixture(),a=await f.repository().connect(),b=await f.repository().connect();
  await a.write({metadata:{name:'first.json'},content:'first'});
  await assert.rejects(b.write({metadata:{name:'second.json'},content:'second'}),error=>error.status===412);
  assert.ok(f.index.files.some(file=>file.name==='first.json'));
  assert.ok(!f.index.files.some(file=>file.name==='second.json'));
});
test('CDN weak ETags and the explicit revision header retain strict optimistic writes',async()=>{
  for(const revisionHeaders of [revision=>({ETag:`W/"${revision}"`}),revision=>({'X-BastCompta-Revision':`"${revision}"`})]) {
    const f=await fixture({revisionHeaders}),repo=await f.repository().connect();
    await repo.write({metadata:{name:'fictive-first.json'},content:'first'});
    assert.equal(repo.revision,'"1"');
    await repo.write({metadata:{name:'fictive-second.json'},content:'second'});
    assert.equal(repo.revision,'"2"');
    const reopened=await f.repository().connect();assert.equal(reopened.revision,'"2"');
  }
});
test('an absent or invalid revision never enables an unconditional overwrite',async()=>{
  for(const revisionHeaders of [()=>({}),()=>({ETag:'W/"invalid"'})]){
    const f=await fixture({revisionHeaders}),repo=await f.repository().connect();
    await assert.rejects(repo.write({metadata:{name:'fictive.json'},content:'test'}),/Révision Cloudflare/);
    const writes=f.calls.filter(call=>call.options.method==='PUT');
    assert.equal(writes.length,1);assert.equal(writes[0].options.headers['If-None-Match'],'*');
    await assert.rejects(repo.write({metadata:{name:'second.json'},content:'second'}),error=>error.status===412);
  }
});
test('oversized content is refused before uploading; file queries preserve grouping and duplicate names',async()=>{
  const f=await fixture(),repo=await f.repository().connect(),before=f.calls.length;
  await assert.rejects(repo.write({metadata:{name:'large'},content:new Blob([new Uint8Array(10485761)])}),/10 Mio/);
  assert.equal(f.calls.length,before);
  const predicate=queryFilter("trashed=false and (name contains 'devis-' or name contains 'facture-') and mimeType='application/json'");
  assert.equal(predicate({trashed:false,name:'facture-1.json',mimeType:'application/json'}),true);
  assert.equal(predicate({trashed:true,name:'devis-1.json',mimeType:'application/json'}),false);
  assert.throws(()=>queryFilter("unknown='x'"));
});
