import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const commercial = readFileSync('js/gestion-commerciale.js','utf8');
const portal = readFileSync('js/index.js','utf8');
function extract(source, name, end) { return source.slice(source.indexOf('async function '+name),source.indexOf(end,source.indexOf('async function '+name))); }
test('accounting transfer archives invoice before importing rows and stops on failure', async()=>{
 for (const archived of [null,{id:'cloud-invoice'}]) {
  const calls=[];
  const context={devisFrame:{},comptaFrame:{},getFrameApi:(_,name)=>({getInvoiceAccountingRowsForComptabilite:()=>({invoiceNumber:'F-2026-007',rows:[{tvac:1152.22}]}),importInvoiceSalesRowsFromPortal:async()=>{calls.push('import');return {ok:true};},archiveInvoiceForAccounting:async()=>{calls.push('archive');return archived;}}[name]),confirm:()=>true,alert:()=>{},console,switchMainTab:()=>{},setTimeout:()=>{},configureModuleIframe:()=>{}};
  vm.createContext(context);vm.runInContext(extract(portal,'sendInvoiceToAccounting()', 'window.sendInvoiceToAccounting'),context);
  await context.sendInvoiceToAccounting();
  assert.deepEqual(calls,archived?['archive','import']:['archive']);
 }
});
test('archive refuses a changed invoice number',async()=>{
 const context={data:{invoice:{documentNumber:'F-2026-008'}},normalizeInvoiceLookupValue:s=>String(s||'').trim().toLowerCase(),exportDocTypeToDrive:()=>{throw Error('must not archive another invoice');}};
 vm.createContext(context);vm.runInContext(extract(commercial,'archiveInvoiceForAccounting(invoiceNumber)', 'window.archiveInvoiceForAccounting'),context);
 assert.equal(await context.archiveInvoiceForAccounting('F-2026-007'),null);
});
test('preview can open the exact current invoice when its separate archive is absent',async()=>{
 let renders=0;
 const context={data:{invoice:{documentNumber:'F-2026-007'}},normalizeInvoiceLookupValue:s=>String(s||'').trim().toLowerCase(),findInvoiceDriveFileByNumber:async()=>null,renderInvoiceFirst:()=>renders++,alert:()=>{},console};
 vm.createContext(context);vm.runInContext(extract(commercial,'openInvoicePreviewByNumberFromDrive(invoiceNumber, preferredFileId', 'window.openInvoicePreviewByNumberFromDrive'),context);
 assert.equal(await context.openInvoicePreviewByNumberFromDrive('F-2026-007'),true);
 assert.equal(renders,1);
 assert.equal(await context.openInvoicePreviewByNumberFromDrive('F-2026-006'),false);
 assert.equal(renders,1);
});
