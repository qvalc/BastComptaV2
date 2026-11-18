import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const upstream='https://bastcompta-api-staging.seb-n.workers.dev';
const routes = {
  GET:/^\/v1\/(?:me|data\/(?:migration-copy-20261117|bastcompta-v2-files)|files\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i,
  PUT:/^\/v1\/data\/bastcompta-v2-files$/,
  POST:/^\/v1\/files$/
};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json','.svg':'image/svg+xml'};
const csp="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.sheetjs.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://bastcompta-mail.qvalc-be.workers.dev; frame-src 'self' blob: https://bastcompta-3aa41.firebaseapp.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
export function createV2Server({fetcher=fetch}={}) {
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',csp);res.setHeader('Referrer-Policy','no-referrer');
    try {
      if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') || (req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)) {res.writeHead(403).end('Origine refusée');return;}
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname.startsWith('/__cloudflare/')) {
        const path=url.pathname.slice('/__cloudflare'.length);
        if(!routes[req.method]?.test(path) || url.search || (req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])) || !/^Bearer [A-Za-z0-9_.-]+$/.test(req.headers.authorization || '')) {res.writeHead(403).end('Opération refusée');return;}
        const parts=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>10485760){res.writeHead(413).end('Fichier trop volumineux');return;}parts.push(chunk);}
        const headers={Authorization:req.headers.authorization};
        for(const name of ['content-type','if-match','if-none-match']) if(req.headers[name]) headers[name]=req.headers[name];
        const response=await fetcher(upstream+path,{method:req.method,headers,...(req.method!=='GET'?{body:Buffer.concat(parts)}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});
        for(const name of ['content-type','etag','x-content-sha256']) if(response.headers.has(name))res.setHeader(name,response.headers.get(name));
        res.writeHead(response.status).end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(req.method!=='GET'){res.writeHead(405).end('Méthode refusée');return;}
      const name=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname);
      if(!/^\/(?:[a-z-]+\.html|logo\.png|manifest\.json|(?:css|js)\/[a-zA-Z0-9_/-]+\.(?:css|js))$/.test(name)){res.writeHead(404).end();return;}
      const path=resolve(root,'.'+name);if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
      res.setHeader('Content-Type',types[extname(path)] || 'application/octet-stream');res.end(await readFile(path));
    } catch {res.writeHead(502).end('Service Cloudflare indisponible. Aucun enregistrement confirmé.');}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) createV2Server().listen(4173,'127.0.0.1',()=>console.log('BastCompta V2 locale : http://127.0.0.1:4173 — aucun déploiement.'));
