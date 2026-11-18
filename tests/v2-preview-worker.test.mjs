import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewHandler} from '../deployment/v2-preview-worker.mjs';
const base='https://bastcompta-v2-preview.example.workers.dev';
test('deployed relay uses its service binding instead of a same-zone HTTP fetch',async()=>{
  let calls=0;
  const handler=createPreviewHandler(async()=>{throw new Error('Public fetch must not be used');});
  const response=await handler(new Request(base+'/__cloudflare/v1/me',{headers:{Authorization:'Bearer fictive.token'}}),{DATA_API:{fetch:async()=>{calls++;return new Response('invalid token',{status:401});}}});
  assert.equal(response.status,401);assert.equal(calls,1);
});
test('GitHub V2 can preflight and read ETags; Firebase authorization is still required',async()=>{
  let calls=0;
  const handler=createPreviewHandler(async()=>{calls++;return Response.json({ok:true},{headers:{ETag:'"2"'}});});
  const origin='https://qvalc.github.io';
  const preflight=await handler(new Request(base+'/__cloudflare/v1/data/bastcompta-v2-files',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization,content-type,if-match'}}),{});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  const read=await handler(new Request(base+'/__cloudflare/v1/me',{headers:{Origin:origin,Authorization:'Bearer fictive.token','Sec-Fetch-Site':'cross-site'}}),{});
  assert.equal(read.status,200);assert.match(read.headers.get('access-control-expose-headers'),/X-BastCompta-Revision/);
  assert.equal(read.headers.get('access-control-allow-credentials'),null);
  assert.equal((await handler(new Request(base+'/__cloudflare/v1/me',{headers:{Origin:origin}}),{})).status,403);
  assert.equal((await handler(new Request(base+'/__cloudflare/v1/data/migration-copy-20261117',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT'}}),{})).status,403);
  assert.equal(calls,1);
});
test('relay redirects to the existing GitHub V2 address and disables indexing',async()=>{
  const handler=createPreviewHandler(async()=>{throw new Error('No API call expected');});
  const response=await handler(new Request(base+'/index.html'),{});
  assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://qvalc.github.io/BastComptaV2/');
  assert.match(response.headers.get('x-robots-tag'),/noindex/);
  assert.ok(!response.headers.get('content-security-policy').includes('www.googleapis.com'));
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('preview relays only V2 routes and forwards neither cookies nor browser origins',async()=>{
  const calls=[];
  const handler=createPreviewHandler(async(url,options)=>{calls.push({url,options});return Response.json({ok:true},{headers:{ETag:'"9"'}});});
  const headers={Authorization:'Bearer fictive.token',Origin:base,'If-Match':'"8"','Content-Type':'application/json',Cookie:'never-forward'};
  const response=await handler(new Request(base+'/__cloudflare/v1/data/bastcompta-v2-files',{method:'PUT',headers,body:'{}'}),{});
  assert.equal(response.status,200);assert.equal(response.headers.get('etag'),'"9"');
  assert.equal(response.headers.get('x-bastcompta-revision'),'"9"');
  assert.equal(calls[0].url,'https://bastcompta-api-staging.seb-n.workers.dev/v1/data/bastcompta-v2-files');
  assert.equal(calls[0].options.headers.get('if-match'),'"8"');
  assert.equal(calls[0].options.redirect,'manual');
  assert.equal(calls[0].options.headers.get('origin'),null);assert.equal(calls[0].options.headers.get('cookie'),null);
  for(const [path,method,extra] of [
    ['/v1/data/migration-copy-20261117','PUT',{}],['/v1/files','DELETE',{}],
    ['/v1/me?target=https://foreign.invalid','GET',{}],['/v1/me','GET',{Origin:'https://foreign.invalid'}],
    ['/v1/me','GET',{'Sec-Fetch-Site':'cross-site'}],['/v1/me','GET',{Authorization:''}]
  ])assert.equal((await handler(new Request(base+'/__cloudflare'+path,{method,headers:{...headers,...extra}}),{})).status,403);
  assert.equal(calls.length,1);
});
test('preview refuses oversized uploads before transmitting them to Cloudflare',async()=>{
  let calls=0;const handler=createPreviewHandler(async()=>{calls++;});
  const response=await handler(new Request(base+'/__cloudflare/v1/files',{method:'POST',headers:{Authorization:'Bearer fictive.token'},body:new Uint8Array(10485761)}),{});
  assert.equal(response.status,413);assert.equal(calls,0);
});
