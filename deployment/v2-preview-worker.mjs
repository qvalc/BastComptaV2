// V2 API relay. The application stays on its existing GitHub Pages URL.
const UPSTREAM='https://bastcompta-api-staging.seb-n.workers.dev';
const GITHUB_V2_ORIGIN='https://qvalc.github.io';
const API_ROUTES={
  GET:/^\/v1\/(?:me|data\/(?:migration-copy-20261117|bastcompta-v2-files)|files\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i,
  PUT:/^\/v1\/data\/bastcompta-v2-files$/,
  POST:/^\/v1\/files$/
};
const CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.sheetjs.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://bastcompta-mail.qvalc-be.workers.dev; frame-src 'self' blob: https://bastcompta-3aa41.firebaseapp.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
function secure(response){
  const result=new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
  result.headers.set('Content-Security-Policy',CSP);
  result.headers.set('X-Content-Type-Options','nosniff');
  result.headers.set('Referrer-Policy','no-referrer');
  result.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
  result.headers.set('Cache-Control','no-store');
  return result;
}
function error(status,message){return secure(new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8'}}));}
function cors(response,origin){
  if(origin===GITHUB_V2_ORIGIN){
    response.headers.set('Access-Control-Allow-Origin',GITHUB_V2_ORIGIN);
    response.headers.set('Access-Control-Expose-Headers','ETag, X-Content-SHA256');
    response.headers.append('Vary','Origin');
  }
  return response;
}
export function createPreviewHandler(fetcher=fetch){
  return async function handle(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/__version'&&request.method==='GET')return secure(Response.json({application:'BastComptaV2',environment:'preview',storage:'Cloudflare staging'}));
    if(!url.pathname.startsWith('/__cloudflare/')){
      if((url.pathname==='/'||url.pathname==='/index.html')&&request.method==='GET')return secure(Response.redirect('https://qvalc.github.io/BastComptaV2/',302));
      return error(404,'Route introuvable.');
    }
    const path=url.pathname.slice('/__cloudflare'.length),origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
    const fromGithub=origin===GITHUB_V2_ORIGIN,respond=response=>cors(response,origin);
    if(request.method==='OPTIONS'){
      const method=request.headers.get('access-control-request-method'),headers=(request.headers.get('access-control-request-headers')||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
      if(!fromGithub||url.search||!API_ROUTES[method]?.test(path)||headers.some(value=>!['authorization','content-type','if-match','if-none-match'].includes(value)))return error(403,'Pré-vérification refusée.');
      const response=respond(secure(new Response(null,{status:204})));
      response.headers.set('Access-Control-Allow-Methods','GET, PUT, POST');
      response.headers.set('Access-Control-Allow-Headers','Authorization, Content-Type, If-Match, If-None-Match');
      return response;
    }
    if(url.search||!API_ROUTES[request.method]?.test(path)||
        (origin&&origin!==url.origin&&!fromGithub)||(site&&!['same-origin','none'].includes(site)&&!fromGithub)||
        !/^Bearer [A-Za-z0-9_.-]+$/.test(request.headers.get('authorization')||''))return respond(error(403,'Opération refusée.'));
    try{
      let body;
      if(request.body){
        const reader=request.body.getReader(),chunks=[];let length=0;
        while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>10485760){await reader.cancel();return respond(error(413,'Fichier trop volumineux.'));}chunks.push(value);}
        body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
      }
      const headers=new Headers();
      for(const name of ['authorization','content-type','if-match','if-none-match'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
      // Same-origin relay: the existing API still authenticates Firebase and its
      // allowed UID. No browser origin, cookies or arbitrary target are forwarded.
      const upstreamFetch=env.DATA_API?.fetch.bind(env.DATA_API)||fetcher;
      const upstream=await upstreamFetch(UPSTREAM+path,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(60000)});
      if(upstream.status>=300&&upstream.status<400)return respond(error(502,'Redirection du service Cloudflare refusée.'));
      const resultHeaders=new Headers();
      for(const name of ['content-type','etag','x-content-sha256'])if(upstream.headers.has(name))resultHeaders.set(name,upstream.headers.get(name));
      return respond(secure(new Response(upstream.body,{status:upstream.status,headers:resultHeaders})));
    }catch(failure){
      console.error('v2-relay-error',String(failure?.name||'Error'),String(failure?.message||'').replace(/Bearer\s+[^\s"']+/g,'Bearer [redacted]').slice(0,220));
      return respond(error(502,'Service Cloudflare indisponible. Aucun enregistrement confirmé.'));
    }
  };
}
export default {fetch:createPreviewHandler()};
