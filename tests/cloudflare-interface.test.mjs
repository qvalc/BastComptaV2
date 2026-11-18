import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const normalize=source=>source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replaceAll('Cloudflare','Google Drive').replace(/>\s+</g,'><').replace(/\s+/g,' ').trim();
test('all original HTML layouts are kept; only scripts and backend labels change',()=>{
  for(const name of ['index','comptabilite','gestion-commerciale','suivi-client','fournisseurs','personnel','impots','terrain','devis-facture','tableau-de-bord','faq']){
    const current=readFileSync(new URL(`../${name}.html`,import.meta.url),'utf8');
    const original=execFileSync('git',['show',`87428cb:${name}.html`],{encoding:'utf8'});
    assert.equal(normalize(current),normalize(original),name+' must keep its original interface');
    assert.ok(current.indexOf('cloudflare-bootstrap.js')<current.indexOf('js/storage.js') || !current.includes('js/storage.js'));
    assert.ok(!/src="https:\/\/(?:apis|accounts)\.google\.com/.test(current));
  }
});
