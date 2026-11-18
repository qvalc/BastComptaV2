import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import '../js/modules/accounting/calculations.js';
import '../js/modules/accounting/loans.js';
import '../js/modules/accounting/fixed-assets.js';
import '../js/modules/accounting/financial-statements.js';
import '../js/modules/accounting/exercise.js';
const loans=globalThis.BastLoans;
const base={id:'fictive',label:'Fictive loan',startDate:'2026-10-02',initialCapital:20000,professionalPercent:50,payments:[{date:'2026-11-02',total:300,capital:'',interest:'',insurance:''}]};
test('an unknown instalment breakdown never becomes zero debt or a guessed repayment',()=>{
  const p=loans.position(base,'2026-11-18');assert.equal(p.complete,false);assert.equal(p.capital,null);
  assert.equal(loans.summarize([base],'2026-11-18').incomplete,1);
  assert.equal(loans.position({...base,scheduleConfirmedThrough:'2026-11-18'},'2026-11-18').complete,false);
});
test('confirmed schedule uses only principal and applies the professional share once',()=>{
  const loan={...base,scheduleConfirmedThrough:'2026-11-18',payments:[{date:'2026-11-02',total:300,capital:250,interest:40,insurance:10}]};
  const p=loans.position(loan,'2026-11-18');assert.equal(p.capital,19750);assert.equal(p.professionalCapital,9875);
  assert.equal(loans.position({...loan,payments:[{...loan.payments[0],total:400}]},'2026-11-18').complete,false);
});
test('a bank snapshot must match the balance date; future payments cannot reduce the debt',()=>{
  assert.equal(loans.position({...base,outstandingDate:'2026-11-18',outstandingCapital:19000},'2026-11-18').professionalCapital,9500);
  assert.equal(loans.position({...base,outstandingDate:'2026-11-17',outstandingCapital:19000},'2026-11-18').complete,false);
  assert.equal(loans.position({...base,startDate:'2027-01-01'},'2026-11-18').professionalCapital,0);
  const p=loans.position({...base,scheduleConfirmedThrough:'2026-10-31'},'2026-10-31');assert.equal(p.capital,20000);
  assert.equal(loans.position({...base,professionalPercent:101},'2026-11-18').complete,false);
});
test('debt increases the liability side without changing profit or asset amounts',()=>{
  const f=globalThis.BastFinancialStatements,old=f.summarize({salesNet:1000,assetsGross:500});
  const next=f.summarize({salesNet:1000,assetsGross:500,professionalLoanDebt:200});
  assert.equal(next.liabilitiesSide,old.liabilitiesSide+200);assert.equal(next.estimatedProfit,old.estimatedProfit);assert.equal(next.assetsSide,old.assetsSide);
});
test('next year retains loan history but requires a new balance-date confirmation',()=>{
  const currentData={settings:{balanceDate:'2026-11-18'},loans:[base]};
  const next=globalThis.BastAccountingExercise.createNext({currentData,targetYear:2027});
  assert.deepEqual(next.loans,[base]);assert.equal(next.settings.balanceDate,'');next.loans[0].label='changed';assert.equal(currentData.loans[0].label,'Fictive loan');
});
test('reconciliation identifies the exact small-tool difference without changing either list',()=>{
  const common={date:'2026-10-06',amount:1000,durationMonths:60};
  const small=[38.85,19.91,45.02,5.64].map((amount,i)=>({date:'2026-07-15',amount,durationMonths:1,label:'Fictive tool '+i}));
  const assets=[common,...small],before=JSON.stringify(assets);
  const check=globalThis.BastFixedAssets.reconcile({investments:[common],assets,currentYear:2026});
  assert.equal(check.difference,109.42);assert.equal(check.assetsOnly.length,4);assert.equal(check.investmentsOnly.length,0);assert.equal(JSON.stringify(assets),before);
});
test('the new loan editor opens without selecting a nonexistent loan and keeps unknown amounts blank',()=>{
  const source=readFileSync(new URL('../js/comptabilite.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function startLoanEditor('),source.indexOf('function renderBalance()'));
  const context=vm.createContext({crypto,structuredClone,data:{loans:[]},render(){},escapeAttr:s=>String(s),escapeHtml:s=>String(s),money:s=>String(s)});
  vm.runInContext('let loanEditor=null;'+code,context);
  vm.runInContext('startLoanEditor()',context);
  const html=vm.runInContext('renderLoanEditor()',context);
  assert.match(html,/Nouvel emprunt/);assert.match(html,/name="initialCapital"[^>]*value=""/);
  assert.match(html,/name="professionalPercent"[^>]*value=""/);
  assert.match(html,/name="outstandingCapital"[^>]*value=""/);
});
