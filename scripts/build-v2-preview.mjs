import {readdir,readFile,writeFile,mkdir,copyFile,lstat,realpath} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),parent=resolve(root,'.v2-preview'),output=resolve(parent,'assets');
await mkdir(parent,{recursive:true});
if(await realpath(parent)!==parent)throw new Error('Le répertoire de préparation ne doit pas être un lien.');
// Keep OneDrive directories in place; verify the output instead of deleting it.
if(output!==join(root,'.v2-preview','assets')||!output.startsWith(root+sep))throw new Error('Chemin de préparation refusé.');
const existing=await lstat(output).catch(()=>null);
if(existing?.isSymbolicLink())throw new Error('Le dossier des ressources ne doit pas être un lien.');
if(existing && await realpath(output)!==output)throw new Error('Chemin des ressources refusé.');
await mkdir(output,{recursive:true});
const published=[];
async function copyAssets(relative){
  const source=resolve(root,relative),stats=await lstat(source);
  if(stats.isSymbolicLink())throw new Error('Lien non publié : '+relative);
  if(stats.isDirectory()){
    await mkdir(resolve(output,relative),{recursive:true});
    for(const entry of await readdir(source))await copyAssets(join(relative,entry));
    return;
  }
  if(!/^(?:[a-z-]+\.html|js\/[A-Za-z0-9_/-]+\.js|css\/[A-Za-z0-9_/-]+\.css|logo\.png|manifest\.json)$/.test(relative.replaceAll('\\','/')))return;
  const target=resolve(output,relative);await mkdir(resolve(target,'..'),{recursive:true});
  if(relative.endsWith('.html')){
    let html=await readFile(source,'utf8');
    html=html.replace(/<meta\b[^>]*name=["']robots["'][^>]*>/gi,'').replace(/<head>/i,'<head><meta name="robots" content="noindex,nofollow,noarchive">');
    await writeFile(target,html);
  }else await copyFile(source,target);
  published.push(relative.replaceAll('\\','/'));
}
for(const name of await readdir(root))if(/^[a-z-]+\.html$/.test(name))await copyAssets(name);
for(const name of ['js','css','logo.png','manifest.json'])await copyAssets(name);
await writeFile(join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');published.push('robots.txt');
const expected=new Set(published);
async function verifyOutput(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name),stats=await lstat(path);
    if(stats.isSymbolicLink())throw new Error('Lien inattendu dans le paquet public.');
    if(stats.isDirectory())await verifyOutput(path);
    else if(!expected.has(path.slice(output.length+1).replaceAll('\\','/')))throw new Error('Fichier inattendu dans le paquet public : '+entry.name);
  }
}
await verifyOutput(output);
await writeFile(join(parent,'published-files.json'),JSON.stringify(published.sort(),null,2));
console.log(`${published.length} ressources publiques préparées. Aucun ZIP, inventaire comptable, CNAME, .git ou fichier de configuration d’authentification inclus.`);
