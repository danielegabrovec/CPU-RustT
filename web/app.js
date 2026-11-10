// CPU-RustT: the native Rust collector owns sampling and persistence.
// This module renders the snapshots received through Tauri IPC, without a server or CDN.
const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const number = (value, digits = 1) => finite(value) ? Number(value).toLocaleString('it-IT', {minimumFractionDigits:digits, maximumFractionDigits:digits}) : '—';
const pct = value => finite(value) ? `${number(value)}%` : '—';
const ratio = (used, total) => finite(used) && finite(total) && total > 0 ? Math.min(100, Math.max(0, used / total * 100)) : null;
const clampPct = value => finite(value) ? Math.max(0, Math.min(100, Number(value))) : 0;
const bytes = value => {
  if (!finite(value)) return '—';
  const n = Math.max(0, Number(value));
  const power = Math.max(0, Math.min(4, n > 0 ? Math.floor(Math.log(n) / Math.log(1024)) : 0));
  return `${number(n / 1024 ** power, power || !Number.isInteger(n) ? 1 : 0)} ${['B','KiB','MiB','GiB','TiB'][power]}`;
};
const rate = value => finite(value) ? `${bytes(value)}/s` : '—';
const clock = timestamp => finite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toLocaleTimeString('it-IT') : '—';
const date = value => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('it-IT', {dateStyle:'short',timeStyle:'short'});
};
const duration = value => finite(value) ? `${Math.floor(value / 60)}m ${Math.floor(value % 60)}s` : '—';
const sum = (items, key) => items.reduce((a, x) => a + (finite(x[key]) ? Number(x[key]) : 0), 0);
const totalRate = (items, key) => items.length && items.every(item=>finite(item[key])) ? sum(items,key) : null;
const cpuValue = sample => sample.per_core?.length ? sample.cpu_percent : null;
const isCpuSensor = sensor => /cpu|package|tctl/i.test(sensor.name)&&!/gpu|graphics|video/i.test(sensor.name);
const iconPaths = {
  overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
  board:'<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="6" height="6"/><path d="M17 6v8M6 17h12M16 3v3M3 9h4M10 13v4"/>',
  memory:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 18v3m4-3v3m4-3v3m4-3v3M6 10v4m4-4v4m4-4v4m4-4v4"/>',
  gpu:'<rect x="2" y="5" width="19" height="13" rx="2"/><circle cx="10" cy="11.5" r="3.5"/><path d="M7 18v3m4-3v3m4-3v3m6-12h2m-6 0h1m-1 5h1M10 8v7m-3.5-3.5h7"/>',
  disks:'<path d="M4 4h16l2 11v5H2v-5L4 4zM2 15h20m-5 3h2"/><path d="M7 8h10"/>',
  processes:'<path d="M8 5h13M8 12h13M8 19h13"/><circle cx="3" cy="5" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="19" r="1"/>',
  llm:'<path d="M9 3C5 3 4 6 5 8c-4 1-3 6 0 7-1 4 4 7 7 4V5c0-2-2-3-3-2zm6 0c4 0 5 3 4 5 4 1 3 6 0 7 1 4-4 7-7 4M7 9l5 3m5-3-5 3m-5 5 5-2m5 2-5-2"/>',
  capacity:'<path d="M9 3v6L3 19a1.5 1.5 0 0 0 1.3 2h15.4A1.5 1.5 0 0 0 21 19L15 9V3M7 3h10M7 15h10"/>',
  diagnostics:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  analysis:'<path d="M3 3v18h18M7 17v-5m5 5V7m5 10v-8"/>',
  sessions:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-14 4h4m3 0h3m-10 3h4"/>',
  compare:'<path d="M8 3H4v18h4m8-18h4v18h-4M8 8h8m-8 8h8m-4-8-3-3m3 11 3 3"/>',
  settings:'<path d="m10 3-1 3-3 1-2-1-2 4 2 2v2l-2 2 2 4 3-1 2 1 1 2h4l1-3 3-1 2 1 2-4-2-2v-2l2-2-2-4-3 1-2-1-1-2z"/><circle cx="12" cy="12" r="3"/>',
  pause:'<path d="M8 4v16M16 4v16"/>', play:'<path d="m8 4 12 8-12 8z"/>',
  export:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>', record:'<circle cx="12" cy="12" r="6"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  moon:'<path d="M20 14A8 8 0 0 1 10 4 9 9 0 1 0 20 14z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.cpu}</svg>`;
const routes = [
  ['overview','Panoramica','IL TUO SISTEMA, IN TEMPO REALE','Una lettura chiara delle risorse del tuo computer.'],
  ['cpu','Processore','POTENZA DI CALCOLO','Carico, thread logici, istruzioni e benchmark CPU.'],
  ['board','Scheda madre','IDENTITÀ HARDWARE','Scheda madre e firmware dichiarati dal sistema.'],
  ['memory','Memoria','RISORSE DEL SISTEMA','RAM, memoria virtuale e moduli installati.'],
  ['gpu','Schede grafiche','ACCELERAZIONE HARDWARE','Utilizzo GPU, memoria dedicata e sensori disponibili.'],
  ['disks','Dischi e rete','TRASFERIMENTO DATI','Capacità dei volumi, attività I/O e traffico di rete.'],
  ['processes','Processi','ATTIVITÀ DEL SISTEMA','Cerca e ordina i processi del campione corrente.'],
  ['llm','LLM locali','INTELLIGENZA SUL TUO PC','Runtime locali, modelli e benchmark eseguiti su richiesta.'],
  ['capacity','Capacity Lab','PIANIFICA LE RISORSE','Stima la memoria necessaria a un modello linguistico.'],
  ['diagnostics','Diagnostica','FONTI E TRASPARENZA','Avvisi, sensori disponibili e limiti delle misurazioni.'],
  ['analysis','Analisi dati','LEGGI I RISULTATI','Statistiche Rust su una finestra live o su una sessione archiviata.'],
  ['sessions','Sessioni','IL TUO ARCHIVIO LOCALE','Registra un lavoro, rivedi i campioni e conserva i risultati.'],
  ['compare','Confronto A/B','MISURA LE DIFFERENZE','Confronta due sessioni: il delta è sempre B meno A.'],
  ['settings','Impostazioni','IL TUO SPAZIO DI LAVORO','Preferenze, soglie di avviso e connessioni locali.'],
];

let live = null;
let route = 'overview';
let paused = false;
let frozen = null;
let replay = null;
let replayIndex = 0;
let sessions = [];
let sessionQuery = '';
let sessionState = 'all';
let sessionPageIndex = 0;
const sessionPageSize = 25;
let comparison = null;
let comparisonIds = {left:'', right:''};
let processQuery = '';
let processSort = 'Cpu';
let processAscending = false;
let processDetail = null;
let initialized = false;
let polling = false;
let busy = false;
let toastTimer = null;
let modalResolve = null;
let lastBenchmarkRunning = false;
let lastBenchmarkError = null;
let cpuSeries = 'total';
let gpuSelected = 'all';
let analysisSource = 'live';
let analysisWindow = '180';
let analysisMetric = 'cpu.total';
let analysisReport = null;
let analysisBusy = false;
let lastAnalysisRefresh = 0;
let chartCounter = 0;
const chartRegistry = new Map();
let chartCursor = null;
let diagnosticsSource = 'live';
let diagnosticsWindow = '180';
let diagnosticsReport = null;
let diagnosticsBusy = false;
let systemEvents = null;
let openSelect = null;
let cpuRepeats = null;
let restoringFocus = false;
let analysisContext = null;
let diagnosticsContext = null;
let analysisRevision = 0;
let diagnosticsRevision = 0;
let analysisAutoRefresh = false;
let sessionRefresh = null;
let lastSessionsRefresh = 0;
let appInfo = null;
const formDrafts = new Map();
const ipc = (command, args) => {
  if (!window.__TAURI__?.core?.invoke) return Promise.reject(new Error('Apri CPU-RustT dall’app desktop per accedere al motore Rust.'));
  return window.__TAURI__.core.invoke(command, args);
};
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = $('#toast');
  el.textContent = String(message);
  el.classList.toggle('error', error);
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 10000 : 6500);
}
async function action(fn, success) {
  if (busy) { toast('Un’operazione locale è già in corso. Attendi il completamento prima di riprovare.'); return; }
  busy = true;
  const initiator = document.activeElement?.tagName==='BUTTON' ? document.activeElement : null;
  const initiatorSelector=initiator?.id?`#${CSS.escape(initiator.id)}`:focusedContentSelector();
  const originalDisabled = initiator?.disabled;
  if (initiator) { initiator.disabled=true;initiator.setAttribute('aria-busy','true'); }
  $('#operation-status').textContent='Operazione locale in corso…';
  $('#operation-status').hidden=false;
  try {
    const result = await fn();
    if (success) toast(typeof success === 'function' ? success(result) : success);
    await poll();
    return result;
  } catch (error) {
    toast(String(error?.message || error), true);
  } finally {
    busy = false;
    $('#operation-status').hidden=true;
    const restored=initiator?.isConnected?initiator:initiatorSelector?$(initiatorSelector):null;
    if(restored){
      // A newly rendered control already reflects current backend state.
      if(restored===initiator)restored.disabled=originalDisabled;
      restored.removeAttribute('aria-busy');
      if(!restored.disabled)restored.focus({preventScroll:true});
      else $('#main').focus({preventScroll:true});
    }
    renderChrome();
  }
}
function ask({title, description, value = null, confirm = 'Conferma', danger = false}) {
  if (modalResolve) return Promise.resolve(null);
  $('#dialog-title').textContent = title;
  $('#dialog-description').textContent = description;
  $('#dialog-input').hidden = value === null;
  $('#dialog-label').hidden = value === null;
  $('#dialog-input').required = value !== null;
  $('#dialog-input').value = value ?? '';
  $('#dialog-confirm').textContent = confirm;
  $('#dialog-confirm').className = `button ${danger ? 'danger' : 'primary'}`;
  $('#action-dialog').showModal();
  if (value !== null) { $('#dialog-input').focus(); $('#dialog-input').select(); }
  else $('#dialog-cancel').focus();
  return new Promise(resolve => { modalResolve = resolve; });
}
function finishDialog(result) {
  const resolve = modalResolve;
  modalResolve = null;
  $('#action-dialog').close();
  if (resolve) resolve(result);
}
$('#dialog-form').addEventListener('submit', event => { event.preventDefault(); finishDialog($('#dialog-input').hidden ? true : $('#dialog-input').value.trim()); });
$('#dialog-cancel').addEventListener('click', () => finishDialog(null));
$('#action-dialog').addEventListener('cancel', event => { event.preventDefault(); finishDialog(null); });

