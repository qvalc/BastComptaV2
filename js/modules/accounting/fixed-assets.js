/* BastCompta - calcul pur des investissements et immobilisations. */
(function (global) {
  'use strict';

  function computedRow(row = {}, currentYear, sourceIndex) {
    const calc = global.BastAccountingCalculations;
    const amount = calc.number(row.amount);
    const durationMonths = Math.max(1, parseInt(row.durationMonths || 60, 10));
    const amortization = calc.amortization(amount, row.date, durationMonths, currentYear);
    const result = {
      date: row.date || '',
      supplier: row.supplier || '',
      invoiceNumber: row.invoiceNumber || '',
      description: row.description || '',
      amount,
      durationMonths,
      amortYear: amortization.amortYear,
      amortTotal: amortization.amortTotal,
      netValue: amortization.netValue
    };
    if (sourceIndex !== undefined) {
      result.sourceIndex = sourceIndex;
      result.label = row.label || '';
    }
    return result;
  }

  function summarize({ investments = [], assets = [], currentYear = new Date().getFullYear() } = {}) {
    const calc = global.BastAccountingCalculations;
    const investmentComputed = investments.map(row => computedRow(row, currentYear));
    const assetsComputed = assets
      .map((row, sourceIndex) => computedRow(row, currentYear, sourceIndex))
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });

    const sum = (rows, field) => calc.round2(rows.reduce((total, row) => total + calc.number(row[field]), 0));
    return {
      investmentComputed,
      assetsComputed,
      investmentsGross: sum(investmentComputed, 'amount'),
      investmentsYearlyAmort: sum(investmentComputed, 'amortYear'),
      investmentsTotalAmortized: sum(investmentComputed, 'amortTotal'),
      investmentsNetValue: sum(investmentComputed, 'netValue'),
      assetsGross: sum(assetsComputed, 'amount'),
      assetsYearlyAmort: sum(assetsComputed, 'amortYear'),
      assetsTotalAmortized: sum(assetsComputed, 'amortTotal'),
      assetsNetValue: sum(assetsComputed, 'netValue')
    };
  }

  function reconcile({investments=[],assets=[],currentYear}={}){
    const calc=global.BastAccountingCalculations,remaining=investments.map(row=>({...row}));
    const key=row=>[row.date,calc.number(row.amount),Number(row.durationMonths||60)].join('|');
    const unmatchedAssets=[];
    for(const row of assets){const index=remaining.findIndex(other=>key(other)===key(row));if(index>=0)remaining.splice(index,1);else unmatchedAssets.push(row);}
    const active=rows=>rows.map(row=>({...row,amortYear:computedRow(row,currentYear).amortYear})).filter(row=>row.amortYear>0);
    const values=summarize({investments,assets,currentYear});
    return {difference:calc.round2(values.assetsYearlyAmort-values.investmentsYearlyAmort),assetsOnly:active(unmatchedAssets),investmentsOnly:active(remaining)};
  }
  global.BastFixedAssets = Object.freeze({ computedRow, summarize, reconcile });
})(globalThis);
