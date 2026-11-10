//! Telemetry, SQLite and opt-in workloads run outside the WebView/UI thread.
use anyhow::{Context, Result, anyhow, bail};
use rust_cpu::{
    analysis::AnalysisReport,
    bench::{self, CpuBenchmark},
    collector::{self, Collector},
    llm::{self, Endpoints},
    model::{BenchmarkResult, Inventory, LlmState, Snapshot},
    settings::{AlertEngine, AlertEvent, Preferences},
    storage::{SavedBenchmark, Store},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
pub struct View {
    pub inventory: Inventory,
    pub snapshot: Option<Snapshot>,
    pub history: VecDeque<Snapshot>,
    pub preferences: Preferences,
    pub active_session: Option<i64>,
    pub alerts: Vec<AlertEvent>,
    pub llm: LlmState,
    pub benchmarks: Vec<SavedBenchmark>,
    pub benchmark_running: bool,
    pub benchmark_error: Option<String>,
    pub ready: bool,
    pub error: Option<String>,
    pub database_path: String,
    pub export_dir: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct SnapshotContext {
    pub inventory: Inventory,
    pub snapshot: Snapshot,
    pub llm: LlmState,
    pub cpu_benchmark: Option<CpuBenchmark>,
}

pub enum Operation {
    Sessions,
    Start(String),
    Stop,
    Load(i64),
    Compare(i64, i64),
    Rename(i64, String),
    Delete(i64),
    Preferences(Box<Preferences>),
    ExportSnapshot(Option<Box<SnapshotContext>>),
    ExportSession(i64),
    Import(PathBuf),
    Backup,
    Probe,
    Cpu(u32),
    Llm(String, String, u32),
    Cancel,
    Analyze(Option<i64>, Option<u64>),
    Diagnostics(Option<i64>, Option<u64>),
    ExportAnalysis(Option<i64>, Option<u64>, Option<Box<AnalysisReport>>),
}
struct Request {
    operation: Operation,
    reply: SyncSender<std::result::Result<Value, String>>,
    deadline: Instant,
    abandoned: Arc<AtomicBool>,
}
enum Job {
    Cpu(CpuBenchmark, Option<i64>),
    Llm(BenchmarkResult, Option<i64>),
    Done(std::result::Result<(), String>),
    Probe {
        generation: u64,
        result: std::result::Result<LlmState, String>,
    },
}
struct Inner {
    requests: SyncSender<Request>,
    view: Arc<RwLock<View>>,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
    sampler: Mutex<Option<JoinHandle<()>>>,
}
impl Drop for Inner {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        self.stop.store(true, Ordering::Relaxed);
        if let Ok(handle) = self.worker.get_mut()
            && let Some(handle) = handle.take()
        {
            let _ = handle.join();
        }
        if let Ok(handle) = self.sampler.get_mut()
            && let Some(handle) = handle.take()
        {
            let _ = handle.join();
        }
    }
}
#[derive(Clone)]
pub struct Engine(Arc<Inner>);

impl Engine {
    pub fn start(database: PathBuf, export_dir: PathBuf) -> Result<Self> {
        let store = Store::open(&database)?;
        let mut preferences = store.preferences()?;
        // A database edited by another client cannot authorize remote requests.
        validate_preferences(&mut preferences)?;
        store.interrupt_open_sessions()?;
        let interval = Arc::new(AtomicU64::new(preferences.interval_ms));
        let view = Arc::new(RwLock::new(View {
            inventory: Inventory::default(),
            snapshot: None,
            history: VecDeque::new(),
            preferences,
            active_session: None,
            alerts: store.alerts(None, 100)?,
            llm: LlmState::default(),
            benchmarks: store.benchmarks(None, 100)?,
            benchmark_running: false,
            benchmark_error: None,
            ready: false,
            error: None,
            database_path: database.display().to_string(),
            export_dir: export_dir.display().to_string(),
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let cancel = Arc::new(AtomicBool::new(false));
        let (sample_tx, samples) = mpsc::sync_channel(16);
        let overflow = Arc::new(AtomicBool::new(false));
        let sampler_overflow = Arc::clone(&overflow);
        let sampler_stop = Arc::clone(&stop);
        let sampler_interval = Arc::clone(&interval);
        let sampler = thread::Builder::new()
            .name("cpu-rustt-telemetry".into())
            .spawn(move || {
                let mut collector = Collector::new();
                let inventory = collector::inventory();
                // Never expose the initial differential CPU counters as a real zero.
                let mut next = Instant::now()
                    + Duration::from_millis(sampler_interval.load(Ordering::Relaxed));
                while !sampler_stop.load(Ordering::Relaxed) {
                    if Instant::now() >= next {
                        let sample = collector.sample();
                        match sample_tx.try_send((inventory.clone(), sample)) {
                            Ok(()) => {}
                            Err(mpsc::TrySendError::Full(_)) => {
                                sampler_overflow.store(true, Ordering::Relaxed);
                            }
                            Err(mpsc::TrySendError::Disconnected(_)) => break,
                        }
                        next = Instant::now()
                            + Duration::from_millis(sampler_interval.load(Ordering::Relaxed));
                    }
                    thread::sleep(Duration::from_millis(40));
                }
            })?;
        let (requests, receiver) = mpsc::sync_channel(32);
        let worker_view = Arc::clone(&view);
        let worker_stop = Arc::clone(&stop);
        let worker_cancel = Arc::clone(&cancel);
        let worker = thread::Builder::new()
            .name("cpu-rustt-archive".into())
            .spawn(move || {
                Worker {
                    store,
                    view: worker_view,
                    stop: worker_stop,
                    cancel: worker_cancel,
                    interval,
                    export_dir,
                    active: None,
                    alert_engine: AlertEngine::default(),
                    probing: false,
                    probe_again: false,
                    benchmark_worker: None,
                    probe_generation: 0,
                    last_probe: Instant::now(),
                }
                .run(receiver, samples, overflow);
            })
            .inspect_err(|_| {
                stop.store(true, Ordering::Relaxed);
            })?;
        Ok(Self(Arc::new(Inner {
            requests,
            view,
            stop,
            cancel,
            worker: Mutex::new(Some(worker)),
            sampler: Mutex::new(Some(sampler)),
        })))
    }
    pub fn view(&self) -> Result<View> {
        self.0
            .view
            .read()
            .map(|v| v.clone())
            .map_err(|_| anyhow!("Stato monitor non disponibile"))
    }
    pub fn call(&self, operation: Operation) -> Result<Value> {
        if self.0.stop.load(Ordering::Relaxed) {
            bail!("Il monitor è in arresto: nessun nuovo comando è stato accettato");
        }
        if matches!(operation, Operation::Cancel) {
            self.0.cancel.store(true, Ordering::Relaxed);
            return Ok(Value::Null);
        }
        let (reply, receiver) = mpsc::sync_channel(1);
        let deadline = Instant::now() + Duration::from_secs(120);
        let abandoned = Arc::new(AtomicBool::new(false));
        self.0
            .requests
            .try_send(Request {
                operation,
                reply,
                deadline,
                abandoned: Arc::clone(&abandoned),
            })
            .map_err(|_| anyhow!("Archivio occupato o chiuso: riprovare tra un momento"))?;
        match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(result) => result.map_err(|e| anyhow!(e)),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                bail!("Il worker archivio si è arrestato prima di confermare il comando")
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                abandoned.store(true, Ordering::Relaxed);
                bail!(
                    "Esito non confermato entro 120 secondi: i comandi ancora in coda non verranno eseguiti; un'operazione già iniziata può essersi completata. Controllare l'archivio prima di ripetere."
                )
            }
        }
    }
    pub fn shutdown(&self) {
        self.0.cancel.store(true, Ordering::Relaxed);
        self.0.stop.store(true, Ordering::Relaxed);
        if let Ok(mut handle) = self.0.worker.lock()
            && let Some(handle) = handle.take()
        {
            let _ = handle.join();
        }
        if let Ok(mut handle) = self.0.sampler.lock()
            && let Some(handle) = handle.take()
        {
            let _ = handle.join();
        }
    }
}

fn validate_preferences(p: &mut Preferences) -> Result<()> {
    p.validate();
    for endpoint in [&p.ollama_url, &p.lm_studio_url, &p.llama_cpp_url] {
        llm::validate_endpoint(endpoint)?;
    }
    Ok(())
}
fn endpoints(p: &Preferences) -> Endpoints {
    Endpoints {
        ollama: p.ollama_url.clone(),
        lm_studio: p.lm_studio_url.clone(),
        llama_cpp: p.llama_cpp_url.clone(),
    }
}
fn json(value: impl Serialize) -> Result<Value> {
    Ok(serde_json::to_value(value)?)
}

fn validate_benchmark(value: &BenchmarkResult) -> Result<()> {
    if !value.wall_seconds.is_finite()
        || value.wall_seconds < 0.0
        || [
            value.generation_tokens_per_sec,
            value.prompt_tokens_per_sec,
            value.time_to_first_token_ms,
            value.load_ms,
        ]
        .into_iter()
        .flatten()
        .any(|v| !v.is_finite())
    {
        bail!("Report benchmark con valori numerici non validi");
    }
    Ok(())
}

fn validate_snapshot_context(context: &SnapshotContext) -> Result<()> {
    let sample = &context.snapshot;
    if sample.per_core.len() > 4096
        || sample.processes.len() > 20000
        || sample.disks.len() > 2048
        || sample.networks.len() > 2048
        || sample.gpus.len() > 64
        || sample.sensors.len() > 4096
        || sample.sensor_details.len() > 4096
        || sample.warnings.len() > 4096
        || context.llm.runtimes.len() > 16
        || context.llm.observations.len() > 1000
        || context.llm.runtimes.iter().any(|r| r.models.len() > 1024)
        || context.inventory.warnings.len() > 4096
        || [
            &context.inventory.cpu,
            &context.inventory.board,
            &context.inventory.memory,
            &context.inventory.graphics,
        ]
        .into_iter()
        .any(|rows| rows.len() > 4096)
    {
        bail!("Contesto snapshot oltre i limiti di dimensione");
    }
    if !sample.elapsed_secs.is_finite()
        || !sample.cpu_percent.is_finite()
        || sample.per_core.iter().any(|v| !v.is_finite())
        || sample.processes.iter().any(|p| {
            !p.cpu_percent.is_finite()
                || !p.read_bytes_per_sec.is_finite()
                || !p.write_bytes_per_sec.is_finite()
                || p.gpu_percent.is_some_and(|v| !v.is_finite())
        })
        || sample
            .disks
            .iter()
            .any(|d| !d.read_bytes_per_sec.is_finite() || !d.write_bytes_per_sec.is_finite())
        || sample
            .networks
            .iter()
            .any(|n| !n.received_per_sec.is_finite() || !n.transmitted_per_sec.is_finite())
        || sample.sensors.iter().any(|s| !s.temperature.is_finite())
        || sample.gpus.iter().any(|g| {
            [g.utilization, g.temperature, g.power_watts]
                .into_iter()
                .flatten()
                .any(|v| !v.is_finite())
        })
    {
        bail!("Contesto snapshot con valori numerici non finiti");
    }
    if let Some(cpu) = &context.cpu_benchmark
        && [
            cpu.single_ops_per_sec,
            cpu.multi_ops_per_sec,
            cpu.duration_secs,
        ]
        .iter()
        .any(|v| !v.is_finite())
    {
        bail!("Benchmark CPU con valori numerici non finiti");
    }
    for benchmark in context
        .llm
        .benchmark
        .iter()
        .chain(context.llm.observations.iter())
    {
        validate_benchmark(benchmark)?;
    }
    if serde_json::to_vec(context)?.len() > 16 * 1024 * 1024 {
        bail!("Snapshot oltre il limite di 16 MiB");
    }
    Ok(())
}

fn validate_analysis_report(report: &AnalysisReport) -> Result<()> {
    if report.samples > 100000
        || report.metrics.len() > 8192
        || report.warnings.len() > 4096
        || !report.duration_secs.is_finite()
        || report.duration_secs < 0.0
    {
        bail!("Rapporto di analisi oltre i limiti o con durata non valida");
    }
    for metric in &report.metrics {
        let stats = &metric.statistics;
        if metric.points.len() > 1000
            || metric.points.len() > report.samples
            || stats.count.checked_add(stats.missing) != Some(report.samples)
            || [
                stats.min,
                stats.max,
                stats.mean,
                stats.median,
                stats.p95,
                stats.std_dev,
                stats.delta,
            ]
            .into_iter()
            .flatten()
            .any(|v| !v.is_finite())
            || stats.std_dev.is_some_and(|v| v < 0.0)
            || stats.min.zip(stats.max).is_some_and(|(min, max)| min > max)
            || metric
                .points
                .iter()
                .any(|p| !p.elapsed_secs.is_finite() || p.value.is_some_and(|v| !v.is_finite()))
        {
            bail!("Rapporto di analisi con conteggi, statistiche o punti incoerenti");
        }
    }
    if serde_json::to_vec(report)?.len() > 32 * 1024 * 1024 {
        bail!("Rapporto di analisi oltre il limite di 32 MiB");
    }
    Ok(())
}

struct Worker {
    store: Store,
    view: Arc<RwLock<View>>,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    interval: Arc<AtomicU64>,
    export_dir: PathBuf,
    active: Option<i64>,
    alert_engine: AlertEngine,
    probing: bool,
    probe_again: bool,
    benchmark_worker: Option<JoinHandle<()>>,
    probe_generation: u64,
    last_probe: Instant,
}
impl Worker {
    fn read(&self) -> Result<View> {
        self.view
            .read()
            .map(|v| v.clone())
            .map_err(|_| anyhow!("Stato monitor non disponibile"))
    }
    fn update(&self, apply: impl FnOnce(&mut View)) {
        if let Ok(mut view) = self.view.write() {
            apply(&mut view);
        }
    }
    fn run(
        mut self,
        requests: Receiver<Request>,
        samples: Receiver<(Inventory, Snapshot)>,
        overflow: Arc<AtomicBool>,
    ) {
        let (jobs_tx, jobs_rx) = mpsc::channel();
        // Discovery reads local APIs only; synthetic inference is always opt-in.
        self.probe(&jobs_tx);
        while !self.stop.load(Ordering::Relaxed) {
            self.handle_overflow(&overflow);
            while let Ok((inventory, sample)) = samples.try_recv() {
                self.ingest(inventory, sample);
            }
            while let Ok(job) = jobs_rx.try_recv() {
                self.job(job);
            }
            if !self.probing
                && (self.probe_again || self.last_probe.elapsed() >= Duration::from_secs(5))
            {
                self.probe_again = false;
                self.probe(&jobs_tx);
            }
            match requests.recv_timeout(Duration::from_millis(40)) {
                Ok(request) => {
                    if !self.handle_request(request, &jobs_tx) {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
        self.cancel.store(true, Ordering::Relaxed);
        if let Some(handle) = self.benchmark_worker.take() {
            let _ = handle.join();
        }
        // The sampler can still be returning from an in-flight provider call.
        // Wait for its sender to close before finalizing the recording.
        if let Err(error) = self.drain_samples(&samples, Duration::from_secs(5)) {
            if let Some(id) = self.active.take() {
                let _ = self.store.interrupt_session(id);
            }
            self.update(|v| v.error = Some(error));
        }
        // The last provider call can overflow the queue after the loop's last
        // check. The sender is now closed: all losses must be acknowledged before
        // the recording is allowed to become complete.
        self.handle_overflow(&overflow);
        while let Ok(job) = jobs_rx.try_recv() {
            self.job(job);
        }
        if let Some(id) = self.active.take() {
            let result = self.store.finish_session(id);
            if let Err(error) = result {
                let interrupted = self.store.interrupt_session(id);
                let message = format!(
                    "Chiusura sessione {id} non confermata: {error}; stato incompleto: {interrupted:?}"
                );
                eprintln!("{message}");
                self.update(|v| v.error = Some(message));
            }
        }
        self.update(|v| v.active_session = None);
    }
    fn handle_overflow(&mut self, overflow: &AtomicBool) {
        if !overflow.swap(false, Ordering::Relaxed) {
            return;
        }
        let interrupted = self
            .active
            .take()
            .map(|id| self.store.interrupt_session(id));
        self.update(|v| {
            v.active_session = None;
            let mut message = "Archivio occupato oltre la capacità della coda: campioni mancanti; registrazione interrotta e marcata incompleta.".to_owned();
            if let Some(Err(error)) = interrupted {
                message.push_str(&format!(" Aggiornamento stato non riuscito: {error}"));
            }
            if let Some(previous) = v.error.take() {
                message.push_str(&format!(" {previous}"));
            }
            v.error = Some(message);
        });
    }
    fn drain_samples(
        &mut self,
        samples: &Receiver<(Inventory, Snapshot)>,
        limit: Duration,
    ) -> std::result::Result<(), String> {
        let deadline = Instant::now() + limit;
        loop {
            match samples.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok((inventory, sample)) => self.ingest(inventory, sample),
                Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
                Err(mpsc::RecvTimeoutError::Timeout) => return Err("Arresto del collector non confermato entro il limite: registrazione conservata come incompleta".into()),
            }
        }
    }
    fn handle_request(&mut self, request: Request, jobs: &mpsc::Sender<Job>) -> bool {
        if request.abandoned.load(Ordering::Relaxed) || Instant::now() >= request.deadline {
            let _ = request.reply.try_send(Err(
                "Comando scaduto prima dell'esecuzione: nessuna operazione avviata".into(),
            ));
            return true;
        }
        if self.stop.load(Ordering::Relaxed) {
            let _ = request
                .reply
                .try_send(Err("Monitor in arresto: comando non eseguito".into()));
            return false;
        }
        let result = self
            .handle(request.operation, jobs)
            .map_err(|e| format!("{e:#}"));
        let _ = request.reply.try_send(result);
        true
    }
    fn ingest(&mut self, inventory: Inventory, snapshot: Snapshot) {
        if let Some(id) = self.active
            && let Err(error) = self.store.append_sample(id, &snapshot)
        {
            let _ = self.store.interrupt_session(id);
            self.active = None;
            self.update(|v| {
                v.active_session = None;
                v.error = Some(format!("Registrazione interrotta: {error}"));
            });
        }
        let thresholds = self
            .read()
            .map(|v| v.preferences.alerts)
            .unwrap_or_default();
        let alerts = self.alert_engine.evaluate(&snapshot, &thresholds);
        for alert in &alerts {
            if let Err(error) = self.store.save_alert(self.active, alert) {
                self.update(|v| v.error = Some(format!("Salvataggio avviso: {error}")));
            }
        }
        let mut compact = snapshot.clone();
        compact.processes.clear();
        compact.sensor_details.clear();
        compact.warnings.clear();
        self.update(|v| {
            v.inventory = inventory;
            v.snapshot = Some(snapshot);
            v.history.push_back(compact);
            while v.history.len() > 180 {
                v.history.pop_front();
            }
            for alert in alerts {
                v.alerts.insert(0, alert);
            }
            v.alerts.truncate(100);
            v.ready = true;
        });
    }
    fn probe(&mut self, tx: &mpsc::Sender<Job>) {
        self.probe_generation = self.probe_generation.wrapping_add(1);
        if self.probing {
            self.probe_again = true;
            return;
        }
        let Ok(view) = self.read() else {
            return;
        };
        let endpoints = endpoints(&view.preferences);
        let generation = self.probe_generation;
        self.probing = true;
        self.last_probe = Instant::now();
        let tx = tx.clone();
        if let Err(error) = thread::Builder::new()
            .name("cpu-rustt-discovery".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(|| llm::probe_all(&endpoints))
                    .map_err(|_| "Il worker di scoperta runtime si è interrotto".to_owned());
                let _ = tx.send(Job::Probe { generation, result });
            })
        {
            self.probing = false;
            self.update(|v| v.error = Some(format!("Avvio scoperta runtime: {error}")));
        }
    }
    fn job(&mut self, job: Job) {
        let result = match job {
            Job::Cpu(result, session) => {
                let session =
                    session.filter(|id| self.store.session_state(*id).is_ok_and(|s| s == "open"));
                self.store.save_cpu(session, &result).map(|_| ())
            }
            Job::Llm(result, session) => {
                self.update(|v| v.llm.benchmark = Some(result.clone()));
                let session =
                    session.filter(|id| self.store.session_state(*id).is_ok_and(|s| s == "open"));
                self.store.save_llm(session, &result, false).map(|_| ())
            }
            Job::Done(result) => {
                if let Some(handle) = self.benchmark_worker.take() {
                    let _ = handle.join();
                }
                self.update(|v| {
                    v.benchmark_running = false;
                    v.benchmark_error = result.err();
                });
                Ok(())
            }
            Job::Probe { generation, result } => {
                self.probing = false;
                if generation == self.probe_generation {
                    match result {
                        Ok(mut result) => self.update(|v| {
                            result.benchmark = v.llm.benchmark.clone();
                            result.observations = v.llm.observations.clone();
                            v.llm = result;
                        }),
                        Err(error) => self.update(|v| v.error = Some(error)),
                    }
                }
                Ok(())
            }
        };
        if let Err(error) = result {
            self.update(|v| v.error = Some(format!("Salvataggio benchmark: {error}")));
        }
        match self.store.benchmarks(None, 100) {
            Ok(rows) => self.update(|v| v.benchmarks = rows),
            Err(error) => self.update(|v| v.error = Some(format!("Lettura benchmark: {error}"))),
        }
    }
    fn handle(&mut self, op: Operation, tx: &mpsc::Sender<Job>) -> Result<Value> {
        match op {
            Operation::Analyze(session, window) => json(self.analyze(session, window)?),
            Operation::ExportAnalysis(session, window, report) => {
                use std::io::Write;
                let report = match report {
                    Some(report) => {
                        validate_analysis_report(&report)?;
                        *report
                    }
                    None => self.analyze(session, window)?,
                };
                std::fs::create_dir_all(&self.export_dir)?;
                let path = rust_cpu::export::unique_path(&self.export_dir, "analisi", "json");
                let bytes = serde_json::to_vec_pretty(&report)?;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)?;
                if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
                    drop(file);
                    let _ = std::fs::remove_file(&path);
                    return Err(error.into());
                }
                json(path.display().to_string())
            }
            Operation::Diagnostics(session, window) => {
                let report = self.analyze(session, window)?;
                let view = self.read()?;
                let sample = if let Some(id) = session {
                    self.store.load_session(id, 2)?.samples.pop()
                } else {
                    view.snapshot
                };
                json(crate::diagnostics::analyze(
                    &report,
                    sample.as_ref(),
                    &view.preferences,
                    if session.is_none() {
                        view.error.as_deref()
                    } else {
                        None
                    },
                    session.is_none(),
                ))
            }
            Operation::Sessions => json(self.store.list_sessions(1000)?),
            Operation::Start(name) => {
                if self.active.is_some() {
                    bail!("Una registrazione è già attiva");
                }
                let view = self.read()?;
                let sample = view
                    .snapshot
                    .context("Attendere il primo campione hardware")?;
                let id = self.store.begin_session_with_sample(
                    &name,
                    &view.inventory,
                    view.preferences.interval_ms,
                    &sample,
                )?;
                self.active = Some(id);
                self.update(|v| {
                    v.active_session = Some(id);
                    v.error = None;
                });
                json(id)
            }
            Operation::Stop => {
                let id = self.active.context("Nessuna registrazione attiva")?;
                self.store.finish_session(id)?;
                self.active = None;
                self.update(|v| v.active_session = None);
                Ok(Value::Null)
            }
            Operation::Load(id) => json(self.store.load_session(id, 300)?),
            Operation::Compare(left, right) => {
                if left == right {
                    bail!("Scegliere due sessioni differenti");
                }
                json(self.store.compare(left, right)?)
            }
            Operation::Rename(id, name) => {
                self.store.rename_session(id, &name)?;
                Ok(Value::Null)
            }
            Operation::Delete(id) => {
                if self.active == Some(id) {
                    bail!("Arrestare la registrazione prima di eliminare la sessione");
                }
                self.store.delete_session(id)?;
                Ok(Value::Null)
            }
            Operation::Preferences(mut p) => {
                validate_preferences(&mut p)?;
                self.store.save_preferences(&p)?;
                self.interval.store(p.interval_ms, Ordering::Relaxed);
                self.update(|v| {
                    if v.preferences.ollama_url != p.ollama_url
                        || v.preferences.lm_studio_url != p.lm_studio_url
                        || v.preferences.llama_cpp_url != p.llama_cpp_url
                    {
                        v.llm.runtimes.clear();
                        v.llm.last_probe_unix = 0;
                    }
                    v.preferences = (*p).clone();
                });
                self.probe(tx);
                json(*p)
            }
            Operation::ExportSnapshot(context) => {
                let context = match context {
                    Some(context) => *context,
                    None => {
                        let view = self.read()?;
                        SnapshotContext {
                            inventory: view.inventory,
                            snapshot: view.snapshot.context("Nessun campione da esportare")?,
                            llm: view.llm,
                            cpu_benchmark: view.benchmarks.iter().find_map(|b| b.cpu.clone()),
                        }
                    }
                };
                validate_snapshot_context(&context)?;
                let path = rust_cpu::export::unique_path(&self.export_dir, "hardware", "json");
                rust_cpu::export::export_snapshot_with_bench(
                    &path,
                    &context.inventory,
                    &context.snapshot,
                    &context.llm,
                    context.cpu_benchmark.as_ref(),
                )?;
                json(path.display().to_string())
            }
            Operation::ExportSession(id) => {
                let path = rust_cpu::export::unique_path(
                    &self.export_dir,
                    &format!("sessione-{id}"),
                    "json",
                );
                self.store.export_session(id, &path)?;
                json(path.display().to_string())
            }
            Operation::Import(path) => json(self.store.import_session(&path)?),
            Operation::Backup => {
                std::fs::create_dir_all(&self.export_dir)?;
                let path = rust_cpu::export::unique_path(&self.export_dir, "archivio", "sqlite3");
                self.store.backup(&path)?;
                json(path.display().to_string())
            }
            Operation::Probe => {
                self.probe(tx);
                Ok(Value::Null)
            }
            Operation::Cancel => {
                self.cancel.store(true, Ordering::Relaxed);
                Ok(Value::Null)
            }
            Operation::Cpu(repeats) => self.benchmark(None, repeats, tx),
            Operation::Llm(runtime, model, repeats) => {
                self.benchmark(Some((runtime, model)), repeats, tx)
            }
        }
    }
    fn analyze(
        &self,
        session: Option<i64>,
        window: Option<u64>,
    ) -> Result<rust_cpu::analysis::AnalysisReport> {
        if window.is_some_and(|seconds| seconds == 0 || seconds > 31_536_000) {
            bail!("Finestra di analisi non valida");
        }
        if let Some(id) = session {
            return self.store.analysis_session(id, window);
        }
        let view = self.read()?;
        let mut samples: Vec<_> = view.history.into_iter().collect();
        if let (Some(seconds), Some(last)) = (window, samples.last()) {
            let earliest = last.elapsed_secs - seconds as f64;
            samples.retain(|sample| sample.elapsed_secs >= earliest);
        }
        Ok(rust_cpu::analysis::analyze_snapshots(
            &samples,
            "Finestra live (massimo 180 campioni)",
        ))
    }
    fn benchmark(
        &mut self,
        llm_request: Option<(String, String)>,
        repeats: u32,
        tx: &mpsc::Sender<Job>,
    ) -> Result<Value> {
        let view = self.read()?;
        if view.benchmark_running {
            bail!("Un benchmark è già in esecuzione");
        }
        if !(1..=10).contains(&repeats) {
            bail!("Scegliere da 1 a 10 ripetizioni");
        }
        let request = if let Some((runtime, model)) = llm_request {
            let endpoint = match runtime
                .to_ascii_lowercase()
                .replace([' ', '-', '_', '.'], "")
                .as_str()
            {
                "ollama" => view.preferences.ollama_url,
                "lmstudio" => view.preferences.lm_studio_url,
                "llamacpp" => view.preferences.llama_cpp_url,
                _ => bail!("Runtime non supportato"),
            };
            llm::validate_endpoint(&endpoint)?;
            if model.is_empty() || model.len() > 512 || model.chars().any(char::is_control) {
                bail!("Modello non valido");
            }
            Some((runtime, endpoint, model))
        } else {
            None
        };
        self.cancel.store(false, Ordering::Relaxed);
        self.update(|v| {
            v.benchmark_running = true;
            v.benchmark_error = None;
        });
        let cancel = Arc::clone(&self.cancel);
        let session = self.active;
        let tx = tx.clone();
        let handle = thread::Builder::new()
            .name("cpu-rustt-benchmark".into())
            .spawn(move || {
                let outcome = std::panic::catch_unwind(|| -> Result<()> {
                    for _ in 0..repeats {
                        if cancel.load(Ordering::Relaxed) {
                            bail!("Benchmark annullato");
                        }
                        let job = match &request {
                            Some((runtime, endpoint, model)) => Job::Llm(
                                llm::benchmark(runtime, endpoint, model, 64, Arc::clone(&cancel))?,
                                session,
                            ),
                            None => Job::Cpu(bench::run(Arc::clone(&cancel))?, session),
                        };
                        if tx.send(job).is_err() {
                            bail!("Archivio chiuso");
                        }
                    }
                    Ok(())
                })
                .unwrap_or_else(|_| Err(anyhow!("Il worker benchmark si è interrotto")));
                let _ = tx.send(Job::Done(outcome.map_err(|e| format!("{e:#}"))));
            });
        match handle {
            Ok(handle) => self.benchmark_worker = Some(handle),
            Err(error) => {
                self.update(|v| v.benchmark_running = false);
                return Err(error.into());
            }
        }
        Ok(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(cpu: f32, elapsed: f64) -> Snapshot {
        Snapshot {
            cpu_percent: cpu,
            per_core: vec![cpu],
            timestamp_unix: 100 + elapsed as u64,
            elapsed_secs: elapsed,
            memory_used: 100,
            memory_total: 1000,
            ..Default::default()
        }
    }
    fn worker_fixture(directory: &std::path::Path) -> Result<Worker> {
        let snapshot = sample(80.0, 1.0);
        let mut preferences = Preferences::default();
        preferences.alerts.enabled = false;
        let store = Store::open(&directory.join("fixture.sqlite3"))?;
        let view = View {
            inventory: Inventory {
                logical_cores: 1,
                ..Default::default()
            },
            snapshot: Some(snapshot.clone()),
            history: VecDeque::from([snapshot]),
            preferences,
            active_session: None,
            alerts: Vec::new(),
            llm: LlmState::default(),
            benchmarks: Vec::new(),
            benchmark_running: false,
            benchmark_error: None,
            ready: true,
            error: None,
            database_path: store.path.display().to_string(),
            export_dir: directory.join("exports").display().to_string(),
        };
        Ok(Worker {
            store,
            view: Arc::new(RwLock::new(view)),
            stop: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
            interval: Arc::new(AtomicU64::new(1000)),
            export_dir: directory.join("exports"),
            active: None,
            alert_engine: AlertEngine::default(),
            probing: false,
            probe_again: false,
            benchmark_worker: None,
            probe_generation: 0,
            last_probe: Instant::now(),
        })
    }
    #[test]
    fn endpoints_are_checked_before_preferences_can_reach_the_store() {
        let mut p = Preferences {
            ollama_url: "http://example.com:11434".into(),
            ..Default::default()
        };
        assert!(validate_preferences(&mut p).is_err());
        p.ollama_url = "http://127.0.0.1:11434".into();
        p.interval_ms = 0;
        assert!(validate_preferences(&mut p).is_ok());
        assert_eq!(p.interval_ms, 500);
    }
    #[test]
    fn native_archive_actions_are_serialized_and_persist_preferences() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let engine = Engine::start(
            dir.path().join("workspace.sqlite3"),
            dir.path().join("exports"),
        )?;
        assert_eq!(engine.call(Operation::Sessions)?, serde_json::json!([]));
        assert!(engine.call(Operation::Start("".into())).is_err());
        assert!(engine.call(Operation::Stop).is_err());
        assert!(engine.call(Operation::Compare(1, 1)).is_err());
        assert!(engine.call(Operation::Cpu(0)).is_err());
        let p = Preferences {
            interval_ms: 2500,
            theme_light: true,
            ..Default::default()
        };
        engine.call(Operation::Preferences(Box::new(p)))?;
        let path = engine.call(Operation::Backup)?.as_str().unwrap().to_owned();
        assert!(std::path::Path::new(&path).is_file());
        engine.shutdown();
        assert!(engine.call(Operation::Sessions).is_err());
        assert!(engine.call(Operation::Cancel).is_err());
        let store = Store::open(&dir.path().join("workspace.sqlite3"))?;
        assert_eq!(store.preferences()?.interval_ms, 2500);
        assert!(store.preferences()?.theme_light);
        assert_eq!(store.quick_check()?, "ok");
        Ok(())
    }
    #[test]
    fn expired_and_abandoned_requests_cannot_start_recordings_later() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let mut worker = worker_fixture(directory.path())?;
        let (jobs, _) = mpsc::channel();
        for (deadline, abandoned) in [
            (Instant::now() - Duration::from_secs(1), false),
            (Instant::now() + Duration::from_secs(1), true),
        ] {
            let (reply, response) = mpsc::sync_channel(1);
            worker.handle_request(
                Request {
                    operation: Operation::Start("Must not start".into()),
                    reply,
                    deadline,
                    abandoned: Arc::new(AtomicBool::new(abandoned)),
                },
                &jobs,
            );
            assert!(response.recv()?.is_err());
            assert!(worker.active.is_none());
            assert!(worker.store.list_sessions(10)?.is_empty());
        }
        let (reply, response) = mpsc::sync_channel(1);
        worker.handle_request(
            Request {
                operation: Operation::Start("Confirmed".into()),
                reply,
                deadline: Instant::now() + Duration::from_secs(1),
                abandoned: Arc::new(AtomicBool::new(false)),
            },
            &jobs,
        );
        assert!(response.recv()?.is_ok());
        assert_eq!(worker.store.list_sessions(10)?.len(), 1);
        worker.handle(Operation::Stop, &jobs)?;
        Ok(())
    }
    #[test]
    fn stale_probe_is_discarded_and_failed_probe_preserves_known_runtime_state() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let mut worker = worker_fixture(directory.path())?;
        worker.probing = true;
        worker.probe_generation = 1;
        let (jobs, _) = mpsc::channel();
        worker.probe(&jobs); // A newer endpoint/refresh invalidates the in-flight result.
        let runtime = rust_cpu::model::RuntimeStatus {
            name: "Old endpoint".into(),
            ..Default::default()
        };
        worker.job(Job::Probe {
            generation: 1,
            result: Ok(LlmState {
                runtimes: vec![runtime],
                ..Default::default()
            }),
        });
        assert!(worker.read()?.llm.runtimes.is_empty());
        assert!(worker.probe_again);
        worker.job(Job::Probe {
            generation: 2,
            result: Ok(LlmState {
                runtimes: vec![rust_cpu::model::RuntimeStatus {
                    name: "Current endpoint".into(),
                    ..Default::default()
                }],
                ..Default::default()
            }),
        });
        assert_eq!(worker.read()?.llm.runtimes[0].name, "Current endpoint");
        worker.job(Job::Probe {
            generation: 2,
            result: Err("Probe failed".into()),
        });
        assert_eq!(worker.read()?.llm.runtimes[0].name, "Current endpoint");
        assert_eq!(worker.read()?.error.as_deref(), Some("Probe failed"));
        Ok(())
    }
    #[test]
    fn frozen_snapshot_and_analysis_exports_preserve_visible_values() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let mut worker = worker_fixture(directory.path())?;
        let (jobs, _) = mpsc::channel();
        let visible = sample(10.0, 0.0);
        let context = SnapshotContext {
            inventory: worker.read()?.inventory,
            snapshot: visible.clone(),
            llm: LlmState::default(),
            cpu_benchmark: None,
        };
        let path = worker.handle(Operation::ExportSnapshot(Some(Box::new(context))), &jobs)?;
        let exported: Value = serde_json::from_slice(&std::fs::read(path.as_str().unwrap())?)?;
        assert_eq!(exported["snapshot"]["cpu_percent"], 10.0);
        assert_eq!(worker.read()?.snapshot.unwrap().cpu_percent, 80.0);
        let report = rust_cpu::analysis::analyze_snapshots(&[visible], "Frozen displayed report");
        let expected = serde_json::to_value(&report)?;
        let path = worker.handle(
            Operation::ExportAnalysis(None, None, Some(Box::new(report))),
            &jobs,
        )?;
        let exported: Value = serde_json::from_slice(&std::fs::read(path.as_str().unwrap())?)?;
        assert_eq!(exported, expected);
        Ok(())
    }
    #[test]
    fn invalid_frozen_payloads_are_rejected_before_creating_files() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let mut worker = worker_fixture(directory.path())?;
        let (jobs, _) = mpsc::channel();
        let context = SnapshotContext {
            inventory: worker.read()?.inventory,
            snapshot: sample(f32::NAN, 0.0),
            llm: LlmState::default(),
            cpu_benchmark: None,
        };
        assert!(
            worker
                .handle(Operation::ExportSnapshot(Some(Box::new(context))), &jobs)
                .is_err()
        );
        let mut report =
            rust_cpu::analysis::analyze_snapshots(&[sample(10.0, 0.0)], "Invalid counts");
        report.metrics[0].statistics.count = 2;
        assert!(
            worker
                .handle(
                    Operation::ExportAnalysis(None, None, Some(Box::new(report))),
                    &jobs
                )
                .is_err()
        );
        assert!(!directory.path().join("exports").exists());
        Ok(())
    }
    #[test]
    fn final_drain_includes_sampler_result_that_arrives_after_stop_signal() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let mut worker = worker_fixture(directory.path())?;
        let (jobs, _) = mpsc::channel();
        let id = worker
            .handle(Operation::Start("Closing".into()), &jobs)?
            .as_i64()
            .unwrap();
        let (sender, samples) = mpsc::sync_channel(1);
        let sampler = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            sender
                .send((
                    Inventory {
                        logical_cores: 1,
                        ..Default::default()
                    },
                    sample(20.0, 2.0),
                ))
                .unwrap();
        });
        worker.stop.store(true, Ordering::Relaxed);
        worker
            .drain_samples(&samples, Duration::from_secs(1))
            .map_err(|e| anyhow!(e))?;
        sampler.join().unwrap();
        worker.handle(Operation::Stop, &jobs)?;
        assert_eq!(worker.store.load_session(id, 10)?.total_samples, 2);
        let (_sender, samples) = mpsc::sync_channel(1);
        let started = Instant::now();
        assert!(
            worker
                .drain_samples(&samples, Duration::from_millis(20))
                .is_err()
        );
        assert!(started.elapsed() < Duration::from_millis(500));
        Ok(())
    }
    #[test]
    fn shutdown_overflow_preserves_samples_but_never_marks_the_recording_complete() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let mut worker = worker_fixture(directory.path())?;
        let (jobs, _) = mpsc::channel();
        let id = worker
            .handle(
                Operation::Start("Closing with dropped samples".into()),
                &jobs,
            )?
            .as_i64()
            .unwrap();
        let view = Arc::clone(&worker.view);
        let (_requests, requests) = mpsc::sync_channel(1);
        let (sender, samples) = mpsc::sync_channel(1);
        sender.send((Inventory::default(), sample(20.0, 2.0)))?;
        drop(sender);
        worker.stop.store(true, Ordering::Relaxed);
        worker.run(requests, samples, Arc::new(AtomicBool::new(true)));
        let store = Store::open(&directory.path().join("fixture.sqlite3"))?;
        assert_eq!(store.session_state(id)?, "incomplete");
        assert_eq!(store.load_session(id, 10)?.total_samples, 2);
        let view = view.read().unwrap();
        assert!(view.active_session.is_none());
        assert!(
            view.error
                .as_deref()
                .is_some_and(|e| e.contains("campioni mancanti"))
        );
        Ok(())
    }
    #[test]
    #[ignore = "Campionamento hardware reale e microbenchmark esplicito: eseguire separatamente"]
    fn live_recording_roundtrip_and_benchmark_never_move_to_another_session() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let engine = Engine::start(dir.path().join("live.sqlite3"), dir.path().join("exports"))?;
        let deadline = Instant::now() + Duration::from_secs(20);
        while !engine.view()?.ready {
            assert!(
                Instant::now() < deadline,
                "Il collector non ha prodotto un campione"
            );
            thread::sleep(Duration::from_millis(40));
        }
        let sample = engine.view()?.snapshot.unwrap();
        assert!(sample.cpu_percent.is_finite() && (0.0..=100.0).contains(&sample.cpu_percent));
        assert!(sample.memory_total > 0 && sample.memory_used <= sample.memory_total);
        assert_eq!(
            sample.per_core.len(),
            engine.view()?.inventory.logical_cores
        );
        let a = engine
            .call(Operation::Start("Sessione A".into()))?
            .as_i64()
            .unwrap();
        engine.call(Operation::Cpu(1))?;
        engine.call(Operation::Stop)?;
        let b = engine
            .call(Operation::Start("Sessione B".into()))?
            .as_i64()
            .unwrap();
        while engine.view()?.benchmark_running {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(40));
        }
        assert!(engine.view()?.benchmark_error.is_none());
        assert!(!engine.view()?.benchmarks.is_empty());
        assert!(
            engine
                .view()?
                .benchmarks
                .iter()
                .all(|run| run.session_id != Some(b))
        );
        engine.call(Operation::Stop)?;
        let exported = engine
            .call(Operation::ExportSession(a))?
            .as_str()
            .unwrap()
            .to_owned();
        let imported = engine
            .call(Operation::Import(PathBuf::from(exported)))?
            .as_i64()
            .unwrap();
        let comparison = engine.call(Operation::Compare(a, imported))?;
        assert_eq!(
            comparison["left"]["cpu"]["average"],
            comparison["right"]["cpu"]["average"]
        );
        let snapshot = engine
            .call(Operation::ExportSnapshot(None))?
            .as_str()
            .unwrap()
            .to_owned();
        let report: Value = serde_json::from_slice(&std::fs::read(snapshot)?)?;
        assert!(report["cpu_benchmark"].is_object());
        engine.call(Operation::Rename(imported, "Importata".into()))?;
        assert_eq!(
            engine.call(Operation::Load(imported))?["summary"]["name"],
            "Importata"
        );
        engine.call(Operation::Delete(imported))?;
        assert!(engine.call(Operation::Load(imported)).is_err());
        engine.shutdown();
        assert_eq!(
            Store::open(&dir.path().join("live.sqlite3"))?.quick_check()?,
            "ok"
        );
        Ok(())
    }
}