function view() {
  const base = paused && frozen ? {...frozen, preferences:live.preferences} : live;
  if (!base) return null;
  if (replay) return {...base, inventory:replay.inventory, snapshot:replay.samples[replayIndex] ?? null, history:replay.samples.slice(0, replayIndex + 1), alerts:replay.alerts, benchmarks:replay.benchmarks, llm:{runtimes:[],observations:[],benchmark:null,last_probe_unix:0}};
  return base;
}
function captureDraft(form){
  if(!form||!['settings-form','capacity-form'].includes(form.id))return;
  const values={};
  [...form.elements].forEach(input=>{if(input.name)values[input.name]=input.type==='checkbox'?input.checked:input.value;});
  formDrafts.set(form.id,values);
  updateDraftFeedback(form);
}
function restoreDraft(){
  for(const [id,values] of formDrafts){const form=$(`#${id}`);if(!form)continue;for(const input of form.elements){if(input.name in values){if(input.type==='checkbox')input.checked=values[input.name];else input.value=values[input.name];}}updateDraftFeedback(form);}
}
function updateDraftFeedback(form){
  let feedback=$('.draft-feedback',form);
  if(!feedback){feedback=document.createElement('p');feedback.className='hint draft-feedback';feedback.setAttribute('role','status');form.append(feedback);}
  feedback.textContent='Modifiche non salvate. La bozza rimane disponibile mentre esplori le altre viste.';
}
const stat = (label, value, unit, sub, name, percent = null, color = '') => `<section class="metric-card ${color}"><div class="metric-top"><span>${esc(label)}</span><span class="metric-icon">${icon(name)}</span></div><div class="metric-value">${esc(value)}<span class="unit">${esc(unit)}</span></div><div class="metric-sub" title="${esc(sub)}">${esc(sub)}</div><div class="meter"><span style="width:${clampPct(percent)}%"></span></div></section>`;
const panel = (title, content, extra = '', subtitle = '') => `<section class="panel"><div class="panel-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${extra}</div>${content}</section>`;
const empty = (title, description, name = 'diagnostics', button = '') => `<div class="empty-state"><div class="empty-icon">${icon(name)}</div><h2>${esc(title)}</h2><p>${esc(description)}</p>${button}</div>`;
const specs = (rows, compact = false) => `<dl class="spec-list">${rows.map(row => `<div class="spec-row ${compact ? 'compact' : ''}"><dt>${esc(row.label)}</dt><dd>${esc(row.value || 'Non disponibile')}</dd></div>`).join('')}</dl>`;
const table = (headers, rows, className = '') => `<div class="table-wrap"><table class="${className}"><thead><tr>${headers.map(h => typeof h==='string'?`<th scope="col">${h}</th>`:`<th scope="col" aria-sort="${h.sort}">${h.label}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="quiet">Nessun dato disponibile nel campione.</td></tr>`}</tbody></table></div>`;
const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
function statusBadge(status) { const online = /^(online|ready|ok|available)$/i.test(status); return badge(status || 'Non disponibile', online ? 'online' : 'warning'); }
function metricCards(s) {
  const gpu = s.gpus?.[0];
  const ram = ratio(s.memory_used, s.memory_total);
  const diskUsed = sum(s.disks || [],'total_bytes') - sum(s.disks || [],'available_bytes');
  const diskTotal = sum(s.disks || [],'total_bytes');
  return `<div class="metrics-grid">${stat('Utilizzo CPU', number(cpuValue(s)), '%', s.frequency_mhz ? `${number(s.frequency_mhz / 1000,2)} GHz · frequenza OS` : 'Frequenza non disponibile', 'cpu', s.cpu_percent)}${stat('Memoria RAM', number(ram), '%', `${bytes(s.memory_used)} di ${bytes(s.memory_total)}`, 'memory', ram, 'blue')}${stat('Utilizzo GPU', number(gpu?.utilization), finite(gpu?.utilization) ? '%' : '', gpu?.name || 'Contatore non disponibile', 'gpu', gpu?.utilization, 'amber')}${stat('Spazio dischi', number(diskTotal ? ratio(diskUsed,diskTotal) : null), diskTotal ? '%' : '', diskTotal ? `${bytes(diskUsed)} di ${bytes(diskTotal)} · volumi montati` : replay ? 'Non conservato nel riepilogo' : 'Nessun volume rilevato', 'disks', ratio(diskUsed,diskTotal))}</div>`;
}
function chart(samples, series, {normalized = false, label = 'Andamento CPU e RAM nel tempo', unit = '%', maxY = null, minY = 0, compact = false} = {}) {
  if (!samples.length) return '<p class="hint">Il grafico si popola con i prossimi campioni.</p>';
  const width = window.innerWidth < 650 || compact ? 400 : 660, height = 205, left = ['B','bytes','B/s'].includes(unit)?79:53, right = 15, top = 15, bottom = 34;
  const key = `${route}-${chartCounter++}`;
  const values = samples.flatMap(sample=>series.map(serie=>serie.value(sample))).filter(finite).map(Number);
  const upper = maxY ?? (unit==='%' ? 100 : values.reduce((max,value)=>Math.max(max,value),1)*1.1);
  const lower = minY;
  const innerW = width-left-right, innerH = height-top-bottom;
  const elapsed = samples.map(s=>finite(s.elapsed_secs)?Number(s.elapsed_secs):null);
  const timestamp = samples.map(s=>finite(s.timestamp_unix)?Number(s.timestamp_unix):null);
  const usable = values=>values.every(finite)&&values.every((value,i)=>i===0||value>=values[i-1])&&values[values.length-1]>values[0];
  const timeMode=usable(elapsed)?'elapsed':usable(timestamp)?'timestamp':'index';
  const times=timeMode==='elapsed'?elapsed:timeMode==='timestamp'?timestamp:samples.map((_,i)=>i);
  const min = times[0], max = times[times.length-1];
  const x = i => left + (max>min?(times[i]-min)/(max-min):.5) * innerW;
  const y = value => top + (1-(Math.max(lower,Math.min(upper,value))-lower)/(upper-lower)) * innerH;
  chartRegistry.set(key,{samples,series,width,height,left,right,top,bottom,normalized,unit,upper,lower,x,y,timeMode,times});
  const available=values.length;
  // The outer SVG uses CSS pixels. Only the plot is scaled: axis text never
  // depends on a delayed font correction after resize or a new live sample.
  let svg = `<div class="chart-frame" data-chart-key="${key}" data-time-mode="${timeMode}" tabindex="0" role="group" aria-label="${esc(label)}" aria-describedby="chart-help-${key}"><span id="chart-help-${key}" class="sr-only">Grafico interattivo. ${available?'Muovi il puntatore oppure usa freccia sinistra e destra per leggere i campioni. Home e Fine selezionano primo e ultimo campione.':'Nessuna misura disponibile: i campioni mancanti rimangono lacune.'}</span><svg class="chart" role="img" aria-label="${esc(label)}"><title>${esc(label)}. Unità: ${esc(unit)}.</title><svg class="chart-plot" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">`;
  let axisLabels='';
  for (const fraction of [0,.25,.5,.75,1]) {
    const level=lower+fraction*(upper-lower);
    svg += `<line x1="${left}" x2="${width-right}" y1="${y(level)}" y2="${y(level)}"/>`;
    axisLabels += `<text class="chart-axis-label" x="${(left-10)/width*100}%" y="${y(level)/height*100}%" dominant-baseline="middle" text-anchor="end">${esc(unit==='%'?`${number(level,0)}%`:unit==='B'||unit==='bytes'?bytes(level):unit==='B/s'?rate(level):number(level,level<10?1:0))}</text>`;
  }
  series.forEach((serie,index) => {
    let path = '', connected = false;
    const points = [];
    samples.forEach((sample,i) => {
      const value = serie.value(sample);
      if (!finite(value)) { connected = false; return; }
      path += `${connected ? 'L' : 'M'}${x(i).toFixed(2)},${y(value).toFixed(2)} `;
      connected = true;
      points.push([x(i),y(value),value,i]);
    });
    if (series.length === 1 && points.length && points.length === samples.length) svg += `<path class="cpu-area" d="${path}L${x(samples.length-1)},${y(0)} L${x(0)},${y(0)}Z"/>`;
    svg += `<path class="${index ? 'ram-line' : 'cpu-line'}" d="${path}"/>`;
    if (points.length === 1) svg += `<circle cx="${points[0][0]}" cy="${points[0][1]}" r="3" fill="var(--${index ? 'blue' : 'accent'})"/>`;
  });
  (samples.length===1?[.5]:[0,.5,1]).forEach((fraction,index) => {
    const i = Math.round((samples.length-1)*fraction);
    const axisLabel=samples.length===1?'Campione 1':normalized?`${Math.round(fraction*100)}% ${timeMode==='index'?'campioni':'durata'}`:timeMode==='index'?`Campione ${i+1}`:timeMode==='elapsed'?`+${number(times[i],max-min<10?1:0)} s`:clock(samples[i].timestamp_unix);
    axisLabels += `<text class="chart-axis-label" x="${(left+fraction*innerW)/width*100}%" y="${(height-9)/height*100}%" text-anchor="${samples.length===1?'middle':index===0?'start':index===2?'end':'middle'}">${esc(axisLabel)}</text>`;
  });
  svg += `<g class="chart-cursor" hidden><line class="cursor-line" x1="0" x2="0" y1="${top}" y2="${height-bottom}"/>${series.map((_,i)=>`<circle data-cursor-series="${i}" r="3.5" fill="var(--${i?'blue':'accent'})"/>`).join('')}</g>`;
  return svg + `</svg>${axisLabels}${available?'':`<text class="chart-empty-label" x="${(left+innerW/2)/width*100}%" y="${(top+innerH/2)/height*100}%" dominant-baseline="middle" text-anchor="middle">Misura non disponibile</text>`}</svg><div class="chart-tooltip" hidden></div><span class="sr-only chart-announcement" aria-live="polite"></span></div><p class="chart-help">${timeMode==='elapsed'?'Asse X: tempo trascorso dall’avvio del monitor. ':timeMode==='index'?'Tempi non distinguibili: asse X per ordine dei campioni. ':''}Puntatore o frecce ← → per i dettagli.</p>`;
}
function chartValue(value,unit) {
  if (!finite(value)) return 'Non disponibile';
  if (unit==='B'||unit==='bytes') return `${value<0?'−':''}${bytes(Math.abs(value))}`;
  if (unit==='B/s') return `${value<0?'−':''}${rate(Math.abs(value))}`;
  return `${number(value,unit==='%'?1:2)}${unit==='%'?'%':` ${unit}`}`;
}
function showChartCursor(frame,index,{announce=false}={}) {
  const data=chartRegistry.get(frame.dataset.chartKey);
  if(!data||!data.samples.length)return;
  index=Math.max(0,Math.min(data.samples.length-1,index));
  const sample=data.samples[index];
  chartCursor={key:frame.dataset.chartKey,index,timestamp:sample.timestamp_unix,elapsed:sample.elapsed_secs};
  const cursor=$('.chart-cursor',frame),x=data.x(index);
  cursor.hidden=false;cursor.removeAttribute('hidden');
  $('.cursor-line',cursor).setAttribute('x1',x);$('.cursor-line',cursor).setAttribute('x2',x);
  data.series.forEach((serie,i)=>{
    const circle=$(`[data-cursor-series="${i}"]`,cursor),value=serie.value(sample);
    circle.setAttribute('visibility',finite(value)?'visible':'hidden');
    if(finite(value)){circle.setAttribute('cx',x);circle.setAttribute('cy',data.y(value));}
  });
  const tooltip=$('.chart-tooltip',frame);
  const lines=data.series.map(serie=>`${serie.label}: ${chartValue(serie.value(sample),serie.unit||data.unit)}`);
  const time=`${clock(sample.timestamp_unix)}${finite(sample.elapsed_secs)?` · +${number(sample.elapsed_secs,3)} s`:''}`;
  tooltip.innerHTML=`<strong>${esc(time)}</strong>${lines.map((line,i)=>`<span><i style="background:var(--${i?'blue':'accent'})"></i>${esc(line)}</span>`).join('')}<small>Campione ${index+1} / ${data.samples.length}</small>`;
  tooltip.hidden=false;
  // CSS clamps against the current container on every layout, including a
  // viewport resize between samples. No stale pixel width can escape the card.
  tooltip.style.left=`clamp(6px, calc(${x/data.width*100}% + 12px), max(6px, calc(100% - 306px)))`;
  if(announce)$('.chart-announcement',frame).textContent=`${time}. ${lines.join('. ')}. Campione ${index+1} di ${data.samples.length}.`;
}
function hideChartCursor(frame){
  const cursor=$('.chart-cursor',frame),tooltip=$('.chart-tooltip',frame);
  if(cursor)cursor.setAttribute('hidden','');
  if(tooltip)tooltip.hidden=true;
  if(chartCursor?.key===frame.dataset.chartKey)chartCursor=null;
}
function resourceChart(v, cpuOnly = false) {
  const h = v.history || [];
  const cpu = h.map(cpuValue).filter(finite);
  const average = cpu.length ? cpu.reduce((a,b) => a+b,0)/cpu.length : null;
  let series = cpuOnly ? [{label:'CPU totale',value:cpuValue}] : [{label:'CPU',value:cpuValue},{label:'RAM',value:s=>ratio(s.memory_used,s.memory_total)}];
  if(cpuOnly&&cpuSeries!=='total'&&hasCoreDetails(v)){
    const index=Number(cpuSeries);
    series=[{label:`Thread ${index+1}`,value:s=>s.per_core?.length===v.inventory.logical_cores?s.per_core[index]:null},{label:'CPU totale',value:cpuValue}];
  }
  return chart(h,series,{label:cpuOnly&&cpuSeries!=='total'?`CPU totale e thread ${Number(cpuSeries)+1}`:'Andamento CPU e RAM nel tempo'}) + `<div class="chart-stats"><span>CPU totale media finestra<b>${pct(average)}</b></span><span>CPU totale picco finestra<b>${pct(cpu.length ? Math.max(...cpu) : null)}</b></span><span>Finestra<b>${h.length} campioni</b></span></div>`;
}
function hasCoreDetails(v){return Boolean(v?.snapshot?.per_core?.length>0&&v.snapshot.per_core.length===v.inventory.logical_cores);}
function cpuChartPanel(v){
  const detailed=hasCoreDetails(v);
  if(!detailed)cpuSeries='total';
  const selector=`<div class="field cpu-series-field"><label for="cpu-series">Serie CPU</label><select id="cpu-series"><option value="total" ${cpuSeries==='total'?'selected':''}>CPU totale</option>${detailed?v.snapshot.per_core.map((_,i)=>`<option value="${i}" ${cpuSeries===String(i)?'selected':''}>Thread logico ${i+1}</option>`).join(''):''}</select></div>`;
  const legend=cpuSeries==='total'?'<div class="legend"><span><i></i>CPU totale</span></div>':`<div class="legend"><span><i></i>Thread ${Number(cpuSeries)+1}</span><span><i class="blue"></i>CPU totale</span></div>`;
  return panel('Utilizzo del processore',legend+resourceChart(v,true),selector,'Muovi il puntatore o usa le frecce sul grafico per leggere i campioni.');
}
function coreGrid(s) {
  if (replay&&!hasCoreDetails(view())) return '<p class="hint">Questo campione archiviato non contiene la topologia completa dei thread. Il carico CPU complessivo rimane disponibile.</p>';
  const cores = s.per_core || [];
  return cores.length ? `<div class="core-grid">${cores.map((v,i) => `<div class="core"><div class="core-label"><span>Thread ${i+1}</span><strong>${pct(v)}</strong></div><div class="meter"><span style="width:${clampPct(v)}%"></span></div></div>`).join('')}</div><p class="hint">Ogni riquadro rappresenta un processore logico esposto dal sistema operativo.</p>` : '<p class="hint">Contatori per thread non disponibili.</p>';
}
function processRows(items, detail = false) {
  return items.map(p => `<tr${detail ? ` data-process="${p.pid}" tabindex="0" aria-label="Dettagli processo ${esc(p.name)}, PID ${p.pid}"` : ''}><td class="process-name" title="${esc(p.name)}"><span class="process-symbol">${esc((p.name || '?').slice(0,2).toUpperCase())}</span>${esc(p.name)} ${p.is_llm ? badge('LLM','online') : ''}</td><td>${p.pid}</td><td class="accent">${pct(p.cpu_percent)}<span class="inline-meter"><span style="width:${clampPct(p.cpu_percent)}%"></span></span></td><td>${bytes(p.memory_bytes)}</td><td>${pct(p.gpu_percent)}</td><td>${bytes(p.gpu_memory_bytes)}</td><td>${rate(p.read_bytes_per_sec)}</td><td>${rate(p.write_bytes_per_sec)}</td></tr>`);
}
function overview(v) {
  const s = v.snapshot, inv = v.inventory;
  const topProcesses = [...(s.processes||[])].sort((a,b) => b.cpu_percent-a.cpu_percent).slice(0,5);
  return metricCards(s) + `<div class="dashboard-grid">${panel('Andamento delle risorse',resourceChart(v),'<div class="legend"><span><i></i>CPU</span><span><i class="blue"></i>RAM</span></div>','Campioni reali · asse verticale in percentuale')}${panel('Il tuo sistema',`<div class="system-title">${esc(inv.cpu_name || 'Processore non identificato')}</div>${specs([{label:'Core / thread',value:`${inv.physical_cores || '—'} fisici / ${inv.logical_cores || '—'} logici`},{label:'RAM utilizzabile',value:bytes(s.memory_total)},{label:'Sistema operativo',value:inv.os},{label:'Scheda grafica',value:(s.gpus||[]).map(g=>g.name).join(' · ')||'Non disponibile'}],true)}`,'<span class="panel-tag">HARDWARE</span>')}</div><div class="dashboard-grid">${panel('Carico per thread',coreGrid(s),`<span class="panel-tag">${inv.logical_cores || '—'} LOGICI</span>`)}${panel('Attività I/O',specs([{label:'Lettura dischi',value:rate(totalRate(s.disks||[],'read_bytes_per_sec'))},{label:'Scrittura dischi',value:rate(totalRate(s.disks||[],'write_bytes_per_sec'))},{label:'Rete ricevuta',value:rate(totalRate(s.networks||[],'received_per_sec'))},{label:'Rete inviata',value:rate(totalRate(s.networks||[],'transmitted_per_sec'))}],true),'<span class="panel-tag">TOTALE</span>')}</div>${panel('Processi più attivi',replay ? '<p class="hint">L’archivio conserva riepiloghi delle risorse. I dettagli dei processi sono disponibili nella vista live.</p>' : table(['Processo','PID','CPU','RAM','GPU','VRAM','Lettura','Scrittura'],processRows(topProcesses)), '<button class="text-link" type="button" data-navigate="processes">Tutti i processi →</button>')}`;
}
function benchmarks(v, kind) {
  const items = (v.benchmarks || []).filter(b => kind ? b.kind === kind || (kind === 'cpu' ? b.cpu : b.llm) : true);
  return table(['Data','Tipo / modello','Risultato','Metodo'],items.slice(0,20).map(b => `<tr><td>${date(b.recorded_utc)}</td><td>${esc(b.cpu ? `CPU · ${b.cpu.threads} thread` : b.llm?.model || b.kind)}</td><td>${b.cpu ? `${number(b.cpu.multi_ops_per_sec/1e6,2)} Mmix/s` : `${number(b.llm?.generation_tokens_per_sec,2)} tok/s`}</td><td class="wrap">${esc(b.cpu ? `mix64 v1 · ${b.cpu.build_profile}` : b.llm?.throughput_kind || 'Non disponibile')}</td></tr>`));
}
function cpuPage(v) {
  const s = v.snapshot, inv = v.inventory;
  return `<div class="metrics-grid">${stat('Carico complessivo',number(cpuValue(s)),'%',inv.cpu_name,'cpu',s.cpu_percent)}${stat('Frequenza OS',s.frequency_mhz ? number(s.frequency_mhz/1000,2) : '—','GHz','Può rappresentare la frequenza nominale','cpu',null,'blue')}${stat('Core fisici',number(inv.physical_cores || null,0),'',`${inv.logical_cores || '—'} thread logici`,'cpu')}${stat('Temperatura CPU',number((s.sensors||[]).find(isCpuSensor)?.temperature),'°C','Solo se esposta da un provider','diagnostics',null,'amber')}</div><div class="dashboard-grid">${cpuChartPanel(v)}${panel('Informazioni CPU',specs(inv.cpu||[],true))}</div>${panel('Thread logici',coreGrid(s))}${panel('Microbenchmark CPU',`<p class="hint">Due brevi fasi di calcolo intero mix64, singola e multi thread (massimo 16). Il risultato descrive questo algoritmo; confronta soltanto la stessa versione e lo stesso profilo di compilazione.</p><div class="toolbar section-spacer"><div class="field"><label for="cpu-repeats">Ripetizioni</label><select id="cpu-repeats">${[1,2,3,5,10].map(n=>`<option value="${n}" ${n===(cpuRepeats??v.preferences.benchmark_repeats)?'selected':''}>${n}</option>`).join('')}</select></div><button type="button" class="button primary" data-action="cpu-benchmark" ${live.benchmark_running?'disabled':''}>${icon('play')}Avvia benchmark</button>${live.benchmark_running?'<button type="button" class="button danger" data-action="cancel-benchmark">Annulla benchmark</button>':''}</div>${live.benchmark_running ? '<p class="hint accent">Benchmark in esecuzione. Il monitoraggio continua in background.</p>' : ''}${live.benchmark_error ? `<p class="hint danger-text">${esc(live.benchmark_error)}</p>` : ''}${benchmarks(v,'cpu')}`)}`;
}
function memoryPage(v) {
  const s = v.snapshot, used = ratio(s.memory_used,s.memory_total), swap = ratio(s.swap_used,s.swap_total);
  return `<div class="metrics-grid">${stat('RAM utilizzata',number(used),'%',bytes(s.memory_used),'memory',used)}${stat('RAM utilizzabile',number(s.memory_total/2**30,1),'GiB','Totale visibile al sistema operativo','memory',null,'blue')}${stat('RAM disponibile',number((s.memory_total-s.memory_used)/2**30,1),'GiB','Differenza tra totale e utilizzata','memory',null)}${stat('Swap / pagefile',s.swap_total ? number(swap) : '—',s.swap_total?'%':'',`${bytes(s.swap_used)} di ${bytes(s.swap_total)}`,'memory',swap,'amber')}</div><div class="two-cols">${panel('Occupazione nel tempo',chart(v.history||[],[{label:'RAM',value:x=>ratio(x.memory_used,x.memory_total)},{label:'Swap',value:x=>ratio(x.swap_used,x.swap_total)}],{label:'RAM e swap nel tempo'}),'<div class="legend"><span><i></i>RAM</span><span><i class="blue"></i>Swap</span></div>')}${panel('Moduli e configurazione',specs(v.inventory.memory||[]),'<span class="panel-tag">WMI / OS</span>')}</div><p class="hint">La memoria utilizzabile dal sistema può essere inferiore a quella fisicamente installata. La configurazione dei moduli proviene dal firmware; timing live e lettura SPD diretta non sono misurati.</p>`;
}
function gpuPage(v) {
  const gpus = v.snapshot.gpus || [];
  return `<div class="toolbar"><div class="field search"><label for="gpu-adapter">Adattatore grafico</label><select id="gpu-adapter"><option value="all" ${gpuSelected==='all'?'selected':''}>Tutti gli adattatori</option>${gpus.map((g,i)=>`<option value="${i}" ${gpuSelected===String(i)?'selected':''}>GPU ${i} · ${esc(g.name)}</option>`).join('')}</select></div></div>` + (gpus.length ? gpus.map((g,i) => {
    if(gpuSelected!=='all'&&Number(gpuSelected)!==i)return '';
    const find = s => { const row=s.gpus?.[i];return row?.name===g.name&&row.source===g.source?row:null; };
    const h = v.history || [];
    const charts = `<div class="gpu-chart-grid"><div><h3>Utilizzo GPU (%)</h3>${chart(h,[{label:g.name||'GPU',value:s=>find(s)?.utilization}],{label:`Utilizzo ${g.name||'GPU'} nel tempo`,compact:true})}</div><div><h3>Memoria dedicata</h3>${chart(h,[{label:'Memoria dedicata',value:s=>find(s)?.memory_used}],{unit:'B',maxY:g.memory_total||null,label:`Memoria dedicata ${g.name||'GPU'} nel tempo`,compact:true})}</div><div><h3>Temperatura (°C)</h3>${chart(h,[{label:'Temperatura',value:s=>find(s)?.temperature}],{unit:'°C',maxY:120,label:`Temperatura ${g.name||'GPU'} nel tempo`,compact:true})}</div></div>`;
    return panel(g.name || `GPU ${i+1}`,`<div class="metrics-grid">${stat('Utilizzo GPU',number(g.utilization),finite(g.utilization)?'%':'','Contatore esposto dal driver','gpu',g.utilization)}${stat('Memoria dedicata',finite(g.memory_used)?number(g.memory_used/2**30,1):'—','GiB',`Capacità: ${bytes(g.memory_total)}`,'memory',ratio(g.memory_used,g.memory_total),'blue')}${stat('Temperatura',number(g.temperature),finite(g.temperature)?'°C':'','Sensore opzionale','diagnostics',null,'amber')}${stat('Potenza',number(g.power_watts),finite(g.power_watts)?'W':'','Sensore opzionale','gpu')}</div>${specs([{label:'Provider',value:g.source || 'Non disponibile'},{label:'Memoria condivisa usata',value:bytes(g.shared_memory_used)}])}${charts}<p class="hint">Grafici separati per questo adattatore. I dati assenti restano lacune; la memoria condivisa rimane distinta dalla VRAM dedicata. Muovi il puntatore o usa le frecce per leggere i campioni.</p>`,badge(`GPU ${i}`));
  }).join('') : empty('Nessun contatore GPU disponibile','Il monitor mostra i dati soltanto quando driver e provider espongono le misure.','gpu')) + panel('Inventario grafico',specs(v.inventory.graphics||[])) + '<p class="hint">WDDM/DXGI su Windows; NVIDIA può aggiungere temperatura e potenza tramite nvidia-smi. L’assenza di un sensore non equivale a un valore zero.</p>';
}
function disksPage(v) {
  const s = v.snapshot;
  if (replay && !(s.disks||[]).length && !(s.networks||[]).length) return empty('Dettagli disponibili nella vista live','Le sessioni archiviate conservano riepiloghi; i volumi e le interfacce di rete non vengono ricostruiti.','disks');
  return `<div class="two-cols">${panel('Volumi montati',(s.disks||[]).map(d=>`<div class="device-row"><div class="device-top"><strong>${esc(d.mount||d.name)}</strong><span>${esc(d.kind)}</span></div><p class="hint">${esc(d.name)}</p><div class="meter"><span style="width:${clampPct(ratio(d.total_bytes-d.available_bytes,d.total_bytes))}%"></span></div><div class="device-meta"><span>${bytes(d.available_bytes)} liberi</span><span>${bytes(d.total_bytes)} totali</span></div><div class="device-meta"><span>Lettura ${rate(d.read_bytes_per_sec)}</span><span>Scrittura ${rate(d.write_bytes_per_sec)}</span></div></div>`).join('')||'<p class="hint">Nessun volume rilevato.</p>')}${panel('Interfacce di rete',(s.networks||[]).map(n=>`<div class="device-row"><div class="device-top"><strong>${esc(n.name)}</strong></div><div class="device-meta"><span>↓ Ricevuti ${rate(n.received_per_sec)}</span><span>↑ Inviati ${rate(n.transmitted_per_sec)}</span></div><div class="device-meta"><span>Totale ${bytes(n.total_received)}</span><span>Totale ${bytes(n.total_transmitted)}</span></div></div>`).join('')||'<p class="hint">Nessuna interfaccia rilevata.</p>')}</div><p class="hint">Le velocità sono differenze fra contatori divise per l’intervallo effettivo. I volumi montati possono condividere lo stesso dispositivo fisico; i contatori I/O non costituiscono un benchmark del disco.</p>`;
}
function sortedProcesses(v) {
  const query = processQuery.toLocaleLowerCase('it-IT').trim();
  const key = {Cpu:'cpu_percent',Memory:'memory_bytes',Name:'name',Pid:'pid'}[processSort] || 'cpu_percent';
  return [...(v.snapshot.processes||[])].filter(p=>!query||p.name.toLocaleLowerCase('it-IT').includes(query)||String(p.pid).includes(query)).sort((a,b)=>{
    const order = key==='name' ? a.name.localeCompare(b.name,'it') : a[key]-b[key];
    return (processAscending?order:-order)||a.pid-b.pid;
  });
}
function processesPage(v) {
  if (replay) return empty('Dettagli dei processi non archiviati','I campioni archiviati conservano soltanto un riepilogo dei processi LLM. Torna alla vista live per esplorare tutti i processi correnti.','processes');
  return panel('Esplora i processi',`<div class="toolbar"><div class="field search"><label for="process-search">Cerca per nome o PID</label><input id="process-search" type="search" placeholder="Es. ollama, chrome, 1234…" value="${esc(processQuery)}"></div><div class="field"><label for="process-sort">Ordina per</label><select id="process-sort">${[['Cpu','CPU'],['Memory','Memoria RAM'],['Name','Nome'],['Pid','PID']].map(([key,label])=>`<option value="${key}" ${processSort===key?'selected':''}>${label}</option>`).join('')}</select></div><button type="button" class="button secondary" id="process-order">${processAscending?'↑ Crescente':'↓ Decrescente'}</button><button type="button" class="button secondary" data-action="save-sort">Ricorda ordine</button></div><div id="process-table">${processTable(v)}</div><p class="hint">CPU normalizzata sulla capacità complessiva della macchina (0–100%). La RAM è il working set; le attribuzioni GPU per PID non si sommano per stimare memoria fisica. Seleziona una riga per fissarne i dettagli al campione.</p><div id="process-detail">${processDetailView()}</div>`,`<span class="panel-tag" id="process-count">${sortedProcesses(v).length} PROCESSI</span>`);
}
function processTable(v) {
  const heading=(key,label)=>({sort:processSort===key?(processAscending?'ascending':'descending'):'none',label:`<button type="button" class="sort-button" data-sort="${key}" aria-label="Ordina per ${label}">${label}<span aria-hidden="true">${processSort===key?(processAscending?' ↑':' ↓'):' ↕'}</span></button>`});
  return table([heading('Name','Processo'),heading('Pid','PID'),heading('Cpu','CPU'),heading('Memory','RAM'),'GPU','VRAM dedicata','Lettura','Scrittura'],processRows(sortedProcesses(v),true));
}
function processDetailView() {
  if (!processDetail) return '';
  const p = processDetail.row;
  return `<section class="comparison-name section-spacer"><div class="panel-head"><div><h3>${esc(p.name)} · PID ${p.pid}</h3><p>Dettaglio fissato al campione delle ${clock(processDetail.timestamp)}</p></div><button class="text-link" type="button" data-action="close-process">Chiudi</button></div>${specs([{label:'CPU complessiva',value:pct(p.cpu_percent)},{label:'RAM working set',value:bytes(p.memory_bytes)},{label:'Memoria GPU dedicata',value:bytes(p.gpu_memory_bytes)},{label:'Memoria GPU condivisa',value:bytes(p.gpu_shared_memory_bytes)},{label:'Carico GPU',value:pct(p.gpu_percent)},{label:'Lettura / scrittura',value:`${rate(p.read_bytes_per_sec)} / ${rate(p.write_bytes_per_sec)}` }],true)}</section>`;
}
function llmPage(v) {
  const llm = (replay ? live.llm : v.llm) || {runtimes:[],observations:[]};
  return `<div class="toolbar"><button type="button" class="button primary" data-action="refresh-llm">Aggiorna runtime</button><span class="hint">Ultima rilevazione: ${clock(llm.last_probe_unix)}</span>${live.benchmark_running?'<button type="button" class="button danger" data-action="cancel-benchmark">Annulla benchmark</button>':''}</div><p class="hint">La rilevazione legge le API locali. Nessuna inferenza parte automaticamente. Un benchmark usa un breve prompt sintetico e richiede conferma.</p>${replay?'<div class="banner">Runtime e modelli provengono dalla rilevazione live; non sono ricostruiti dalla sessione archiviata. I benchmark sotto appartengono alla sessione selezionata.</div>':''}${llm.runtimes.length ? llm.runtimes.map((r,ri)=>`<section class="runtime-card"><div class="runtime-top"><div><h2>${esc(r.name)}</h2><p>${esc(r.endpoint)}</p></div>${statusBadge(r.status)}</div><p class="runtime-message">${esc(r.message)}</p>${table(['Modello','Dimensione','VRAM','Contesto','Stato','Azione'],(r.models||[]).map((m,mi)=>`<tr><td class="wrap">${esc(m.id)}${m.quantization?`<p class="hint">${esc(m.quantization)}</p>`:''}</td><td>${bytes(m.size_bytes)}</td><td>${bytes(m.vram_bytes)}</td><td>${number(m.context_length,0)}</td><td>${m.loaded===true?badge('Caricato','online'):m.loaded===false?badge('Disponibile'):badge('Non indicato')}</td><td><button type="button" class="button secondary small" data-llm-runtime="${ri}" data-llm-model="${mi}" data-llm-runtime-name="${esc(r.name)}" data-llm-model-id="${esc(m.id)}" ${live.benchmark_running?'disabled':''}>Benchmark</button></td></tr>`))}</section>`).join('') : empty('Rileva i runtime locali','Premi Aggiorna runtime per cercare Ollama, LM Studio e llama.cpp agli indirizzi impostati.','llm')}${live.benchmark_running?'<div class="banner">Benchmark in esecuzione. Puoi continuare a consultare le altre viste.</div>':''}${live.benchmark_error?`<p class="hint danger-text">${esc(live.benchmark_error)}</p>`:''}${panel('Cronologia benchmark LLM',benchmarks(v,'llm'))}${panel('Richieste osservate',table(['Runtime','Modello','Velocità','Metodo'],(llm.observations||[]).map(b=>`<tr><td>${esc(b.runtime)}</td><td>${esc(b.model)}</td><td>${number(b.generation_tokens_per_sec,2)} tok/s</td><td>${esc(b.throughput_kind)}</td></tr>`)),badge('OBSERVER OPZIONALE'))}<p class="hint">L’observer del motore CLI registra soltanto le richieste instradate volontariamente attraverso il proxy loopback. I nomi dei processi LLM sono indizi e non attribuiscono automaticamente lavoro o VRAM a una conversazione.</p>`;
}
function capacityValues(c) {
  const weights = c.parameters_b*1e9*c.bits_per_weight/8;
  const kv = 2*c.layers*c.context*c.kv_heads*c.head_dim*2;
  const overhead = weights*.15+512*1024**2;
  return {weights,kv,overhead,total:weights+kv+overhead};
}
function capacityPage(v) {
  const c = v.preferences.capacity;
  return `<div class="two-cols">${panel('Configurazione del modello',`<form id="capacity-form"><div class="form-grid">${numericField('parameters_b','Parametri (miliardi)',c.parameters_b,.5,1000,.5)}${numericField('bits_per_weight','Bit medi per peso',c.bits_per_weight,1,32,.1)}${numericField('context','Token di contesto',c.context,1024,1048576,1024)}${numericField('layers','Layer',c.layers,1,256,1)}${numericField('kv_heads','Teste KV (GQA)',c.kv_heads,1,256,1)}${numericField('head_dim','Dimensione testa',c.head_dim,16,1024,1)}</div><button type="submit" class="button primary">Salva configurazione</button></form>`)}${panel('Stima di memoria',`<div id="capacity-result">${capacityResult(c,v.snapshot)}</div>`,badge('STIMA ORIENTATIVA'))}</div>${panel('Come viene calcolata',specs([{label:'Pesi',value:'Parametri × bit medi per peso ÷ 8'},{label:'KV cache FP16',value:'2 × layer × token × teste KV × dimensione testa × 2 byte'},{label:'Margine operativo',value:'15% dei pesi + 512 MiB'},{label:'Limiti del modello',value:'Una singola sequenza; cache KV FP16. Runtime, quantizzazione KV, batch e architettura possono cambiare il fabbisogno.'}]))}<p class="hint">Confronto separato con RAM disponibile e VRAM libera dedicata: non vengono sommate. Il risultato non garantisce che un modello sia caricabile o veloce.</p>`;
}
function capacityResult(c,s) {
  const r = capacityValues(c);
  const freeRam = Math.max(0,s.memory_total-s.memory_used);
  const gpus = (s.gpus||[]).filter(g=>finite(g.memory_total)&&finite(g.memory_used));
  return `<p class="hint">Fabbisogno indicativo complessivo</p><div class="capacity-result">${number(r.total/2**30,2)} <span>GiB</span></div><div class="capacity-segments" aria-label="Ripartizione della memoria stimata"><span style="width:${r.weights/r.total*100}%" title="Pesi"></span><span style="width:${r.kv/r.total*100}%" title="KV cache"></span><span style="width:${r.overhead/r.total*100}%" title="Margine"></span></div><div class="legend"><span><i></i>Pesi</span><span><i class="blue"></i>KV cache</span><span><i style="background:var(--amber)"></i>Margine</span></div>${specs([{label:'Pesi modello',value:bytes(r.weights)},{label:'KV cache',value:bytes(r.kv)},{label:'Margine operativo',value:bytes(r.overhead)},{label:'RAM libera rilevata',value:`${bytes(freeRam)} · ${r.total<=freeRam?'stima entro il margine':'stima oltre il margine'}`},...gpus.map(g=>({label:`VRAM libera · ${g.name}`,value:`${bytes(Math.max(0,g.memory_total-g.memory_used))} · ${r.total<=g.memory_total-g.memory_used?'stima entro il margine':'stima oltre il margine'}`}))],true)}`;
}
const numericField = (id,label,value,min,max,step,group='capacity') => `<div class="field"><label for="${group}-${id}">${esc(label)}</label><input type="number" id="${group}-${id}" name="${id}" min="${min}" max="${max}" step="${step}" value="${esc(value)}" required></div>`;
function diagnosticsHardwarePage(v) {
  const s = v.snapshot;
  const warnings = [...new Set([...(v.inventory.warnings||[]),...(s.warnings||[])])];
  return `<div class="two-cols">${panel('Stato del campionamento',specs([{label:'Ultimo campione',value:clock(s.timestamp_unix)},{label:'Durata raccolta',value:`${number(s.sampling_ms,0)} ms`},{label:'Intervallo richiesto',value:`${number(v.preferences.interval_ms,0)} ms`},{label:'Tempo monitoraggio',value:duration(s.elapsed_secs)},{label:'Archivio SQLite',value:v.database_path},{label:'Esportazioni',value:v.export_dir}]))}${panel('Sensori disponibili',table(['Sensore','Temperatura'],(s.sensors||[]).map(sensor=>`<tr><td class="wrap">${esc(sensor.name)}</td><td>${number(sensor.temperature)} °C</td></tr>`))+specs(s.sensor_details||[],true))}</div>${panel('Avvisi dei provider',warnings.length ? `<ul class="notice-list">${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="hint">Nessun avviso segnalato dai provider nel campione corrente.</p>')}${panel('Avvisi di soglia',(v.alerts||[]).length ? `<ul class="notice-list">${[...(v.alerts||[])].reverse().slice(0,100).map(a=>`<li>${esc(a.message)}<span class="alert-time">${clock(a.timestamp_unix)} · soglia ${number(a.threshold)}</span></li>`).join('')}</ul>` : '<p class="hint">Nessuna soglia superata nei campioni disponibili. Puoi modificare le soglie nelle impostazioni.</p>')}${panel('Fonti e limiti',specs([{label:'CPU / RAM / processi',value:'sysinfo. CPU processo normalizzata sul totale dei processori logici; frequenza OS, non clock effettivo per core.'},{label:'Identità hardware',value:'CPUID e WMI/SMBIOS. Informazioni dichiarate da CPU, sistema operativo e firmware.'},{label:'GPU Windows',value:'Contatori WDDM/DXGI, più nvidia-smi quando disponibile. Copertura dipendente da driver e hardware.'},{label:'Sensori avanzati',value:'LibreHardwareMonitor soltanto se già disponibile e in esecuzione. Nessun driver kernel installato automaticamente.'},{label:'Dati non misurati',value:'SPD diretto, timing RAM live, accesso SMBus/MSR e SMART. I valori non esposti restano non disponibili.'}]))}`;
}
function sessionStatus(session) {
  if(session.id===live?.active_session)return {key:'recording',label:'In registrazione',kind:'online'};
  if(session.state==='complete'||session.state==='finished')return {key:'complete',label:'Completata',kind:''};
  if(session.state==='incomplete'||session.state==='interrupted')return {key:'incomplete',label:'Interrotta',kind:'warning'};
  return {key:'open',label:'Aperta',kind:'warning'};
}
function filteredSessions() {
  const query=sessionQuery.trim().toLocaleLowerCase('it-IT');
  return sessions.filter(session=>(!query||session.name.toLocaleLowerCase('it-IT').includes(query)||`#${session.id}`.includes(query))&&(sessionState==='all'||sessionStatus(session).key===sessionState));
}
function sessionArchive() {
  const filtered=filteredSessions();
  const pages=Math.max(1,Math.ceil(filtered.length/sessionPageSize));
  sessionPageIndex=Math.min(sessionPageIndex,pages-1);
  const first=sessionPageIndex*sessionPageSize;
  const rows=filtered.slice(first,first+sessionPageSize).map(s=>{
    const status=sessionStatus(s);
    const picked=side=>String(comparisonIds[side])===String(s.id);
    return `<tr><td><div class="session-name" title="${esc(s.name)}">${esc(s.name)}</div><div class="session-meta">#${s.id} · ${date(s.started_utc)}</div></td><td>${number(s.samples,0)}</td><td>${duration(s.duration_secs)}</td><td>${pct(s.cpu?.average)}</td><td>${bytes(s.ram?.average)}</td><td>${badge(status.label,status.kind)}</td><td><div class="session-actions"><button class="button secondary small ${picked('left')?'active':''}" type="button" data-session-action="compare-left" data-id="${s.id}" aria-label="Usa ${esc(s.name)} come riferimento A" aria-pressed="${picked('left')}">A</button><button class="button secondary small ${picked('right')?'active':''}" type="button" data-session-action="compare-right" data-id="${s.id}" aria-label="Usa ${esc(s.name)} come candidata B" aria-pressed="${picked('right')}">B</button><button class="button secondary small" type="button" data-session-action="replay" data-id="${s.id}" ${s.samples?'':'disabled'}>Replay</button><button class="button secondary small" type="button" data-session-action="export" data-id="${s.id}">Esporta</button><button class="button secondary small" type="button" data-session-action="rename" data-id="${s.id}">Rinomina</button><button class="button danger small" type="button" data-session-action="delete" data-id="${s.id}" ${s.id===live.active_session?'disabled':''}>Elimina</button></div></td></tr>`;
  });
  const ready=comparisonIds.left&&comparisonIds.right&&comparisonIds.left!==comparisonIds.right;
  return `<div class="archive-summary"><span id="session-count" role="status">${filtered.length?`${first+1}–${Math.min(first+sessionPageSize,filtered.length)} di ${filtered.length}`:'0'} sessioni${filtered.length!==sessions.length?` · ${sessions.length} nell’archivio`:''}</span><span>A: ${comparisonIds.left?`#${esc(comparisonIds.left)}`:'da scegliere'} · B: ${comparisonIds.right?`#${esc(comparisonIds.right)}`:'da scegliere'}</span><button type="button" class="button secondary small" data-navigate="compare" ${ready?'':'disabled'}>Apri confronto A/B</button></div>${rows.length?table(['Sessione','Campioni','Durata','CPU media','RAM media','Stato','Azioni'],rows):'<p class="archive-empty">Nessuna sessione corrisponde alla ricerca e allo stato selezionato.</p>'}<div class="pagination" aria-label="Pagine dell’archivio"><button type="button" class="button secondary small" data-action="session-previous" ${sessionPageIndex===0?'disabled':''}>← Precedente</button><span>Pagina ${sessionPageIndex+1} di ${pages}</span><button type="button" class="button secondary small" data-action="session-next" ${sessionPageIndex>=pages-1?'disabled':''}>Successiva →</button></div>`;
}
function sessionPage(v) {
  return `<div class="toolbar"><button type="button" class="button secondary" data-action="refresh-sessions">Aggiorna elenco</button><button type="button" class="button secondary" data-action="import-session">Importa sessione JSON</button><button type="button" class="button secondary" data-action="backup">Backup archivio</button></div>${sessions.length ? panel('Archivio sessioni',`<div class="toolbar"><div class="field search"><label for="session-search">Cerca per nome o ID</label><input id="session-search" type="search" placeholder="Es. rendering, #12…" value="${esc(sessionQuery)}" aria-controls="session-archive"></div><div class="field"><label for="session-state">Stato</label><select id="session-state">${[['all','Tutte le sessioni'],['complete','Completate'],['incomplete','Interrotte'],['recording','In registrazione']].map(([key,label])=>`<option value="${key}" ${sessionState===key?'selected':''}>${label}</option>`).join('')}</select></div></div><div id="session-archive">${sessionArchive()}</div>`,badge(`${sessions.length} SESSIONI`)) : empty('Il tuo primo punto di confronto','Premi Registra sessione prima di iniziare un lavoro, poi arresta la registrazione al termine. I campioni vengono conservati localmente in SQLite.','sessions')}<p class="hint">Scegli A e B su due righe diverse per preparare un confronto. Le statistiche usano tutti i campioni salvati. Il replay mostra un’anteprima distribuita sull’intera durata, fino a 300 campioni; l’esportazione conserva i dati archiviati. I dettagli dei thread sono disponibili quando presenti nei campioni; l’archivio riduce i processi al riepilogo LLM.</p>${replay?panel('Sessione selezionata',`<div class="mini-stats"><div class="mini-stat"><small>CPU media</small><strong>${pct(replay.summary.cpu?.average)}</strong></div><div class="mini-stat"><small>CPU P95</small><strong>${pct(replay.summary.cpu?.p95)}</strong></div><div class="mini-stat"><small>RAM media</small><strong>${bytes(replay.summary.ram?.average)}</strong></div></div>${resourceChart(view())}${benchmarks(view())}`,badge(replay.summary.name)):''}`;
}
function updateSessionArchive() {
  const archive=$('#session-archive');if(!archive)return;
  const focus=focusedContentSelector(),scroll=$('.table-wrap',archive)?.scrollLeft||0;
  archive.innerHTML=sessionArchive();
  const table=$('.table-wrap',archive);if(table)table.scrollLeft=scroll;
  if(focus){const restored=$(focus,archive);if(restored&&!restored.disabled)restored.focus({preventScroll:true});}
}
function updateComparisonContext() {
  const context=$('#comparison-context');if(!context||!comparison)return;
  const changed=String(comparison.left.id)!==String(comparisonIds.left)||String(comparison.right.id)!==String(comparisonIds.right);
  context.classList.toggle('changed',changed);
  context.innerHTML=`<strong>${changed?'Selezione modificata: il risultato precedente rimane visibile.':'Confronto visualizzato'}</strong><span>A: #${comparison.left.id} · ${esc(comparison.left.name)} → B: #${comparison.right.id} · ${esc(comparison.right.name)}.${changed?' Premi Confronta sessioni per applicare la nuova selezione.':''}</span>`;
}

function metricFormat(value,unit) {
  if (!finite(value)) return '—';
  if (/byte/i.test(unit)||unit==='B') return `${value<0?'−':''}${bytes(Math.abs(value))}`;
  if (unit==='%') return pct(value);
  return `${number(value,2)} ${esc(unit)}`;
}
function comparisonTable(metrics) {
  return table(['Misura','A · riferimento','B · candidata','Delta B − A','Variazione'],metrics.map(m=>`<tr><td class="wrap">${esc(m.label)}</td><td>${metricFormat(m.left,m.unit)}</td><td>${metricFormat(m.right,m.unit)}</td><td>${finite(m.delta)&&m.delta>0?'+':''}${metricFormat(m.delta,m.unit)}</td><td>${finite(m.delta_percent)&&m.delta_percent>0?'+':''}${pct(m.delta_percent)}</td></tr>`));
}
function comparePage(v) {
  const options = selected => '<option value="">Scegli una sessione</option>'+sessions.map(s=>`<option value="${s.id}" ${String(s.id)===String(selected)?'selected':''}>#${s.id} · ${esc(s.name)} · ${date(s.started_utc)}</option>`).join('');
  let result = '';
  if (comparison) {
    const changed=String(comparison.left.id)!==String(comparisonIds.left)||String(comparison.right.id)!==String(comparisonIds.right);
    result = `<div id="comparison-context" class="report-context ${changed?'changed':''}" role="status"><strong>${changed?'Selezione modificata: il risultato precedente rimane visibile.':'Confronto visualizzato'}</strong><span>A: #${comparison.left.id} · ${esc(comparison.left.name)} → B: #${comparison.right.id} · ${esc(comparison.right.name)}.${changed?' Premi Confronta sessioni per applicare la nuova selezione.':''}</span></div><div class="two-cols"><div class="comparison-name"><small>A · RIFERIMENTO</small><strong>${esc(comparison.left.name)}</strong><p>${number(comparison.left.samples,0)} campioni · ${duration(comparison.left.duration_secs)}</p></div><div class="comparison-name"><small>B · CANDIDATA</small><strong>${esc(comparison.right.name)}</strong><p>${number(comparison.right.samples,0)} campioni · ${duration(comparison.right.duration_secs)}</p></div></div>${panel('Differenze fra sessioni',comparisonTable(comparison.metrics||[]))}<div class="two-cols">${panel('CPU · sessione A',chart(comparison.left_series||[],[{label:'CPU A',value:cpuValue}],{normalized:true,label:'CPU sessione A a progressione normalizzata'}))}${panel('CPU · sessione B',chart(comparison.right_series||[],[{label:'CPU B',value:cpuValue}],{normalized:true,label:'CPU sessione B a progressione normalizzata'}))}</div>${(comparison.benchmarks||[]).map(b=>panel(b.label,`<p class="hint">${esc(b.method)} · ${b.runs_left} prove A / ${b.runs_right} prove B</p>${comparisonTable(b.metrics||[])}${(b.warnings||[]).map(w=>`<p class="hint warning-text">${esc(w)}</p>`).join('')}`)).join('')}${(comparison.warnings||[]).length?panel('Limiti del confronto',`<ul class="notice-list">${comparison.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`):''}<p class="hint">Gli assi temporali dei grafici sono normalizzati sulla durata, non sincronizzati al tempo di calendario. Una riduzione del carico non dimostra da sola un miglioramento delle prestazioni.</p>`;
  } else result = empty('Due sessioni, un confronto chiaro','Scegli un riferimento A e una candidata B. La media, il picco e il P95 sono calcolati su tutti i campioni, con avvisi per dati mancanti e benchmark non confrontabili.','compare');
  return `<form id="compare-form" class="toolbar"><div class="field search"><label for="compare-left">A · Riferimento</label><select id="compare-left" required>${options(comparisonIds.left)}</select></div><div class="field search"><label for="compare-right">B · Candidata</label><select id="compare-right" required>${options(comparisonIds.right)}</select></div><button type="button" class="button secondary" data-action="swap-comparison" ${comparisonIds.left||comparisonIds.right?'':'disabled'}>Scambia A ↔ B</button><button class="button primary" type="submit" ${sessions.length<2?'disabled':''}>Confronta sessioni</button></form>${result}`;
}
function settingsPage(v) {
  const p = v.preferences, a = p.alerts;
  return `<form id="settings-form"><div class="two-cols">${panel('Aspetto e raccolta',`<label class="checkbox-field"><input type="checkbox" name="theme_light" ${p.theme_light?'checked':''}>Tema chiaro</label><div class="form-grid">${numericField('interval_ms','Intervallo campioni (ms)',p.interval_ms,500,10000,500,'settings')}${numericField('benchmark_repeats','Ripetizioni benchmark',p.benchmark_repeats,1,10,1,'settings')}</div><p class="hint">Il monitoraggio continua durante la pausa della vista. Gli intervalli effettivi possono essere più lunghi quando un provider risponde lentamente.</p>`)}${panel('Avvisi di soglia',`<label class="checkbox-field"><input type="checkbox" name="alerts_enabled" ${a.enabled?'checked':''}>Abilita avvisi locali</label><div class="form-grid">${numericField('cpu_percent','Carico CPU (%)',a.cpu_percent,1,100,1,'settings')}${numericField('ram_percent','Memoria RAM (%)',a.ram_percent,1,100,1,'settings')}${numericField('vram_percent','Memoria VRAM (%)',a.vram_percent,1,100,1,'settings')}${numericField('gpu_temperature_c','Temperatura GPU (°C)',a.gpu_temperature_c,30,120,1,'settings')}${numericField('cpu_temperature_c','Temperatura CPU (°C)',a.cpu_temperature_c,30,120,1,'settings')}${numericField('cooldown_seconds','Intervallo fra avvisi (s)',a.cooldown_seconds,5,3600,5,'settings')}</div>`)}</div>${panel('Runtime LLM locali',`<div class="form-grid"><div class="field"><label for="settings-ollama">Ollama</label><input id="settings-ollama" name="ollama_url" type="url" value="${esc(p.ollama_url)}" required></div><div class="field"><label for="settings-lmstudio">LM Studio</label><input id="settings-lmstudio" name="lm_studio_url" type="url" value="${esc(p.lm_studio_url)}" required></div><div class="field"><label for="settings-llamacpp">llama.cpp</label><input id="settings-llamacpp" name="llama_cpp_url" type="url" value="${esc(p.llama_cpp_url)}" required></div></div><p class="hint">Solo origini HTTP loopback, senza percorsi o credenziali: per esempio http://127.0.0.1:11434. I token si configurano nelle variabili d’ambiente del processo e non vengono salvati qui.</p>`)}<div class="form-actions"><button type="submit" class="button primary">Salva impostazioni</button><p id="settings-feedback" role="status">Le preferenze vengono conservate nell’archivio SQLite locale.</p></div></form>${panel('Dati e archivio',`${specs([{label:'Database',value:v.database_path},{label:'Cartella esportazioni',value:v.export_dir}])}<div class="form-actions section-spacer"><button type="button" class="button secondary" data-action="backup">Crea backup SQLite</button></div>`,'','Archivio separato dalla versione terminale')}`;
}

function scopeOptions(selected){
  const missing=selected!=='live'&&!sessions.some(s=>String(s.id)===String(selected));
  return `<option value="live" ${selected==='live'?'selected':''}>Finestra live · ultimi campioni</option>`+sessions.map(s=>`<option value="${s.id}" ${String(s.id)===String(selected)?'selected':''}>Sessione #${s.id} · ${esc(s.name)}</option>`).join('')+(missing?`<option value="${esc(selected)}" selected>Sessione #${esc(selected)} · non presente nell’elenco</option>`:'');
}
function windowOptions(selected){
  return [['60','Ultimi 60 secondi'],['180','Ultimi 180 secondi'],['600','Ultimi 10 minuti'],['all','Tutti i campioni disponibili']].map(([value,label])=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`).join('');
}
function selectedContext(kind){return {source:kind==='analysis'?analysisSource:diagnosticsSource,window:kind==='analysis'?analysisWindow:diagnosticsWindow};}
function sameContext(a,b){return Boolean(a&&b&&a.source===b.source&&a.window===b.window);}
function contextLabel(context){
  if(!context)return '';
  const source=context.source==='live'?'Finestra live':`Sessione #${context.source}`;
  return `${source} · ${context.window==='all'?'tutti i campioni disponibili':`ultimi ${context.window} secondi`} · calcolato alle ${clock(context.generated/1000)}`;
}
function reportContext(kind,context){
  if(!context)return '';
  const changed=!sameContext(context,selectedContext(kind));
  return `<div class="report-context ${changed?'changed':''}" role="status"><strong>${changed?'Selezione modificata: aggiorna il report per applicarla.':'Report visualizzato'}</strong><span>${esc(contextLabel(context))}</span>${changed?'<span>I risultati sotto mantengono l’origine e la finestra indicate qui.</span>':''}</div>`;
}
function analysisPage(v){
  const report=analysisReport;
  let body='';
  if(!report)body=empty('Esplora i dati delle risorse','Scegli una finestra live o una sessione e premi Analizza dati. Media, mediana, P95 e dispersione sono calcolati dal motore Rust.','analysis');
  else{
    const metrics=report.metrics||[];
    let selected=metrics.find(m=>m.id===analysisMetric)||metrics[0];
    if(selected)analysisMetric=selected.id;
    const stats=selected?.statistics;
    const sourceText=report.source||'Dati analizzati';
    body=`<div class="metrics-grid">${stat('Campioni analizzati',number(report.samples,0),'',sourceText,'analysis')}${stat('Durata coperta',number(report.duration_secs,1),'s',`${clock(report.start_unix)} → ${clock(report.end_unix)}`,'sessions',null,'blue')}${stat('Serie disponibili',number(metrics.length,0),'','CPU, thread, RAM e singole GPU','cpu')}${stat('Valori mancanti',number(stats?.missing,0),'',selected?.label||'Nella serie selezionata','diagnostics',null,'amber')}</div>`;
    if(selected){
      const points=selected.points||[];
      body+=panel('Esplora una serie',`<div class="toolbar"><div class="field search"><label for="analysis-metric">Misura</label><select id="analysis-metric">${metrics.map(m=>`<option value="${esc(m.id)}" ${m.id===selected.id?'selected':''}>${esc(m.label)} · ${esc(m.unit)}</option>`).join('')}</select></div></div>${chart(points,[{label:selected.label,value:p=>p.value}],{unit:selected.unit,label:`${selected.label} · ${selected.unit}`})}<div class="mini-stats"><div class="mini-stat"><small>Media</small><strong>${chartValue(stats?.mean,selected.unit)}</strong></div><div class="mini-stat"><small>P95</small><strong>${chartValue(stats?.p95,selected.unit)}</strong></div><div class="mini-stat"><small>Valori presenti</small><strong>${number(stats?.count,0)}</strong></div></div>`,badge(sourceText));
    }
    body+=panel('Statistiche per ogni risorsa',table(['Misura','Presenti / assenti','Minimo','Massimo','Media','Mediana','P95','Dev. standard','Delta ultimo − primo'],metrics.map(m=>{const s=m.statistics||{};return `<tr><td class="wrap">${esc(m.label)}<div class="session-meta">${esc(m.id)}</div></td><td>${number(s.count,0)} / ${number(s.missing,0)}</td><td>${chartValue(s.min,m.unit)}</td><td>${chartValue(s.max,m.unit)}</td><td>${chartValue(s.mean,m.unit)}</td><td>${chartValue(s.median,m.unit)}</td><td>${chartValue(s.p95,m.unit)}</td><td>${chartValue(s.std_dev,m.unit)}</td><td>${finite(s.delta)&&s.delta>0?'+':''}${chartValue(s.delta,m.unit)}</td></tr>`;})),badge('CALCOLATE IN RUST'));
    if(report.warnings?.length)body+=panel('Limiti dell’analisi',`<ul class="notice-list">${report.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`);
  }
  return `<form id="analysis-form" class="toolbar"><div class="field search"><label for="analysis-source">Origine dei dati</label><select id="analysis-source">${scopeOptions(analysisSource)}</select></div><div class="field"><label for="analysis-window">Finestra temporale</label><select id="analysis-window">${windowOptions(analysisWindow)}</select></div><button type="submit" id="analysis-refresh" class="button primary" ${analysisBusy?'disabled':''}>${analysisBusy?'Analisi in corso…':'Analizza dati'}</button><button type="button" class="button secondary" data-action="export-analysis" ${!report?'disabled':''}>Esporta report visualizzato</button></form><label class="checkbox-field analysis-auto"><input id="analysis-auto-refresh" type="checkbox" ${analysisAutoRefresh?'checked':''} ${analysisSource!=='live'?'disabled':''}>Aggiorna l’analisi live ogni 5 secondi</label><p class="hint analysis-note">La finestra live conserva al massimo 180 campioni: la durata disponibile dipende dall’intervallo. Le statistiche di una sessione usano tutti i campioni nell’ambito richiesto; i punti del grafico possono essere ridotti. I dati mancanti non diventano zero.</p>${reportContext('analysis',analysisContext)}${body}`;
}
async function loadAnalysis(){
  if(analysisBusy)return;
  analysisBusy=true;
  const context={...selectedContext('analysis'),generated:Date.now()};
  const revision=++analysisRevision;
  const button=$('#analysis-refresh');if(button){button.disabled=true;button.textContent='Analisi in corso…';}
  try{
    const report=await ipc('analyze_data',{sessionId:context.source==='live'?null:Number(context.source),windowSeconds:context.window==='all'?null:Number(context.window)});
    if(revision!==analysisRevision)return;
    analysisReport=report;analysisContext=context;
    lastAnalysisRefresh=Date.now();
    if(route==='analysis')render({force:true});
  }catch(error){toast(String(error?.message||error),true);}
  finally{analysisBusy=false;const button=$('#analysis-refresh');if(button){button.disabled=false;button.textContent='Analizza dati';}}
}
function diagnosticsPage(v){
  const r=diagnosticsReport;
  const findings=r?panel('Risultato dei controlli',`<p class="hint">${esc(r.summary)}</p><p class="hint">${esc(r.scope)} · ${number(r.samples,0)} campioni</p>${(r.findings||[]).map(f=>`<article class="finding ${esc(f.severity)}"><div class="panel-head"><h3>${esc(f.title)}</h3>${badge(({error:'Errore',warning:'Attenzione',info:'Informazione'})[f.severity]||f.severity,f.severity==='error'?'error':f.severity==='warning'?'warning':'')}</div><p>${esc(f.message)}</p>${specs([{label:'Evidenza',value:f.evidence},{label:'Azione suggerita',value:f.recommendation}],true)}</article>`).join('')}`):'';
  const events=systemEvents?panel('Eventi di sistema Windows',`${(systemEvents.warnings||[]).map(w=>`<p class="hint warning-text">${esc(w)}</p>`).join('')}${table(['Data','Provider / ID','Livello','Messaggio'],(systemEvents.events||[]).map(e=>`<tr><td>${esc(e.timestamp)}</td><td class="wrap">${esc(e.provider)} · ${esc(e.event_id)}</td><td>${esc(e.level)}</td><td class="wrap">${esc(e.message)}</td></tr>`))}<p class="hint">Gli eventi descrivono segnalazioni del sistema operativo. La loro presenza non dimostra da sola un guasto hardware.</p>`):'';
  return `<form id="diagnostics-form" class="toolbar"><div class="field search"><label for="diagnostics-source">Dati da controllare</label><select id="diagnostics-source">${scopeOptions(diagnosticsSource)}</select></div><div class="field"><label for="diagnostics-window">Finestra temporale</label><select id="diagnostics-window">${windowOptions(diagnosticsWindow)}</select></div><button type="submit" id="diagnostics-refresh" class="button primary" ${diagnosticsBusy?'disabled':''}>${diagnosticsBusy?'Controllo in corso…':'Analizza problemi'}</button><button type="button" class="button secondary" data-action="scan-system-events">Leggi eventi Windows</button></form><p class="hint analysis-note">I controlli cercano anomalie nei campioni e negli avvisi dei provider. Sono indicazioni da verificare e non una diagnosi di guasto del computer.</p>${reportContext('diagnostics',diagnosticsContext)}${findings}${events}<div class="section-context">Dettagli del campione ${replay?'archiviato':paused?'in pausa':'live'} visualizzato · ${clock(v.snapshot.timestamp_unix)}</div>${diagnosticsHardwarePage(v)}`;
}
async function loadDiagnostics(){
  if(diagnosticsBusy)return;
  diagnosticsBusy=true;
  const context={...selectedContext('diagnostics'),generated:Date.now()};
  const revision=++diagnosticsRevision;
  const button=$('#diagnostics-refresh');if(button){button.disabled=true;button.textContent='Controllo in corso…';}
  try{
    const report=await ipc('get_diagnostics',{sessionId:context.source==='live'?null:Number(context.source),windowSeconds:context.window==='all'?null:Number(context.window)});
    if(revision!==diagnosticsRevision)return;
    diagnosticsReport=report;diagnosticsContext=context;
    if(route==='diagnostics')render({force:true});
  }catch(error){toast(String(error?.message||error),true);}
  finally{diagnosticsBusy=false;const button=$('#diagnostics-refresh');if(button){button.disabled=false;button.textContent='Analizza problemi';}}
}

function render({force = false} = {}) {
  const v = view();
  renderChrome();
  if (!v?.snapshot) {
    chartRegistry.clear();chartCursor=null;
    $('#content').dataset.route='';
    $('#content').innerHTML=live?.error?empty('Il monitor richiede attenzione',live.error,'diagnostics','<button type="button" class="button secondary" data-action="retry">Riprova</button>'):empty('In attesa dei dati hardware','Il campionamento deve ancora fornire una misura valida. Il monitor aggiorna automaticamente questa vista.','cpu');
    return;
  }
  // Do not replace a form while the user is editing it or a select is open.
  if (!force && ['settings','capacity','compare','analysis'].includes(route) && $('#content').dataset.route===route) {
    if(route==='capacity'&&$('#capacity-form')?.checkValidity()){
      const capacity=Object.fromEntries([...new FormData($('#capacity-form'))].map(([key,value])=>[key,Number(value)]));
      $('#capacity-result').innerHTML=capacityResult(capacity,v.snapshot);
    }
    return;
  }
  if (!force && $('#content').contains(document.activeElement) && (document.activeElement.tagName==='INPUT'||document.activeElement===openSelect)) {
    if (route==='processes') updateProcessTable();
    if (route==='sessions') updateSessionArchive();
    return;
  }
  const scroll = window.scrollY;
  const tableScrolls=$('#content').dataset.route===route?$$('.table-wrap',$('#content')).map(node=>node.scrollLeft):[];
  const active=document.activeElement;
  const selection=active?.tagName==='INPUT'&&typeof active.selectionStart==='number'?{start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection}:null;
  const focusSelector = focusedContentSelector();
  const savedCursor=chartCursor?{...chartCursor}:null;
  chartCounter=0;chartRegistry.clear();
  const page = {overview,cpu:cpuPage,board:x=>panel('Scheda madre e firmware',specs(x.inventory.board||[]),'<span class="panel-tag">WMI / SMBIOS</span>')+'<p class="hint">I valori provengono dal firmware. Identificativi univoci e numeri di serie non vengono raccolti.</p>',memory:memoryPage,gpu:gpuPage,disks:disksPage,processes:processesPage,llm:llmPage,capacity:capacityPage,diagnostics:diagnosticsPage,analysis:analysisPage,sessions:sessionPage,compare:comparePage,settings:settingsPage}[route];
  $('#content').innerHTML = page(v);
  $('#content').dataset.route = route;
  bindPage();
  restoreDraft();
  $$('.table-wrap',$('#content')).forEach((node,index)=>{node.scrollLeft=tableScrolls[index]||0;});
  if (focusSelector) {
    const restored = $(focusSelector, $('#content'));
    restoringFocus=true;
    (restored || $('#main')).focus({preventScroll:true});
    if(restored&&selection&&restored.tagName==='INPUT')restored.setSelectionRange(selection.start,selection.end,selection.direction);
    restoringFocus=false;
  }
  if(savedCursor){
    const frame=$(`[data-chart-key="${savedCursor.key}"]`,$('#content'));
    const data=chartRegistry.get(savedCursor.key);
    if(frame&&data){
      let closest=0;
      const time=sample=>finite(savedCursor.elapsed)&&finite(sample.elapsed_secs)?sample.elapsed_secs:sample.timestamp_unix;
      const target=finite(savedCursor.elapsed)?savedCursor.elapsed:savedCursor.timestamp;
      data.samples.forEach((sample,i)=>{if(Math.abs(time(sample)-target)<Math.abs(time(data.samples[closest])-target))closest=i;});
      showChartCursor(frame,closest);
    }
  }
  window.scrollTo(0,scroll);
}
function focusedContentSelector() {
  const active = document.activeElement;
  if (!active || !$('#content').contains(active)) return null;
  if (active.id) return `#${CSS.escape(active.id)}`;
  const keys = ['action','sessionAction','id','process','llmRuntime','llmModel','navigate','chartKey','sort'];
  const selectors = keys.filter(key=>active.dataset[key]!==undefined).map(key=>{
    const attr = key.replace(/[A-Z]/g,char=>`-${char.toLowerCase()}`);
    return `[data-${attr}="${CSS.escape(active.dataset[key])}"]`;
  });
  return selectors.length ? selectors.join('') : null;
}
function renderChrome() {
  const meta = routes.find(r=>r[0]===route) || routes[0];
  $('#eyebrow').textContent = meta[2];
  $('#page-title').textContent = meta[1];
  $('#page-description').textContent = meta[3];
  document.title = `${meta[1]} · CPU-RustT`;
  $$('.nav-item').forEach(item=>{item.classList.toggle('active',item.dataset.route===route);if(item.dataset.route===route)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
  const stale = live?.snapshot ? Date.now()/1000-live.snapshot.timestamp_unix > Math.max(8,live.preferences.interval_ms/1000*3) : false;
  $('#connection-dot').className = `status-dot${live?.error?' error':stale?' warning':''}`;
  $('#connection-text').textContent = live?.error ? 'Attenzione al monitor' : !live?.snapshot ? 'Preparazione del primo campione…' : stale ? 'Campione in ritardo' : 'Monitoraggio attivo';
  $('#sample-label').textContent = live?.snapshot ? `Ultimo campione ${clock(live.snapshot.timestamp_unix)} · raccolta ${number(live.snapshot.sampling_ms,0)} ms` : 'In attesa del primo campione';
  const prefs = live?.preferences;
  if (prefs) document.documentElement.dataset.theme = prefs.theme_light ? 'light' : 'dark';
  $('#theme-button').innerHTML = icon(prefs?.theme_light?'moon':'sun');
  $('#theme-button').setAttribute('aria-label',`Attiva tema ${prefs?.theme_light?'scuro':'chiaro'}`);
  $('#pause-button').innerHTML = icon(paused?'play':'pause')+(paused?'Riprendi vista':'Pausa vista');
  $('#pause-button').classList.toggle('active',paused);
  $('#pause-button').disabled = !live?.snapshot || Boolean(replay);
  $('#record-button').innerHTML = icon('record')+(live?.active_session?'Ferma registrazione':paused||replay?'Registra live':'Registra sessione');
  $('#record-button').title=paused||replay?'La registrazione raccoglie i campioni live, anche mentre visualizzi dati in pausa o archiviati.':'Registra i campioni live nell’archivio locale.';
  $('#record-button').classList.toggle('recording',Boolean(live?.active_session));
  $('#record-button').disabled = !live?.snapshot;
  $('#export-button').innerHTML = icon('export')+'Esporta campione';
  $('#export-button').title='Esporta esattamente il campione visualizzato, anche in pausa o durante il replay.';
  $('#export-button').disabled = !view()?.snapshot;
  const shown=view()?.snapshot;
  $('#view-context').textContent=shown?`${replay?'REPLAY ARCHIVIATO':paused?'CAMPIONE IN PAUSA':'DATI LIVE'} · ${clock(shown.timestamp_unix)}${finite(shown.elapsed_secs)?` · tempo monitor +${number(shown.elapsed_secs,1)} s`:''}`:'Preparazione dei dati…';
  $('#view-context').classList.toggle('archived',Boolean(replay||paused));
  const banner = $('#global-banner');
  banner.hidden = !(live?.error || stale || paused);
  banner.className = `banner${live?.error?' error':''}`;
  const message=live?.error || (stale ? 'Il campione live è in ritardo. I valori mostrati appartengono all’ultimo aggiornamento ricevuto.' : paused ? 'Vista in pausa: raccolta e registrazione continuano. Le esportazioni conservano il campione visualizzato.' : '');
  if(banner.textContent!==message)banner.textContent=message;
  $('#footer-system').textContent = live?.inventory?.cpu_name || 'Raccolta hardware locale';
  $('#footer-status').textContent = replay ? `Replay archiviato · ${replay.summary.name}` : live?.active_session ? `Registrazione locale attiva · sessione #${live.active_session}` : 'Nessun dato inviato online';
  renderReplayBanner();
}
const $$ = (selector,root=document) => [...root.querySelectorAll(selector)];
function renderReplayBanner() {
  const el = $('#replay-banner');
  el.hidden = !replay;
  if (!replay) { el.innerHTML=''; return; }
  const s = replay.samples[replayIndex];
  const focused = document.activeElement?.id==='replay-slider';
  if (focused) return;
  el.innerHTML = `<div><strong>REPLAY · ${esc(replay.summary.name)}</strong><small>${clock(s?.timestamp_unix)} · ${replay.samples.length} campioni in anteprima su ${replay.total_samples} totali. ${hasCoreDetails(view())?'Dettagli dei thread disponibili.':'Topologia dei thread incompleta in questo campione.'}</small></div><div class="replay-controls"><label class="quiet" for="replay-slider">Campione</label><input id="replay-slider" type="range" min="0" max="${Math.max(0,replay.samples.length-1)}" value="${replayIndex}" aria-label="Campione del replay"><span id="replay-position">${replayIndex+1} / ${replay.samples.length}</span><button class="button secondary small" type="button" id="replay-live">Torna live</button></div>`;
  $('#replay-slider').addEventListener('input',event=>{replayIndex=Number(event.target.value);$('#replay-position').textContent=`${replayIndex+1} / ${replay.samples.length}`;render({force:true});});
  $('#replay-live').addEventListener('click',()=>{replay=null;render({force:true});});
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const next = await ipc('get_state');
    live = next;
    if (!initialized) {
      processSort = next.preferences.sort;
      processAscending = next.preferences.ascending;
      initialized = true;
    }
    if (lastBenchmarkRunning && !next.benchmark_running) {
      toast(next.benchmark_error || 'Benchmark terminato. Risultati salvati nell’archivio.',Boolean(next.benchmark_error));
    } else if (next.benchmark_error && next.benchmark_error!==lastBenchmarkError) {
      toast(next.benchmark_error,true);
    }
    lastBenchmarkRunning = next.benchmark_running;
    lastBenchmarkError = next.benchmark_error;
    render();
    if(route==='analysis'&&analysisAutoRefresh&&analysisReport&&analysisSource==='live'&&sameContext(analysisContext,selectedContext('analysis'))&&!paused&&!replay&&Date.now()-lastAnalysisRefresh>5000&&!$('#content').contains(document.activeElement))void loadAnalysis();
    if(route==='sessions'&&live.active_session&&Date.now()-lastSessionsRefresh>5000&&!sessionRefresh)void refreshSessionView();
  } catch (error) {
    $('#connection-text').textContent = 'Connessione al motore non disponibile';
    $('#connection-dot').className='status-dot error';
    if (!live) $('#content').innerHTML = empty('Apri l’app desktop',String(error?.message||error),'cpu','<button type="button" class="button secondary" data-action="retry">Riprova</button>');
    else { $('#global-banner').hidden=false; $('#global-banner').className='banner error'; $('#global-banner').textContent=`Aggiornamento non riuscito: ${String(error?.message||error)}. Il monitor riproverà automaticamente.`; }
  } finally { polling = false; }
}
async function refreshSessions() {
  if(sessionRefresh)return sessionRefresh;
  sessionRefresh=ipc('get_sessions').then(result=>{sessions=result;for(const side of ['left','right'])if(comparisonIds[side]&&!sessions.some(s=>String(s.id)===String(comparisonIds[side])))comparisonIds[side]='';lastSessionsRefresh=Date.now();}).finally(()=>{sessionRefresh=null;});
  return sessionRefresh;
}
async function refreshSessionView(){
  const expectedRoute=route;
  try{await refreshSessions();if(route===expectedRoute&&!openSelect)render({force:true});}
  catch(error){toast(`Impossibile aggiornare le sessioni: ${String(error?.message||error)}`,true);}
}
function navigate(target, focus = true) {
  if (!routes.some(r=>r[0]===target)) target='overview';
  route=target;
  if (location.hash!==`#${target}`) history.replaceState(null,'',`#${target}`);
  render({force:true});
  if (focus) $('#main').focus({preventScroll:true});
  window.scrollTo(0,0);
  $('.nav-item.active')?.scrollIntoView({block:'nearest',inline:'nearest'});
  if (['sessions','compare','analysis','diagnostics'].includes(route)) void refreshSessionView();
}
function updateProcessTable() {
  const v = view();
  if (!v || !$('#process-table')) return;
  const scroll = $('.table-wrap',$('#process-table'))?.scrollLeft || 0;
  const focus=focusedContentSelector();
  $('#process-table').innerHTML = processTable(v);
  $('.table-wrap',$('#process-table')).scrollLeft=scroll;
  $('#process-count').textContent = `${sortedProcesses(v).length} PROCESSI`;
  $('#process-sort').value=processSort;
  $('#process-order').textContent=processAscending?'↑ Crescente':'↓ Decrescente';
  if(focus){const restored=$(focus,$('#process-table'));if(restored)restored.focus({preventScroll:true});}
}
function bindPage() {
  $('#session-search')?.addEventListener('input',event=>{sessionQuery=event.target.value;sessionPageIndex=0;updateSessionArchive();});
  $('#session-state')?.addEventListener('change',event=>{sessionState=event.target.value;sessionPageIndex=0;updateSessionArchive();});
  $('#cpu-series')?.addEventListener('change',event=>{cpuSeries=event.target.value;render({force:true});});
  $('#cpu-repeats')?.addEventListener('change',event=>{cpuRepeats=Number(event.target.value);});
  $('#gpu-adapter')?.addEventListener('change',event=>{gpuSelected=event.target.value;render({force:true});});
  $('#analysis-form')?.addEventListener('submit',event=>{event.preventDefault();analysisSource=$('#analysis-source').value;analysisWindow=$('#analysis-window').value;void loadAnalysis();});
  $('#analysis-source')?.addEventListener('change',event=>{analysisSource=event.target.value;render({force:true});});
  $('#analysis-window')?.addEventListener('change',event=>{analysisWindow=event.target.value;render({force:true});});
  $('#analysis-auto-refresh')?.addEventListener('change',event=>{analysisAutoRefresh=event.target.checked;});
  $('#analysis-metric')?.addEventListener('change',event=>{analysisMetric=event.target.value;render({force:true});});
  $('#diagnostics-form')?.addEventListener('submit',event=>{event.preventDefault();diagnosticsSource=$('#diagnostics-source').value;diagnosticsWindow=$('#diagnostics-window').value;void loadDiagnostics();});
  $('#diagnostics-source')?.addEventListener('change',event=>{diagnosticsSource=event.target.value;render({force:true});});
  $('#diagnostics-window')?.addEventListener('change',event=>{diagnosticsWindow=event.target.value;render({force:true});});
  $('#process-search')?.addEventListener('input',event=>{processQuery=event.target.value;updateProcessTable();});
  $('#process-sort')?.addEventListener('change',event=>{processSort=event.target.value;updateProcessTable();});
  $('#process-order')?.addEventListener('click',event=>{processAscending=!processAscending;event.currentTarget.textContent=processAscending?'↑ Crescente':'↓ Decrescente';updateProcessTable();});
  $('#capacity-form')?.addEventListener('input',()=>{
    const form = $('#capacity-form');
    if (!form.checkValidity()) return;
    const capacity = Object.fromEntries([...new FormData(form)].map(([key,value])=>[key,Number(value)]));
    $('#capacity-result').innerHTML = capacityResult(capacity,view().snapshot);
  });
  $('#capacity-form')?.addEventListener('submit',event=>{
    event.preventDefault();
    const capacity = Object.fromEntries([...new FormData(event.target)].map(([key,value])=>[key,Number(value)]));
    action(async()=>{live.preferences=await ipc('save_preferences',{preferences:{...live.preferences,capacity}});formDrafts.delete('capacity-form');render({force:true});},'Configurazione Capacity Lab salvata.');
  });
  $('#settings-form')?.addEventListener('submit',event=>{
    event.preventDefault();
    const data = new FormData(event.target);
    const preferences = structuredClone(live.preferences);
    preferences.theme_light=data.has('theme_light');
    preferences.interval_ms=Number(data.get('interval_ms'));
    preferences.benchmark_repeats=Number(data.get('benchmark_repeats'));
    preferences.alerts.enabled=data.has('alerts_enabled');
    for (const key of ['cpu_percent','ram_percent','vram_percent','gpu_temperature_c','cpu_temperature_c','cooldown_seconds']) preferences.alerts[key]=Number(data.get(key));
    for (const key of ['ollama_url','lm_studio_url','llama_cpp_url']) preferences[key]=String(data.get(key)).trim();
    action(async()=>{live.preferences=await ipc('save_preferences',{preferences});cpuRepeats=live.preferences.benchmark_repeats;formDrafts.delete('settings-form');render({force:true});},'Impostazioni salvate.');
  });
  $('#compare-form')?.addEventListener('submit',event=>{
    event.preventDefault();
    comparisonIds={left:$('#compare-left').value,right:$('#compare-right').value};
    if (comparisonIds.left===comparisonIds.right) {toast('Scegli due sessioni diverse per il confronto.',true);return;}
    action(async()=>{comparison=await ipc('compare_sessions',{left:Number(comparisonIds.left),right:Number(comparisonIds.right)});render({force:true});});
  });
  $('#compare-left')?.addEventListener('change',event=>{comparisonIds.left=event.target.value;updateComparisonContext();const swap=$('[data-action="swap-comparison"]');if(swap)swap.disabled=!(comparisonIds.left||comparisonIds.right);});
  $('#compare-right')?.addEventListener('change',event=>{comparisonIds.right=event.target.value;updateComparisonContext();const swap=$('[data-action="swap-comparison"]');if(swap)swap.disabled=!(comparisonIds.left||comparisonIds.right);});
}

async function showAbout(){
  const dialog=$('#about-dialog');
  if(dialog.open)return;
  dialog.showModal();
  $('#about-close').focus();
  const content=$('#about-content');
  content.innerHTML='<p role="status">Caricamento informazioni e licenze locali…</p>';
  try{
    appInfo=appInfo||await ipc('app_info');
    content.innerHTML='<p id="about-version" class="about-version"></p><p class="about-credit">Ideazione, struttura e sviluppo: <strong>Daniele Gabrovec</strong></p><p id="about-copyright"></p><div id="about-details"></div><details class="license-details"><summary>Licenze e riconoscimenti delle dipendenze</summary><p class="hint">L’elenco completo è incluso nell’app e consultabile senza connessione. Seleziona il testo per copiarlo.</p><textarea id="about-notices" readonly spellcheck="false" aria-label="Licenze e riconoscimenti delle dipendenze"></textarea></details><div class="field section-spacer"><label for="about-repository">Repository del progetto</label><input id="about-repository" readonly aria-label="Indirizzo del repository"></div>';
    $('#about-title').textContent=appInfo.name||'CPU-RustT';
    $('#about-version').textContent=`Versione ${appInfo.version||'—'} · applicazione desktop Windows`;
    $('#about-copyright').textContent=appInfo.copyright||'© 2026 Daniele Gabrovec';
    $('#about-details').innerHTML=specs([{label:'Autore',value:appInfo.author||'Daniele Gabrovec'},{label:'Licenza del progetto',value:appInfo.license||'MIT'},{label:'Terze parti',value:'Componenti Rust, Tauri, WebView e librerie dipendenti: licenze e attribuzioni incluse sotto.'}]);
    $('#about-notices').value=appInfo.third_party_notices||'Nessun testo di riconoscimento disponibile in questa build.';
    $('#about-repository').value=appInfo.repository||'';
  }catch(error){content.innerHTML=empty('Informazioni non disponibili',String(error?.message||error),'diagnostics');}
}
$('#about-button').addEventListener('click',showAbout);
$('#about-top-button').addEventListener('click',showAbout);
$('#about-close').addEventListener('click',()=>$('#about-dialog').close());

function exportContext(){
  const v=view();
  if(!v?.snapshot)return null;
  return structuredClone({inventory:v.inventory,snapshot:v.snapshot,llm:v.llm,cpu_benchmark:(v.benchmarks||[]).find(b=>b.cpu)?.cpu||null});
}

$('#navigation').innerHTML = routes.map(([id,label])=>`${id==='analysis'?'<div class="nav-section-label">ANALISI E ARCHIVIO</div>':id==='settings'?'<div class="nav-divider"></div>':''}<a class="nav-item" href="#${id}" data-route="${id}">${icon(id)}<span>${label}</span><span class="nav-arrow" aria-hidden="true">›</span></a>`).join('');
function filterNavigation() {
  const query=$('#navigation-search').value.trim().toLocaleLowerCase('it-IT');
  let matches=0;
  $$('.nav-item').forEach(link=>{const meta=routes.find(item=>item[0]===link.dataset.route);link.hidden=Boolean(query&&!`${meta[1]} ${meta[3]}`.toLocaleLowerCase('it-IT').includes(query));if(!link.hidden)matches++;});
  $$('.nav-section-label,.nav-divider').forEach(node=>{node.hidden=Boolean(query);});
  $('#navigation-empty').hidden=matches>0;
}
$('#navigation-search').addEventListener('input',filterNavigation);
$('#navigation-search').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.target.value='';filterNavigation();$('#main').focus({preventScroll:true});}
  if(event.key==='Enter'){const first=$('.nav-item:not([hidden])');if(first){event.preventDefault();const target=first.dataset.route;event.target.value='';filterNavigation();navigate(target);}}
});
document.addEventListener('keydown',event=>{
  if(event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key.toLowerCase()==='k'&&!$('dialog[open]')){event.preventDefault();$('#navigation-search').focus();$('#navigation-search').select();}
});
$('#navigation').addEventListener('click',event=>{const link=event.target.closest('[data-route]');if(link){event.preventDefault();$('#navigation-search').value='';filterNavigation();navigate(link.dataset.route);}});
$('.brand').addEventListener('click',event=>{event.preventDefault();navigate('overview');});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
$('#pause-button').addEventListener('click',()=>{if(!live?.snapshot||replay)return;paused=!paused;frozen=paused?structuredClone(live):null;render({force:true});});
$('#theme-button').addEventListener('click',()=>{if(!live)return;action(async()=>{live.preferences=await ipc('save_preferences',{preferences:{...live.preferences,theme_light:!live.preferences.theme_light}});render({force:true});});});
$('#export-button').addEventListener('click',()=>{const context=exportContext();if(context)void action(()=>ipc('export_snapshot',{context}),path=>`Campione visualizzato salvato: ${path}`);});
$('#record-button').addEventListener('click',async()=>{
  if (!live?.snapshot) return;
  if (live.active_session) {
    await action(async()=>{await ipc('stop_recording');await refreshSessions();if(route==='sessions')render({force:true});},'Registrazione terminata e sessione salvata.');
  } else {
    const name=await ask({title:'Registra una sessione live',description:`${paused||replay?'Stai visualizzando dati in pausa o archiviati. La nuova registrazione raccoglierà i campioni live. ':''}I campioni vengono salvati nell’archivio SQLite locale.`,value:`Sessione ${new Date().toLocaleString('it-IT')}`,confirm:'Inizia registrazione'});
    if (name) await action(()=>ipc('start_recording',{name}),'Registrazione avviata.');
  }
});
$('#content').addEventListener('click',async event=>{
  const target=event.target.closest('button,[data-process]');
  if (!target) return;
  if (target.dataset.sort) {
    processAscending=processSort===target.dataset.sort?!processAscending:['Name','Pid'].includes(target.dataset.sort);
    processSort=target.dataset.sort;updateProcessTable();return;
  }
  if (target.dataset.navigate) {navigate(target.dataset.navigate);return;}
  if (target.dataset.process) {
    const s=view().snapshot,p=s.processes.find(x=>x.pid===Number(target.dataset.process));
    if(p){processDetail={row:structuredClone(p),timestamp:s.timestamp_unix};$('#process-detail').innerHTML=processDetailView();}
    return;
  }
  if (target.dataset.llmRuntime!==undefined) {
    const runtime={name:target.dataset.llmRuntimeName};
    const model={id:target.dataset.llmModelId};
    if(!model.id||!runtime.name)return;
    const confirmed=await ask({title:'Avvia benchmark LLM',description:`Inviare un breve prompt sintetico a ${runtime.name}, modello ${model.id}? Verranno eseguite ${live.preferences.benchmark_repeats} prove. Il runtime potrebbe caricare il modello e impegnare CPU, GPU e memoria.`,confirm:'Avvia benchmark'});
    if(confirmed)await action(()=>ipc('run_llm_benchmark',{runtime:runtime.name,model:model.id,repeats:live.preferences.benchmark_repeats}),'Benchmark LLM avviato.');
    return;
  }
  if(target.dataset.sessionAction){await handleSessionAction(target.dataset.sessionAction,Number(target.dataset.id));return;}
  switch(target.dataset.action){
    case 'retry': await poll();break;
    case 'session-previous':sessionPageIndex=Math.max(0,sessionPageIndex-1);updateSessionArchive();break;
    case 'session-next':sessionPageIndex++;updateSessionArchive();break;
    case 'swap-comparison':comparisonIds={left:comparisonIds.right,right:comparisonIds.left};render({force:true});break;
    case 'close-process':processDetail=null;$('#process-detail').innerHTML='';break;
    case 'refresh-sessions':await action(async()=>{await refreshSessions();render({force:true});});break;
    case 'import-session':await action(async()=>{const id=await ipc('import_session');if(id!==null){await refreshSessions();render({force:true});toast(`Sessione importata: #${id}`);}});break;
    case 'backup':await action(()=>ipc('backup_database'),path=>`Backup SQLite salvato: ${path}`);break;
    case 'refresh-llm':await action(()=>ipc('refresh_llm'),'Rilevazione runtime avviata.');break;
    case 'export-analysis':{
      if(!analysisReport){toast('Calcola un’analisi prima di esportare il report.',true);break;}
      const report=structuredClone(analysisReport),context=analysisContext;
      await action(()=>ipc('export_analysis',{report,sessionId:context.source==='live'?null:Number(context.source),windowSeconds:context.window==='all'?null:Number(context.window)}),path=>`Report visualizzato esportato: ${path}`);break;
    }
    case 'scan-system-events':await action(async()=>{systemEvents=await ipc('scan_system_events');render({force:true});},'Lettura degli eventi di sistema completata.');break;
    case 'save-sort':await action(async()=>{live.preferences=await ipc('save_preferences',{preferences:{...live.preferences,sort:processSort,ascending:processAscending}});},'Ordinamento dei processi salvato.');break;
    case 'cancel-benchmark':await action(()=>ipc('cancel_benchmark'),'Richiesto annullamento del benchmark.');break;
    case 'cpu-benchmark':{
      const repeats=Number($('#cpu-repeats').value);
      const confirmed=await ask({title:'Avvia benchmark CPU',description:`Eseguire ${repeats} prove mix64, con una fase a singolo thread e una a più thread? Il benchmark impegnerà temporaneamente il processore e salverà i risultati locali.`,confirm:'Avvia benchmark'});
      if(confirmed)await action(()=>ipc('run_cpu_benchmark',{repeats}),'Benchmark CPU avviato.');
      break;
    }
  }
});
document.addEventListener('pointerdown',event=>{openSelect=event.target.tagName==='SELECT'?event.target:null;},true);
document.addEventListener('change',event=>{if(event.target===openSelect)openSelect=null;captureDraft(event.target.closest('form'));},true);
document.addEventListener('input',event=>captureDraft(event.target.closest('form')),true);
document.addEventListener('focusout',event=>{if(event.target===openSelect)openSelect=null;},true);
$('#content').addEventListener('pointermove',event=>{
  const frame=event.target.closest('.chart-frame');
  const data=frame&&chartRegistry.get(frame.dataset.chartKey);if(!data)return;
  const svg=$('.chart-plot',frame),matrix=svg.getScreenCTM();
  if(!matrix)return;
  const logicalX=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()).x;
  let closest=0;
  data.samples.forEach((_,i)=>{if(Math.abs(data.x(i)-logicalX)<Math.abs(data.x(closest)-logicalX))closest=i;});
  showChartCursor(frame,closest);
});
$('#content').addEventListener('pointerout',event=>{
  const frame=event.target.closest('.chart-frame');
  if(frame&&!frame.contains(event.relatedTarget)&&document.activeElement!==frame)hideChartCursor(frame);
});
$('#content').addEventListener('focusin',event=>{if(restoringFocus)return;const frame=event.target.closest('.chart-frame');if(frame){const d=chartRegistry.get(frame.dataset.chartKey);if(d)showChartCursor(frame,chartCursor?.key===frame.dataset.chartKey?chartCursor.index:d.samples.length-1,{announce:true});}});
$('#content').addEventListener('focusout',event=>{const frame=event.target.closest('.chart-frame');if(frame&&!frame.matches(':hover'))hideChartCursor(frame);});
$('#content').addEventListener('keydown',event=>{
  const frame=event.target.closest('.chart-frame');if(!frame)return;
  const data=chartRegistry.get(frame.dataset.chartKey);if(!data)return;
  let index=chartCursor?.key===frame.dataset.chartKey?chartCursor.index:data.samples.length-1;
  if(event.key==='ArrowLeft')index--;else if(event.key==='ArrowRight')index++;else if(event.key==='Home')index=0;else if(event.key==='End')index=data.samples.length-1;else return;
  event.preventDefault();showChartCursor(frame,index,{announce:true});
});
$('#content').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.dataset.process){event.preventDefault();event.target.click();}});
async function handleSessionAction(kind,id){
  const session=sessions.find(s=>s.id===id);
  if(!session)return;
  if(kind==='compare-left'||kind==='compare-right'){
    const side=kind==='compare-left'?'left':'right',other=side==='left'?'right':'left';
    comparisonIds[side]=String(id);if(comparisonIds[other]===String(id))comparisonIds[other]='';
    updateSessionArchive();return;
  }
  if(kind==='replay'){
    await action(async()=>{
      const loaded=await ipc('load_session',{id});
      if(!loaded.samples.length){toast('La sessione non contiene campioni da riprodurre.',true);return;}
      replay=loaded;replayIndex=0;paused=false;frozen=null;render({force:true});
    });
  }else if(kind==='export')await action(()=>ipc('export_session',{id}),path=>`Sessione esportata: ${path}`);
  else if(kind==='rename'){
    const name=await ask({title:'Rinomina sessione',description:'Scegli un nome riconoscibile per questo lavoro.',value:session.name,confirm:'Salva nome'});
    if(name)await action(async()=>{await ipc('rename_session',{id,name});await refreshSessions();if(replay?.summary.id===id)replay.summary.name=name;render({force:true});},'Sessione rinominata.');
  }else if(kind==='delete'){
    const confirmed=await ask({title:'Elimina sessione',description:`Eliminare “${session.name}” e tutti i campioni e benchmark collegati? Questa operazione è definitiva.`,confirm:'Elimina sessione',danger:true});
    if(confirmed)await action(async()=>{await ipc('delete_session',{id});await refreshSessions();if(replay?.summary.id===id)replay=null;if(comparison?.left.id===id||comparison?.right.id===id)comparison=null;for(const side of ['left','right'])if(String(comparisonIds[side])===String(id))comparisonIds[side]='';if(analysisSource===String(id)){analysisSource='live';analysisRevision++;}if(diagnosticsSource===String(id)){diagnosticsSource='live';diagnosticsRevision++;}render({force:true});},'Sessione eliminata.');
  }
}
// Read-only QA hooks allow the packaged WebView smoke test to inspect the live IPC result.
window.__CPU_RUSTT_QA__ = {getState:()=>structuredClone(live),getView:()=>structuredClone(view()),navigate:target=>navigate(target,false),poll};
navigate(location.hash.slice(1)||'overview',false);
await poll();
setInterval(poll,1000);
