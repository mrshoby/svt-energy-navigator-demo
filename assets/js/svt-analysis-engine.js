/* v32 analysis engine compatible with SVTLoadCurveProfiles datasets */
(function(root){
  function sum(arr, fn){ return arr.reduce((a,x)=>a+(fn?fn(x):x),0); }
  function round(n,d=0){ const p=Math.pow(10,d); return Math.round((Number(n)||0)*p)/p; }
  function percentile(values,p){ const a=values.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length) return 0; return a[Math.floor((a.length-1)*p/100)]; }
  function byHour(rows){
    const h=Array.from({length:24},(_,i)=>({hour:i,kwh:0,cost:0,count:0}));
    rows.forEach(r=>{ const x=h[r.hour||0]; x.kwh+=r.electricKwh||0; x.cost+=(r.electricKwh||0)*(r.priceRonKwh||0); x.count++; });
    return h.map(x=>({...x, avgPrice:x.kwh?x.cost/x.kwh:0}));
  }
  function analyze(dataset){
    const rows=(dataset&&dataset.rows)||[];
    const intervalHours=(dataset.meta?.intervalMinutes||60)/60;
    const fixedPrice=dataset.meta?.fixedPriceRonKwh||0.75;
    const electricKwh=sum(rows,r=>r.electricKwh||0);
    const exportKwh=sum(rows,r=>r.electricExportKwh||0);
    const reactiveInd=sum(rows,r=>r.reactiveInductiveKvarh||0);
    const reactiveCap=sum(rows,r=>r.reactiveCapacitiveKvarh||0);
    const thermalKwh=sum(rows,r=>r.thermalKwh||0);
    const pvKwh=sum(rows,r=>r.pvKwh||0);
    const fixedCost=electricKwh*fixedPrice;
    const pzuCost=sum(rows,r=>(r.electricKwh||0)*(r.priceRonKwh||0));
    const maxDemandKw=Math.max(0,...rows.map(r=>(r.electricKwh||0)/intervalHours));
    const baseload=percentile(rows.map(r=>(r.electricKwh||0)/intervalHours),10);
    const expensive=rows.map(r=>({...r,cost:(r.electricKwh||0)*(r.priceRonKwh||0),kw:(r.electricKwh||0)/intervalHours}))
      .sort((a,b)=>b.cost-a.cost).slice(0,12);
    const hourly=byHour(rows);
    const highHours=hourly.slice().sort((a,b)=>b.cost-a.cost).slice(0,3);
    const afterHoursRows=rows.filter(r=>(r.hour>=17||r.hour<6));
    const afterHoursCost=sum(afterHoursRows,r=>(r.electricKwh||0)*(r.priceRonKwh||0));
    const shiftSaving=sum(expensive.slice(0,5),x=>x.cost)*0.18;
    const pzuSaving=Math.max(0,fixedCost-pzuCost);
    const standbySaving=afterHoursCost*0.25;
    const reactiveFlag=reactiveInd > electricKwh*0.35 || reactiveCap > electricKwh*0.2;
    const totalPossibleSaving=pzuSaving+shiftSaving+standbySaving+(reactiveFlag?fixedCost*0.015:0);
    const recs=[
      {priority:"urgent",title:"Mută consumurile flexibile din orele scumpe",body:`Cele mai scumpe ore detectate sunt ${highHours.map(h=>String(h.hour).padStart(2,"0")+":00").join(", ")}.`,savingRon:shiftSaving,difficulty:"mediu"},
      {priority:"urgent",title:"Compară tariful fix cu profil PZU",body:"Pe baza profilului PZU estimativ, poți vedea dacă merită trecerea către tarif dinamic sau negocierea unui tarif diferit.",savingRon:pzuSaving,difficulty:"ușor"},
      {priority:"medium",title:"Redu consumul în afara programului",body:"Consumul de seară/noapte indică potențial de oprire automată pentru echipamente auxiliare.",savingRon:standbySaving,difficulty:"ușor"},
      {priority:reactiveFlag?"urgent":"low",title:"Verifică energia reactivă",body:reactiveFlag?"Energia reactivă pare semnificativă și poate genera costuri/penalizări. Verifică compensarea.":"Energia reactivă este disponibilă în fișier și poate fi urmărită în raport.",savingRon:reactiveFlag?fixedCost*0.015:0,difficulty:"tehnic"}
    ];
    return {
      meta:dataset.meta||{},
      totals:{
        electricKwh:round(electricKwh,2), electricExportKwh:round(exportKwh,2), thermalKwh:round(thermalKwh,2), pvKwh:round(pvKwh,2),
        reactiveInductiveKvarh:round(reactiveInd,2), reactiveCapacitiveKvarh:round(reactiveCap,2),
        fixedCostRon:round(fixedCost,2), pzuCostRon:round(pzuCost,2), savingsPzuRon:round(fixedCost-pzuCost,2),
        totalPossibleSavingRon:round(totalPossibleSaving,2), maxDemandKw:round(maxDemandKw,2), baseloadKw:round(baseload,2),
        avgPzuPriceRonKwh:electricKwh?round(pzuCost/electricKwh,3):0
      },
      expensiveIntervals:expensive.map(x=>({timestamp:x.timestamp,localLabel:x.localLabel,hour:x.hour,kwh:round(x.electricKwh,2),kw:round(x.kw,2),price:round(x.priceRonKwh,3),cost:round(x.cost,2)})),
      charts:{
        loadCurve:rows.map(r=>({label:r.localLabel,hour:r.hour,electricKwh:round(r.electricKwh,2),thermalKwh:round(r.thermalKwh,2),pvKwh:round(r.pvKwh,2),price:round(r.priceRonKwh,3),cost:round((r.electricKwh||0)*(r.priceRonKwh||0),2)})),
        costByHour:hourly.map(h=>({hour:h.hour,kwh:round(h.kwh,2),cost:round(h.cost,2),avgPrice:round(h.avgPrice,3)})),
        averageDay:dataset.daily?.averageDay||[]
      },
      recommendations:recs,
      daily:dataset.daily || null
    };
  }
  const api={analyze};
  root.SVTAnalysisEngine=api;
  if(typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);