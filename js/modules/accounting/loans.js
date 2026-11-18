/* Loan balances are confirmed positions, never estimates from instalment totals. */
(function(global){
  'use strict';
  const amount=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
  const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value+'T00:00:00'));
  const round=value=>Math.round((value+Number.EPSILON)*100)/100;
  function balanceDate(year,explicit='',today=new Date().toISOString().slice(0,10)){
    if(date(explicit)&&Number(explicit.slice(0,4))===Number(year))return explicit;
    return Number(year)===Number(today.slice(0,4))?today:year+'-12-31';
  }
  function position(loan,asOf){
    const initial=amount(loan.initialCapital),share=amount(loan.professionalPercent);
    const result={id:loan.id,label:loan.label||'Emprunt',complete:false,capital:null,professionalCapital:null,reason:'À compléter'};
    if(!date(loan.startDate)||!date(asOf)||initial===null||share===null||share>100)return result;
    if(loan.startDate>asOf)return {...result,complete:true,capital:0,professionalCapital:0,reason:'Pas encore commencé'};
    const snapshot=amount(loan.outstandingCapital);
    if(snapshot!==null&&loan.outstandingDate===asOf)return {...result,complete:true,capital:snapshot,professionalCapital:round(snapshot*share/100),reason:'Solde confirmé'};
    if(loan.scheduleConfirmedThrough!==asOf)return {...result,reason:'Solde à cette date ou échéancier complet à confirmer'};
    const payments=(loan.payments||[]).filter(p=>date(p.date)&&p.date<=asOf);
    if((loan.payments||[]).some(p=>!date(p.date)))return result;
    let repaid=0;
    for(const p of payments){
      const capital=amount(p.capital),interest=amount(p.interest),insurance=amount(p.insurance),total=amount(p.total);
      if(p.date<loan.startDate||[capital,interest,insurance,total].some(x=>x===null)||Math.abs(round(capital+interest+insurance)-total)>0.011)return {...result,reason:'Ventilation capital / intérêts / assurance à compléter'};
      repaid+=capital;
    }
    if(repaid>initial+0.001)return {...result,reason:'Capital remboursé supérieur au capital initial'};
    const remaining=round(initial-repaid);
    return {...result,complete:true,capital:remaining,professionalCapital:round(remaining*share/100),reason:'Échéancier confirmé'};
  }
  function summarize(loans=[],asOf){
    const positions=loans.map(loan=>position(loan,asOf));
    return {asOf,positions,incomplete:positions.filter(p=>!p.complete).length,confirmedProfessionalDebt:round(positions.reduce((sum,p)=>sum+(p.complete?p.professionalCapital:0),0))};
  }
  global.BastLoans=Object.freeze({amount,balanceDate,position,summarize});
})(globalThis);
