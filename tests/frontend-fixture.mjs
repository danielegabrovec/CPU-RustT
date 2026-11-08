// UI regression tests with explicitly synthetic data. No host telemetry is read.
// Run: node tests/frontend-fixture.mjs [--screenshots]
// --screenshots writes the public gallery with a visible synthetic-data watermark.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const project = fileURLToPath(new URL('../', import.meta.url));
const screenshots = process.argv.includes('--screenshots');
const output = path.join(project, 'test-output', 'frontend');
await fs.mkdir(output, {recursive:true});
const server = http.createServer(async (request, response) => {
  const asset = new URL(request.url, 'http://fixture.local').pathname.slice(1) || 'index.html';
  if (!['index.html', 'app.js', 'style.css'].includes(asset)) {
    response.writeHead(404); response.end(); return;
  }
  try {
    response.setHeader('Content-Type', asset.endsWith('.js') ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(await fs.readFile(path.join(project, 'web', asset)));
  } catch { response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({channel:'msedge', headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
const checks = [];
const typography = [];
const pointerAlignment = [];

function installSyntheticFixture() {
  const fixedNow = Date.parse('2026-11-08T12:00:00Z');
  const GiB = 2 ** 30;
  const cpu = Array.from({length:32}, (_,i) => 28 + i);
  const processes = [
    ['render-demo.exe',26,3.2], ['ollama-demo.exe',12,5.5],
    ['editor-demo.exe',4.3,.8], ['batch <demo>',2.1,.4], ['monitor-demo.exe',.8,.12],
  ].map(([name,load,ram],i) => ({pid:100+i,name,cpu_percent:load,memory_bytes:ram*GiB,
    read_bytes_per_sec:i===3?.5:1024*(i+1),write_bytes_per_sec:512*i,
    gpu_percent:i===0?34:null,gpu_memory_bytes:i===0?2*GiB:null,
    gpu_shared_memory_bytes:null,is_llm:name.includes('ollama')}));
  const sample = i => {
    const per_core=cpu.map((base,j)=>Math.max(0,Math.min(100,base+18*Math.sin(i/12+j*.3))));
    return {timestamp_unix:Math.floor(fixedNow/1000-(179-i)*.5),elapsed_secs:1000+i*.5,
      sampling_ms:27,cpu_percent:per_core.reduce((a,b)=>a+b,0)/per_core.length,per_core,
      frequency_mhz:4200,memory_used:(22-i*.025)*GiB,memory_total:64*GiB,
      swap_used:2*GiB,swap_total:16*GiB,processes:structuredClone(processes),
      disks:[{name:'Volume dimostrativo',mount:'C:\\Demo',kind:'SSD',total_bytes:2**40,
        available_bytes:640*GiB,read_bytes_per_sec:12*2**20,write_bytes_per_sec:4*2**20}],
      networks:[{name:'Rete dimostrativa',received_per_sec:2*2**20,transmitted_per_sec:300*1024,
        total_received:3*GiB,total_transmitted:GiB}],
      gpus:[{name:'Adattatore dimostrativo A',source:'Provider dimostrativo',
        utilization:46+18*Math.sin(i/16),memory_used:(5+i*.01)*GiB,memory_total:16*GiB,
        shared_memory_used:128*2**20,temperature:58+5*Math.sin(i/24),power_watts:120},
        {name:'Adattatore dimostrativo B',source:'Provider dimostrativo',
        utilization:i%9<3?null:12+5*Math.sin(i/8),memory_used:2*GiB,memory_total:8*GiB,
        shared_memory_used:null,temperature:null,power_watts:null}],
      sensors:[{name:'CPU Package',temperature:64},{name:'Case dimostrativo',temperature:38}],
      sensor_details:[{label:'Origine',value:'Sensori dimostrativi · nessun hardware reale'}],
      warnings:[]};
  };
  const history=Array.from({length:180},(_,i)=>sample(i));
  const preferences={theme_light:false,sort:'Cpu',ascending:false,interval_ms:500,benchmark_repeats:3,
    capacity:{parameters_b:8,bits_per_weight:4.5,context:8192,layers:32,kv_heads:8,head_dim:128},
    alerts:{enabled:true,cpu_percent:95,ram_percent:90,vram_percent:95,
      gpu_temperature_c:85,cpu_temperature_c:90,cooldown_seconds:30},
    ollama_url:'http://127.0.0.1:11434',lm_studio_url:'http://127.0.0.1:1234',llama_cpp_url:'http://127.0.0.1:8080'};
  const metric={average:42,peak:75,p95:68};
  const summary={id:1,name:'Sessione A · dati dimostrativi',started_utc:'2026-11-08T10:00:00Z',
    ended_utc:'2026-11-08T10:01:30Z',state:'finished',samples:180,duration_secs:89.5,
    cpu:metric,ram:{average:18*GiB,peak:22*GiB,p95:21.5*GiB},gpu:metric,
    vram:{average:6*GiB,peak:7*GiB,p95:6.9*GiB},llm_ram:metric,benchmark_count:1};
  const benchmark={id:1,session_id:1,recorded_utc:'2026-11-08T10:00:30Z',kind:'cpu',
    cpu:{single_ops_per_sec:80e6,multi_ops_per_sec:620e6,threads:16,duration_secs:1.3,
      algorithm:'mix64 · DATI DIMOSTRATIVI',build_profile:'optimized'},llm:null};
  const state={inventory:{os:'Windows · ambiente dimostrativo',cpu_name:'Processore dimostrativo · 32 thread',
    physical_cores:16,logical_cores:32,cpu:[{label:'Architettura',value:'x86_64'},{label:'Istruzioni',value:'Esempio sintetico · SSE2 · AVX2'}],
    board:[{label:'Mainboard',value:'Mainboard dimostrativa'},{label:'Firmware',value:'Versione dimostrativa 2026'}],
    memory:[{label:'Moduli',value:'2 × 32 GiB · dati dimostrativi'}],graphics:[{label:'Adattatori',value:'Due GPU sintetiche'}],warnings:[]},
    snapshot:history.at(-1),history,preferences,active_session:null,alerts:[],
    llm:{runtimes:[{name:'Ollama',endpoint:preferences.ollama_url,status:'online',message:'Runtime dimostrativo: nessuna inferenza reale.',
      models:[{id:'modello-demo:8b',size_bytes:5*GiB,vram_bytes:6*GiB,context_length:8192,quantization:'Q4 demo',loaded:true}]}],
      observations:[],last_probe_unix:fixedNow/1000},benchmarks:[benchmark],
    benchmark_running:false,benchmark_error:null,ready:true,error:null,
    database_path:'C:\\Demo\\CPU-RustT\\workspace.sqlite3',export_dir:'C:\\Demo\\CPU-RustT\\exports'};
  const fixture={state,now:fixedNow,sessions:[summary,{...summary,id:2,name:'Sessione B · dati dimostrativi'}],calls:[],delays:{},failNext:null,failAlways:null};
  Date.now=()=>fixture.now;
  fixture.advance=(seconds=.5)=>{
    fixture.now+=seconds*1000;
    const next=structuredClone(state.snapshot);next.timestamp_unix=Math.floor(fixture.now/1000);
    next.elapsed_secs+=seconds;next.cpu_percent=Math.min(100,next.cpu_percent+1);
    state.snapshot=next;state.history.push(next);if(state.history.length>180)state.history.shift();
  };
  const statistics=values=>{
    const valid=values.filter(x=>x!==null&&Number.isFinite(x)),sorted=[...valid].sort((a,b)=>a-b),n=valid.length;
    const mean=n?valid.reduce((a,b)=>a+b,0)/n:null;
    return {count:n,missing:values.length-n,min:n?sorted[0]:null,max:n?sorted.at(-1):null,mean,
      median:n?sorted[Math.floor(n/2)]:null,p95:n?sorted[Math.ceil(n*.95)-1]:null,
      std_dev:n>1?Math.sqrt(valid.reduce((a,b)=>a+(b-mean)**2,0)/(n-1)):null,
      delta:n?valid.at(-1)-valid[0]:null};
  };
  const report=(sessionId,windowSeconds)=>{
    const samples=windowSeconds?state.history.filter(s=>s.elapsed_secs>=state.history.at(-1).elapsed_secs-windowSeconds):state.history;
    const definitions=[['cpu.total','CPU totale','%',s=>s.cpu_percent],
      ['cpu.core.31','CPU · thread logico 32','%',s=>s.per_core[31]],
      ['ram.bytes','RAM utilizzata','B',s=>s.memory_used],
      ['gpu.0.utilization','GPU A · Carico','%',s=>s.gpus[0].utilization],
      ['gpu.1.temperature','GPU B · Temperatura','°C',s=>s.gpus[1].temperature]];
    return {source:sessionId?`Sessione #${sessionId} · dimostrativa`:'Finestra live dimostrativa',samples:samples.length,
      start_unix:samples[0]?.timestamp_unix??null,end_unix:samples.at(-1)?.timestamp_unix??null,
      duration_secs:samples.length?samples.at(-1).elapsed_secs-samples[0].elapsed_secs:0,
      metrics:definitions.map(([id,label,unit,value])=>({id,label,unit,statistics:statistics(samples.map(value)),
        points:samples.map(s=>({timestamp_unix:s.timestamp_unix,elapsed_secs:s.elapsed_secs,value:value(s)}))})),
      warnings:['DATI DIMOSTRATIVI: serie sintetiche utilizzate esclusivamente per verificare l’interfaccia.',
        'I dati mancanti non diventano zero. Le statistiche non dimostrano cause né guasti hardware.']};
  };
  window.fixture=fixture;
  window.__TAURI__={core:{invoke:async(command,args={})=>{
    fixture.calls.push({command,args:structuredClone(args)});
    if(fixture.delays[command])await new Promise(resolve=>setTimeout(resolve,fixture.delays[command]));
    if(fixture.failAlways===command)throw new Error('Errore dimostrativo controllato');
    if(fixture.failNext===command){fixture.failNext=null;throw new Error('Errore dimostrativo controllato');}
    switch(command){
      case'get_state':return structuredClone(state);
      case'get_sessions':return structuredClone(fixture.sessions);
      case'save_preferences':state.preferences=structuredClone(args.preferences);return structuredClone(state.preferences);
      case'analyze_data':return report(args.sessionId,args.windowSeconds);
      case'get_diagnostics':return {scope:args.sessionId?`Sessione #${args.sessionId}`:'Finestra live dimostrativa',samples:180,
        summary:'Controlli dimostrativi: nessuna diagnosi di guasto hardware.',findings:[
          {id:'missing',severity:'info',title:'Temperatura GPU non esposta',message:'Il provider dimostrativo non fornisce la misura.',evidence:'GPU B: 180 campioni mancanti.',recommendation:'Verificare la disponibilità del sensore nel provider.'},
          {id:'example',severity:'warning',title:'Esempio di avviso da verificare',message:'Segnalazione sintetica, non riferita al computer.',evidence:'DATI DIMOSTRATIVI',recommendation:'Confrontare con il carico di lavoro e i limiti del produttore.'}]};
      case'scan_system_events':return {events:[{timestamp:'2026-11-08 10:30',provider:'Provider dimostrativo',event_id:42,level:'Warning',message:'Evento sintetico per il test dell’interfaccia.'}],warnings:[]};
      case'start_recording':state.active_session=4;return 4;
      case'stop_recording':state.active_session=null;return null;
      case'load_session':return {summary:fixture.sessions.find(s=>s.id===args.id),inventory:state.inventory,
        samples:state.history.map(s=>({...s,processes:s.processes.filter(p=>p.is_llm)})),total_samples:180,benchmarks:[benchmark],alerts:[]};
      case'compare_sessions':return {left:fixture.sessions[0],right:fixture.sessions[1],metrics:[
        {label:'Carico CPU medio',unit:'%',left:42,right:38,delta:-4,delta_percent:-9.52},
        {label:'RAM media',unit:'B',left:18*GiB,right:16*GiB,delta:-2*GiB,delta_percent:-11.11}],
        warnings:['Confronto sintetico: non descrive prestazioni di hardware reale.'],left_series:state.history,right_series:state.history,benchmarks:[]};
      case'run_cpu_benchmark':case'run_llm_benchmark':state.benchmark_running=true;return null;
      case'cancel_benchmark':state.benchmark_running=false;state.benchmark_error='Benchmark dimostrativo annullato.';return null;
      case'rename_session':fixture.sessions.find(s=>s.id===args.id).name=args.name;return null;
      case'delete_session':fixture.sessions=fixture.sessions.filter(s=>s.id!==args.id);return null;
      case'import_session':return null;
      case'export_session':case'export_snapshot':case'export_analysis':case'backup_database':return 'C:\\Demo\\CPU-RustT\\exports\\report-dimostrativo.json';
      case'refresh_llm':return null;
      case'app_info':return {name:'CPU-RustT',version:'0.1.1',author:'Daniele Gabrovec',copyright:'© 2026 Daniele Gabrovec',license:'MIT',
        repository:'https://github.com/danielegabrovec/CPU-RustT',third_party_notices:'DATI DIMOSTRATIVI · il test sostituisce soltanto la lettura del file.\nMIT License\nTesto sintetico per verificare scorrimento e copia.'};
      default:throw new Error(`Comando fixture non implementato: ${command}`);
    }
  }}};
}

async function go(route){
  await page.evaluate(target=>window.__CPU_RUSTT_QA__.navigate(target),route);
  await page.waitForFunction(expected=>document.querySelector('#content').dataset.route===expected,route);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  if(['sessions','compare','analysis','diagnostics'].includes(route))await page.waitForTimeout(80);
}
async function poll(){await page.evaluate(()=>window.__CPU_RUSTT_QA__.poll());await page.waitForTimeout(30);}
async function check(name,fn){await fn();checks.push(name);process.stdout.write(`PASS ${name}\n`);}
const lastCall=command=>page.evaluate(name=>fixture.calls.filter(call=>call.command===name).at(-1),command);

try{
  await page.addInitScript(installSyntheticFixture);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.__CPU_RUSTT_QA__?.getState()?.ready);
  await check('14 viste e dati hardware sempre trattati come testo',async()=>{
    for(const route of ['overview','cpu','board','memory','gpu','disks','processes','llm','capacity','diagnostics','analysis','sessions','compare','settings']){
      await go(route);assert((await page.locator('#content').innerText()).length>40);
      assert.equal(await page.locator('#content script').count(),0);
    }
    await go('processes');await page.locator('#process-search').fill('batch');
    assert.equal(await page.locator('#process-table tbody tr').count(),1);
    assert((await page.locator('#process-table').innerText()).includes('batch <demo>'));
    assert((await page.locator('#process-table').innerText()).includes('0,5 B/s'));
  });
  await check('32 thread, ripetizioni persistenti e campioni a 500 ms distinti',async()=>{
    await go('cpu');assert.equal(await page.locator('#cpu-series option').count(),33);
    await page.selectOption('#cpu-series','31');await page.selectOption('#cpu-repeats','5');
    await poll();assert.equal(await page.locator('#cpu-repeats').inputValue(),'5');
    const frame=page.locator('.chart-frame').first();await frame.focus();await page.keyboard.press('Home');
    const first=await page.locator('.cursor-line').first().getAttribute('x1');
    await page.keyboard.press('ArrowRight');const second=await page.locator('.cursor-line').first().getAttribute('x1');
    assert(Number(second)>Number(first));assert((await page.locator('.chart-tooltip').first().innerText()).includes('Thread 32'));
    await page.keyboard.press('End');assert((await page.locator('.chart-tooltip').first().innerText()).replace(/[.\s]/g,'').includes('+1089,500s'));
    await page.keyboard.press('ArrowLeft');const before=await page.locator('.chart-tooltip').first().innerText();
    await poll();assert.equal(await page.locator('.chart-tooltip').first().innerText(),before);
  });
  await check('Due GPU, lacune reali e sensore GPU Package escluso dalla CPU',async()=>{
    await go('gpu');assert.equal(await page.locator('#gpu-adapter option').count(),3);
    await page.selectOption('#gpu-adapter','1');assert.equal(await page.locator('.gpu-chart-grid .chart-frame').count(),3);
    assert((await page.locator('.gpu-chart-grid').innerText()).includes('Misura non disponibile'));
    await page.evaluate(()=>{fixture.savedSensors=fixture.state.snapshot.sensors;fixture.state.snapshot.sensors=[{name:'GPU Package',temperature:99}];});
    await poll();await go('cpu');const temperature=page.locator('.metric-card').filter({hasText:'Temperatura CPU'});
    assert(!(await temperature.innerText()).includes('99,0'));assert((await temperature.innerText()).includes('—'));
    await page.evaluate(()=>fixture.state.snapshot.sensors=fixture.savedSensors);await poll();
  });
  await check('Pausa e replay esportano esattamente il campione visualizzato',async()=>{
    await go('overview');await page.locator('#pause-button').click();
    const frozen=await page.evaluate(()=>window.__CPU_RUSTT_QA__.getView().snapshot);
    await page.evaluate(()=>fixture.advance(2));await poll();
    assert.equal(await page.evaluate(()=>window.__CPU_RUSTT_QA__.getView().snapshot.cpu_percent),frozen.cpu_percent);
    await page.locator('#export-button').click();await page.waitForTimeout(70);
    assert.deepEqual((await lastCall('export_snapshot')).args.context.snapshot,frozen);
    await page.locator('#pause-button').click();await go('sessions');
    await page.locator('[data-session-action="replay"][data-id="1"]').click();await page.waitForTimeout(70);
    assert(await page.locator('#replay-banner').isVisible());await go('cpu');assert.equal(await page.locator('.core').count(),32);
    await page.locator('#export-button').click();await page.waitForTimeout(70);
    assert.deepEqual((await lastCall('export_snapshot')).args.context.snapshot,await page.evaluate(()=>window.__CPU_RUSTT_QA__.getView().snapshot));
    await page.locator('#replay-live').click();
  });
  await check('Bozze preservate tra navigazione, polling e salvataggio',async()=>{
    await go('settings');await page.locator('#settings-interval_ms').fill('1500');await go('overview');await go('settings');
    assert.equal(await page.locator('#settings-interval_ms').inputValue(),'1500');assert(await page.locator('.draft-feedback').isVisible());
    await page.locator('#settings-form button[type="submit"]').click();await page.waitForTimeout(80);
    assert.equal(await page.evaluate(()=>fixture.state.preferences.interval_ms),1500);assert.equal(await page.locator('.draft-feedback').count(),0);
    await go('capacity');await page.locator('#capacity-context').fill('16384');await go('overview');await go('capacity');
    assert.equal(await page.locator('#capacity-context').inputValue(),'16384');await page.locator('#capacity-form button').click();await page.waitForTimeout(70);
    assert.equal(await page.evaluate(()=>fixture.state.preferences.capacity.context),16384);
  });
  await check('Ambito report distinto dalla selezione e export congelato',async()=>{
    await go('analysis');assert(await page.locator('[data-action="export-analysis"]').isDisabled());
    await page.locator('#analysis-refresh').click();await page.waitForTimeout(80);
    await page.selectOption('#analysis-metric','ram.bytes');assert((await page.locator('#content').innerText()).includes('−'));
    await page.selectOption('#analysis-source','2');assert((await page.locator('.report-context').innerText()).includes('Selezione modificata'));
    await page.locator('[data-action="export-analysis"]').click();await page.waitForTimeout(70);
    let exported=await lastCall('export_analysis');assert.equal(exported.args.sessionId,null);assert.equal(exported.args.report.source,'Finestra live dimostrativa');
    await page.locator('#analysis-refresh').click();await page.waitForTimeout(70);
    assert((await page.locator('.report-context').innerText()).includes('Sessione #2'));
    await page.locator('[data-action="export-analysis"]').click();await page.waitForTimeout(70);
    exported=await lastCall('export_analysis');assert.equal(exported.args.sessionId,2);assert.equal(exported.args.report.source,'Sessione #2 · dimostrativa');
  });
  await check('Diagnostica aggiornata, confronto e conferme benchmark',async()=>{
    await go('diagnostics');await page.locator('#diagnostics-refresh').click();await page.waitForTimeout(70);
    assert((await page.locator('#content').innerText()).includes('Evidenza'));
    await page.locator('[data-action="scan-system-events"]').click();await page.waitForTimeout(70);
    assert((await page.locator('#content').innerText()).includes('Evento sintetico'));
    const old=await page.locator('.section-context').innerText();await page.evaluate(()=>fixture.advance(1));await poll();
    assert.notEqual(await page.locator('.section-context').innerText(),old);
    await go('compare');await page.selectOption('#compare-left','1');await page.selectOption('#compare-right','2');
    await page.locator('#compare-form button').click();await page.waitForTimeout(70);
    assert((await page.locator('#content').innerText()).includes('−2,0 GiB'));
    await go('cpu');await page.locator('[data-action="cpu-benchmark"]').click();assert(await page.locator('#action-dialog').isVisible());
    const before=(await page.evaluate(()=>fixture.calls.filter(c=>c.command==='run_cpu_benchmark').length));await page.locator('#dialog-cancel').click();
    assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.command==='run_cpu_benchmark').length),before);
    await page.locator('[data-action="cpu-benchmark"]').click();await page.locator('#dialog-confirm').click();await page.waitForTimeout(80);
    assert.equal((await lastCall('run_cpu_benchmark')).args.repeats,3);
    assert(await page.locator('[data-action="cpu-benchmark"]').isDisabled());
    await page.locator('[data-action="cancel-benchmark"]').click();await page.waitForTimeout(70);
  });
  await check('Feedback busy, errori recuperabili e stato campione in ritardo',async()=>{
    await page.evaluate(()=>{fixture.delays.export_snapshot=220;});await page.locator('#export-button').click();
    assert(await page.locator('#operation-status').isVisible());await page.waitForTimeout(260);
    await page.evaluate(()=>{fixture.delays.export_snapshot=0;fixture.failNext='backup_database';});await go('settings');
    await page.locator('[data-action="backup"]').click();await page.waitForTimeout(70);assert((await page.locator('#toast').innerText()).includes('Errore dimostrativo'));
    await page.evaluate(()=>{fixture.state.snapshot.timestamp_unix-=60;});await poll();assert((await page.locator('#connection-text').innerText()).includes('ritardo'));
    await page.evaluate(()=>fixture.advance(1));await poll();assert((await page.locator('#connection-text').innerText()).includes('attivo'));
    await page.evaluate(()=>{fixture.failAlways='get_state';});await poll();assert((await page.locator('#global-banner').innerText()).includes('Aggiornamento non riuscito'));
    await page.evaluate(()=>{fixture.failAlways=null;});await poll();
  });
  await check('Serie corte, tempi irregolari e misure assenti senza falsi zeri',async()=>{
    await page.evaluate(()=>{
      fixture.savedSnapshot=structuredClone(fixture.state.snapshot);fixture.savedHistory=structuredClone(fixture.state.history);
      fixture.state.history=[structuredClone(fixture.state.snapshot)];
    });await poll();await go('cpu');
    const frame=page.locator('.chart-frame').first();await frame.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
    assert((await page.locator('.chart-tooltip').first().innerText()).includes('Campione 1 / 1'));
    assert(!(await page.locator('.cpu-line').first().getAttribute('d')).includes('NaN'));
    await page.evaluate(()=>{fixture.state.history=[0,.5,4.5].map(elapsed=>({...structuredClone(fixture.savedSnapshot),elapsed_secs:elapsed}));});
    await poll();await frame.focus();await page.keyboard.press('Home');
    const x0=Number(await page.locator('.cursor-line').first().getAttribute('x1'));
    await page.keyboard.press('ArrowRight');const x1=Number(await page.locator('.cursor-line').first().getAttribute('x1'));
    await page.keyboard.press('End');const x2=Number(await page.locator('.cursor-line').first().getAttribute('x1'));
    assert(Math.abs((x1-x0)/(x2-x0)-1/9)<.001);
    await page.evaluate(()=>{fixture.state.snapshot={...fixture.state.snapshot,per_core:[],disks:[],networks:[],gpus:[]};});
    await poll();await go('overview');assert((await page.locator('.metric-card').first().innerText()).includes('—'));
    const io=page.locator('.panel').filter({has:page.getByRole('heading',{name:'Attività I/O',exact:true})});
    assert(!(await io.innerText()).includes('0 B/s'));
    await page.evaluate(()=>{fixture.state.snapshot=null;fixture.state.history=[];});await poll();
    assert((await page.locator('#content').innerText()).includes('In attesa dei dati hardware'));
    await page.evaluate(()=>{fixture.state.snapshot=fixture.savedSnapshot;fixture.state.history=fixture.savedHistory;});await poll();
  });
  await check('Il benchmark LLM usa il modello visualizzato anche se il live cambia',async()=>{
    await go('llm');await page.locator('#pause-button').click();
    await page.evaluate(()=>{fixture.savedModels=structuredClone(fixture.state.llm.runtimes[0].models);fixture.state.llm.runtimes[0].models=[{id:'modello-modificato:9b'}];});
    await poll();await page.locator('[data-llm-runtime]').first().click();
    assert((await page.locator('#dialog-description').innerText()).includes('modello-demo:8b'));
    await page.locator('#dialog-confirm').click();await page.waitForTimeout(70);
    assert.equal((await lastCall('run_llm_benchmark')).args.model,'modello-demo:8b');
    await page.locator('#pause-button').click();await page.locator('[data-action="cancel-benchmark"]').click();await page.waitForTimeout(70);
    await page.evaluate(()=>{fixture.state.llm.runtimes[0].models=fixture.savedModels;});await poll();
  });
  await check('Informazioni autore, licenze offline e caricamento una sola volta',async()=>{
    await page.locator('#about-button').click();await page.waitForTimeout(70);
    assert((await page.locator('#about-dialog').innerText()).includes('Ideazione, struttura e sviluppo: Daniele Gabrovec'));
    assert((await page.locator('#about-version').innerText()).includes('0.1.1'));
    await page.locator('.license-details summary').click();assert((await page.locator('#about-notices').inputValue()).includes('MIT License'));
    await page.keyboard.press('Escape');assert(!(await page.locator('#about-dialog').isVisible()));
    await page.locator('#about-button').click();await page.waitForTimeout(40);await page.locator('#about-close').click();
    assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.command==='app_info').length),1);
  });
  await check('Leggibilità, tastiera e responsive 375 / 760 / 960 / 1440',async()=>{
    for(const width of [375,760,960,1440]){
      await page.setViewportSize({width,height:1000});await go('overview');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);
      // Measure style and transform atomically, on every label and after three
      // live rerenders. No waiting for a later resize/font compensation is allowed.
      const readings=await page.evaluate(async()=>{
        const measure=()=>[...document.querySelectorAll('.chart text')].map(node=>{
          const size=parseFloat(getComputedStyle(node).fontSize),matrix=node.ownerSVGElement.getScreenCTM();
          return {text:node.textContent,pixelsX:size*matrix.a,pixelsY:size*matrix.d};
        });
        const results=[measure()];
        for(let i=0;i<3;i++){await window.__CPU_RUSTT_QA__.poll();results.push(measure());}
        return results;
      });
      assert(readings.every(labels=>labels.length>=5));
      const minimum=Math.min(...readings.flatMap(labels=>labels.flatMap(label=>[label.pixelsX,label.pixelsY])));
      typography.push({width,renderings:readings.length,minimumLabelPixels:minimum});
      assert(minimum>=12,`chart label too small at ${width}px: ${minimum}px`);
      const frame=page.locator('.chart-frame').first();
      // A live chart may be replaced while Playwright waits for two stable
      // frames. Scroll the currently attached node atomically instead.
      await page.evaluate(()=>document.querySelector('.chart-frame').scrollIntoView({block:'center',inline:'nearest'}));
      for(const fraction of [0,.5,1]){
        const point=await frame.evaluate((frame,fraction)=>{
          const plot=frame.querySelector('.chart-plot'),grid=plot.querySelector('line');
          const start=Number(grid.getAttribute('x1')),end=Number(grid.getAttribute('x2'));
          const bounds=plot.viewBox.baseVal;
          const position=new DOMPoint(start+fraction*(end-start),bounds.height*.55).matrixTransform(plot.getScreenCTM());
          const samples=window.fixture.state.history,first=samples[0].elapsed_secs,last=samples.at(-1).elapsed_secs;
          const target=first+fraction*(last-first);
          let index=0;
          samples.forEach((sample,i)=>{if(Math.abs(sample.elapsed_secs-target)<Math.abs(samples[index].elapsed_secs-target))index=i;});
          return {x:position.x,y:position.y,index,count:samples.length,
            expectedCursor:start+(samples[index].elapsed_secs-first)/(last-first)*(end-start)};
        },fraction);
        await page.mouse.move(point.x,point.y);
        const selected=await frame.locator('.chart-tooltip').innerText();
        assert(selected.includes(`Campione ${point.index+1} / ${point.count}`),`nearest mismatch at ${width}px, ${fraction}: ${selected}`);
        const cursor=Number(await frame.locator('.cursor-line').getAttribute('x1'));
        assert(Math.abs(cursor-point.expectedCursor)<.01,`cursor drift at ${width}px`);
        const axisDrift=await frame.evaluate(frame=>{
          const grid=frame.querySelector('.chart-plot line'),axis=frame.querySelector('.chart-axis-label');
          const gridPoint=new DOMPoint(0,Number(grid.getAttribute('y1'))).matrixTransform(grid.ownerSVGElement.getScreenCTM());
          const labelPoint=new DOMPoint(0,axis.y.baseVal.getItem(0).value).matrixTransform(axis.ownerSVGElement.getScreenCTM());
          return Math.abs(gridPoint.y-labelPoint.y);
        });
        assert(axisDrift<.1,`axis drift at ${width}px: ${axisDrift}`);
        await page.evaluate(()=>document.querySelector('.chart-frame').focus({preventScroll:true}));await page.keyboard.press('ArrowRight');
        assert((await frame.locator('.chart-tooltip').innerText()).includes(`Campione ${Math.min(point.count,point.index+2)} / ${point.count}`));
        pointerAlignment.push({width,fraction,selectedSample:point.index+1,cursorDelta:Math.abs(cursor-point.expectedCursor),axisDelta:axisDrift});
      }
      await go('analysis');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`analysis overflow ${width}`);
    }
    await page.setViewportSize({width:1440,height:1000});await go('settings');await page.locator('[name="theme_light"]').check();
    await page.locator('#settings-form button[type="submit"]').click();await page.waitForTimeout(70);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  });

  if(screenshots){
    const gallery=path.join(project,'docs','screenshots');await fs.mkdir(gallery,{recursive:true});
    await page.evaluate(()=>{
      const mark=document.createElement('div');mark.id='synthetic-watermark';mark.textContent='DATI DIMOSTRATIVI · nessuna misurazione hardware reale';
      Object.assign(mark.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'9999',padding:'11px 18px',background:'#164f44',
        color:'#ffffff',textAlign:'center',font:'600 13px Segoe UI, sans-serif',borderTop:'1px solid #58ddbd',letterSpacing:'.4px',pointerEvents:'none'});
      document.body.append(mark);document.querySelector('#toast').hidden=true;
      fixture.state.preferences.theme_light=false;
    });await poll();
    for(const route of ['overview','cpu','gpu','analysis','diagnostics']){
      await go(route);
      if(route==='cpu')await page.selectOption('#cpu-series','31');
      if(route==='gpu')await page.selectOption('#gpu-adapter','all');
      if(route==='analysis'){await page.selectOption('#analysis-source','live');await page.locator('#analysis-refresh').click();await page.waitForTimeout(70);}
      await page.screenshot({path:path.join(gallery,`${route}.png`),fullPage:false});
    }
    await page.locator('#about-button').click();await page.waitForTimeout(70);
    await page.screenshot({path:path.join(gallery,'about.png'),fullPage:false});await page.locator('#about-close').click();
    await page.setViewportSize({width:375,height:1000});await go('overview');await page.screenshot({path:path.join(gallery,'responsive.png'),fullPage:false});
  }
  assert.deepEqual(pageErrors,[]);
  const report={synthetic_data_only:true,checks,typography,pointerAlignment,pageErrors,screenshots};
  await fs.writeFile(path.join(output,'frontend-fixture-report.json'),JSON.stringify(report,null,2));
  process.stdout.write(`\n${checks.length} gruppi di verifiche UI superati. Nessun dato hardware reale usato.\n`);
}catch(error){
  process.stderr.write(JSON.stringify(await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,scrollX,
    layout:['body','.app-shell','.sidebar','.workspace','.topbar','.connection','.top-actions','main','.page-heading'].map(selector=>{const node=document.querySelector(selector),style=getComputedStyle(node);return {selector,rect:node.getBoundingClientRect().toJSON(),width:style.width,display:style.display,flex:style.flex,font:style.fontSize,transform:style.transform};}),
    overflow:[...document.querySelectorAll('body *')].filter(node=>!node.closest('#navigation, .table-wrap')).map(node=>({tag:node.tagName,id:node.id,class:typeof node.className==='string'?node.className:'svg',right:Math.round(node.getBoundingClientRect().right)})).filter(node=>node.right>innerWidth+2).slice(0,18)})),null,2)+'\n');
  await page.screenshot({path:path.join(output,'frontend-fixture-failure.png'),fullPage:true}).catch(()=>{});
  throw error;
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
