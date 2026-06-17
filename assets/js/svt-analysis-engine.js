window.SVTAnalysisEngine = (() => {
  function sum(arr, fn) { return arr.reduce((a,x)=>a+(fn?fn(x):x),0); }
  function round(n, d=0) { const p = Math.pow(10,d); return Math.round((Number(n)||0)*p)/p; }
  function groupByHour(rows, field) {
    const out = Array.from({length:24}, (_,h)=>({hour:h, value:0, cost:0, kwh:0, count:0}));
    rows.forEach(r => {
      out[r.hour].value += r[field] || 0;
      out[r.hour].kwh += r.electricKwh || 0;
      out[r.hour].cost += (r.electricKwh || 0) * (r.priceRonKwh || 0);
      out[r.hour].count++;
    });
    return out;
  }
  function analyze(dataset) {
    const rows = dataset.rows || [];
    const fixedPrice = dataset.meta.fixedPriceRonKwh || 0.75;
    const intervalHours = (dataset.meta.intervalMinutes || 60) / 60;
    const electricKwh = sum(rows, r=>r.electricKwh);
    const thermalKwh = sum(rows, r=>r.thermalKwh);
    const pvKwh = sum(rows, r=>r.pvKwh);
    const pzuCost = sum(rows, r=>r.electricKwh * r.priceRonKwh);
    const fixedCost = electricKwh * fixedPrice;
    const savingsPzu = fixedCost - pzuCost;
    const maxKw = Math.max(...rows.map(r => r.electricKwh / intervalHours));
    const avgPrice = electricKwh ? pzuCost / electricKwh : 0;
    const expensive = rows.map(r => ({...r, cost:r.electricKwh*r.priceRonKwh, kw:r.electricKwh/intervalHours}))
      .sort((a,b)=>b.cost-a.cost).slice(0,10);
    const hourly = groupByHour(rows, 'electricKwh');
    const costByHour = hourly.map(h => ({ hour:h.hour, cost:round(h.cost,2), kwh:round(h.kwh,2), avgPrice:h.kwh?round(h.cost/h.kwh,3):0 }));
    const highHours = costByHour.slice().sort((a,b)=>b.cost-a.cost).slice(0,3);
    const pvUsed = rows.reduce((a,r)=>a+Math.min(r.pvKwh||0, r.electricKwh||0),0);
    const pvExport = Math.max(0, pvKwh - pvUsed);
    const autoconsum = pvKwh ? pvUsed / pvKwh * 100 : 0;
    const baseload = percentile(rows.map(r=>r.electricKwh/intervalHours), 10);
    const afterHoursKwh = sum(rows.filter(r=>r.hour>=17 || r.hour<6), r=>r.electricKwh);
    const afterHoursCost = sum(rows.filter(r=>r.hour>=17 || r.hour<6), r=>r.electricKwh*r.priceRonKwh);
    const estimatedStandbySaving = afterHoursCost * 0.35;
    const peakSaving = maxKw > dataset.meta.contractPowerKw ? (maxKw-dataset.meta.contractPowerKw)*35*12 : maxKw*0.008*fixedPrice*365;
    const shiftSaving = Math.max(0, sum(expensive.slice(0,5), x=>x.cost) * 0.18);
    const totalPossibleSaving = Math.max(0, savingsPzu) + estimatedStandbySaving + shiftSaving + Math.max(0, peakSaving);
    const recommendations = [
      { priority:'urgent', title:'Aplică tarif dinamic PZU sau ofertă indexată', body:'Pe datele încărcate, comparația dintre tariful fix și profilul PZU arată o economie potențială imediată, fără investiție tehnică.', savingRon: Math.max(0, savingsPzu), difficulty:'ușor' },
      { priority:'urgent', title:'Redu consumul în intervalele scumpe', body:`Cele mai scumpe ore detectate sunt ${highHours.map(h=>String(h.hour).padStart(2,'0')+':00').join(', ')}. Mutarea sarcinilor flexibile în afara acestor intervale reduce costul fără investiții mari.`, savingRon: shiftSaving, difficulty:'mediu' },
      { priority:'medium', title:'Elimină consumul stand-by după program', body:'Consumul de seară/noapte indică potențial de oprire automată pentru climatizare, compresoare secundare, iluminat sau auxiliare.', savingRon: estimatedStandbySaving, difficulty:'ușor' },
      { priority:'low', title:'Analizează PV / BESS dacă există surplus local', body: pvKwh ? `Autoconsumul PV estimat este ${round(autoconsum,1)}%. Surplusul poate fi valorificat prin mutare consum sau stocare.` : 'Încarcă și producția PV pentru estimarea exactă a autoconsumului și a potențialului BESS.', savingRon: pvExport * (fixedPrice - 0.28), difficulty:'avansat' }
    ];
    return {
      meta: dataset.meta,
      totals: {
        electricKwh: round(electricKwh,2), thermalKwh: round(thermalKwh,2), pvKwh: round(pvKwh,2),
        fixedCostRon: round(fixedCost,2), pzuCostRon: round(pzuCost,2), savingsPzuRon: round(savingsPzu,2),
        avgPzuPriceRonKwh: round(avgPrice,3), maxDemandKw: round(maxKw,1), baseloadKw: round(baseload,1),
        afterHoursKwh: round(afterHoursKwh,2), afterHoursCostRon: round(afterHoursCost,2),
        totalPossibleSavingRon: round(totalPossibleSaving,2), autoconsumPct: round(autoconsum,1), pvExportKwh: round(pvExport,2)
      },
      expensiveIntervals: expensive.map(x => ({ timestamp:x.timestamp, localLabel:x.localLabel, hour:x.hour, kwh:round(x.electricKwh,2), kw:round(x.kw,1), price:round(x.priceRonKwh,3), cost:round(x.cost,2) })),
      charts: {
        loadCurve: rows.map(r => ({ label:r.localLabel, hour:r.hour, electricKwh:round(r.electricKwh,2), thermalKwh:round(r.thermalKwh,2), pvKwh:round(r.pvKwh,2), price:round(r.priceRonKwh,3), cost:round(r.electricKwh*r.priceRonKwh,2) })),
        costByHour,
        prices: costByHour.map(h => ({ hour:h.hour, price:h.avgPrice || SVTPriceProfiles.priceForHour(h.hour) }))
      },
      recommendations,
      tomorrowPlan: buildTomorrowPlan(highHours, totalPossibleSaving, fixedPrice)
    };
  }
  function percentile(values, p) {
    const a = values.filter(Number.isFinite).sort((x,y)=>x-y);
    if (!a.length) return 0;
    return a[Math.floor((a.length-1)*p/100)];
  }
  function buildTomorrowPlan(highHours, saving, fixedPrice) {
    const first = highHours[0]?.hour ?? 8;
    return [
      { time:'05:30', title:'Pornește sarcinile flexibile înainte de vârful de dimineață', body:'Dacă procesul permite, mută pornirea echipamentelor mari înainte de intervalul scump.', saving: Math.max(25, saving*0.01) },
      { time:String(first).padStart(2,'0')+':00', title:'Evită consumul simultan în ora cea mai scumpă', body:'Nu porni toate utilajele simultan. Eșalonează pornirile în 10–15 minute.', saving: Math.max(35, saving*0.015) },
      { time:'11:00', title:'Mută consumuri în fereastra de preț mai bun / PV', body:'Procesele flexibile, boilerele sau auxiliarele pot fi mutate în intervalele cu preț mai mic.', saving: Math.max(30, saving*0.012) },
      { time:'17:30', title:'Oprește consumurile stand-by după program', body:'Climatizare, compresoare secundare și iluminat auxiliar trebuie oprite automat.', saving: Math.max(20, saving*0.01) }
    ].map(x => ({...x, saving: Math.round(x.saving)}));
  }
  return { analyze };
})();