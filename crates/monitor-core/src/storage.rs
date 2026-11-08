use crate::{
    analysis::{AnalysisReport, analyze_snapshots},
    bench::CpuBenchmark,
    model::{BenchmarkResult, Inventory, Snapshot},
    settings::AlertEvent,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct MetricSummary {
    pub average: Option<f64>,
    pub peak: Option<f64>,
    pub p95: Option<f64>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SessionSummary {
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub interval_ms: u64,
    pub id: i64,
    pub name: String,
    pub started_utc: String,
    pub ended_utc: Option<String>,
    pub state: String,
    pub samples: u64,
    pub duration_secs: f64,
    pub cpu: MetricSummary,
    pub ram: MetricSummary,
    pub gpu: MetricSummary,
    pub vram: MetricSummary,
    pub llm_ram: MetricSummary,
    pub benchmark_count: u64,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SavedBenchmark {
    pub id: i64,
    pub session_id: Option<i64>,
    pub recorded_utc: String,
    pub kind: String,
    pub cpu: Option<CpuBenchmark>,
    pub llm: Option<BenchmarkResult>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SessionData {
    pub summary: SessionSummary,
    pub inventory: Inventory,
    pub samples: Vec<Snapshot>,
    pub total_samples: u64,
    pub benchmarks: Vec<SavedBenchmark>,
    pub alerts: Vec<AlertEvent>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ComparisonMetric {
    pub label: String,
    pub unit: String,
    pub left: Option<f64>,
    pub right: Option<f64>,
    pub delta: Option<f64>,
    pub delta_percent: Option<f64>,
    pub lower_is_better: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct BenchmarkComparison {
    pub label: String,
    pub kind: String,
    pub method: String,
    pub runs_left: usize,
    pub runs_right: usize,
    pub metrics: Vec<ComparisonMetric>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SessionComparison {
    pub left: SessionSummary,
    pub right: SessionSummary,
    pub metrics: Vec<ComparisonMetric>,
    pub warnings: Vec<String>,
    pub left_series: Vec<Snapshot>,
    pub right_series: Vec<Snapshot>,
    pub left_benchmarks: Vec<SavedBenchmark>,
    pub right_benchmarks: Vec<SavedBenchmark>,
    #[serde(default)]
    pub benchmarks: Vec<BenchmarkComparison>,
}

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    fs::{self, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
const APPLICATION_ID: i64 = 0x52544350;
const SCHEMA_VERSION: i64 = 1;
pub struct Store {
    connection: Connection,
    pub path: PathBuf,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent)?;
        }
        let mut connection = Connection::open(path)
            .with_context(|| format!("Apertura archivio SQLite {}", path.display()))?;
        connection.busy_timeout(Duration::from_secs(2))?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |r| r.get(0))?;
        let app_id: i64 = connection.pragma_query_value(None, "application_id", |r| r.get(0))?;
        let tables: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        )?;
        if version > SCHEMA_VERSION {
            bail!("Archivio SQLite di una versione futura ({version}); aggiorna RUST-CPU.");
        }
        if app_id != APPLICATION_ID && (app_id != 0 || tables > 0) {
            bail!("Il file SQLite non è un archivio RUST-CPU. Nessuna tabella modificata.");
        }
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        if version == 0 {
            let tx = connection.transaction()?;
            tx.execute_batch("CREATE TABLE sessions(id INTEGER PRIMARY KEY,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),started_utc TEXT NOT NULL,ended_utc TEXT,state TEXT NOT NULL DEFAULT 'open',interval_ms INTEGER NOT NULL,app_version TEXT NOT NULL,inventory_json TEXT NOT NULL);
                CREATE TABLE samples(id INTEGER PRIMARY KEY,session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,timestamp_unix INTEGER NOT NULL,elapsed_secs REAL NOT NULL,cpu REAL,ram REAL,gpu REAL,vram REAL,llm_ram REAL,disk_read REAL,disk_write REAL,net_rx REAL,net_tx REAL,payload TEXT NOT NULL);
                CREATE INDEX samples_session ON samples(session_id,id);
                CREATE TABLE benchmarks(id INTEGER PRIMARY KEY,session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,recorded_utc TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL);
                CREATE INDEX benchmarks_session ON benchmarks(session_id,id);
                CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE alerts(id INTEGER PRIMARY KEY,session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,payload TEXT NOT NULL);
                CREATE INDEX alerts_session ON alerts(session_id,id);
                PRAGMA application_id=1381253968;
                PRAGMA user_version=1;")?;
            tx.commit()?;
        }
        Ok(Self {
            connection,
            path: path.to_owned(),
        })
    }
    // WAL writers may commit between our queries. A deferred read transaction
    // keeps summaries, preview rows and events on the same database snapshot.
    fn read_snapshot<T>(&self, read: impl FnOnce(&Self) -> Result<T>) -> Result<T> {
        let transaction = self.connection.unchecked_transaction()?;
        let value = read(self)?;
        transaction.commit()?;
        Ok(value)
    }
    pub fn preferences(&self) -> Result<crate::settings::Preferences> {
        let json: Option<String> = self
            .connection
            .query_row("SELECT value FROM preferences WHERE key='ui'", [], |r| {
                r.get(0)
            })
            .optional()?;
        let mut p = match json {
            Some(j) => serde_json::from_str(&j)
                .context("Preferenze danneggiate: archivio conservato, nessun reset automatico")?,
            None => crate::settings::Preferences::default(),
        };
        p.validate();
        Ok(p)
    }
    pub fn save_preferences(&self, p: &crate::settings::Preferences) -> Result<()> {
        let mut p = p.clone();
        p.validate();
        self.connection.execute("INSERT INTO preferences(key,value) VALUES('ui',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&p)?])?;
        Ok(())
    }
    pub fn begin_session(
        &self,
        name: &str,
        inventory: &Inventory,
        interval_ms: u64,
    ) -> Result<i64> {
        validate_name(name)?;
        self.connection.execute("INSERT INTO sessions(name,started_utc,interval_ms,app_version,inventory_json) VALUES(?1,?2,?3,?4,?5)",params![name,chrono::Utc::now().to_rfc3339(),i64::try_from(interval_ms)?,env!("CARGO_PKG_VERSION"),serde_json::to_string(inventory)?])?;
        Ok(self.connection.last_insert_rowid())
    }
    pub fn append_sample(&self, session_id: i64, snapshot: &Snapshot) -> Result<()> {
        let open: bool = self
            .connection
            .query_row(
                "SELECT state='open' FROM sessions WHERE id=?1",
                [session_id],
                |r| r.get(0),
            )
            .context("Sessione non trovata")?;
        if !open {
            bail!("La sessione è già chiusa; i campioni non sono stati aggiunti.");
        }
        insert_sample(&self.connection, session_id, snapshot)
    }
    /// The UI must never receive a failed start after an open session was committed.
    pub fn begin_session_with_sample(
        &mut self,
        name: &str,
        inventory: &Inventory,
        interval_ms: u64,
        first: &Snapshot,
    ) -> Result<i64> {
        validate_name(name)?;
        let tx = self.connection.transaction()?;
        tx.execute("INSERT INTO sessions(name,started_utc,interval_ms,app_version,inventory_json) VALUES(?1,?2,?3,?4,?5)", params![name, chrono::Utc::now().to_rfc3339(), i64::try_from(interval_ms)?, env!("CARGO_PKG_VERSION"), serde_json::to_string(inventory)?])?;
        let id = tx.last_insert_rowid();
        if first.memory_total > 0 {
            insert_sample(&tx, id, first)?;
        }
        tx.commit()?;
        Ok(id)
    }
    /// Preserve committed samples and make a failed recording visibly incomplete.
    pub fn interrupt_session(&self, id: i64) -> Result<()> {
        self.connection.execute(
            "UPDATE sessions SET state='incomplete',ended_utc=?2 WHERE id=?1 AND state='open'",
            params![id, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }
    /// Recover every unfinished recording at application startup. UI listing
    /// limits must not hide old open sessions from this maintenance operation.
    pub fn interrupt_open_sessions(&self) -> Result<usize> {
        Ok(self.connection.execute(
            "UPDATE sessions SET state='incomplete',ended_utc=?1 WHERE state='open'",
            [chrono::Utc::now().to_rfc3339()],
        )?)
    }
    pub fn finish_session(&self, id: i64) -> Result<()> {
        let n = self.connection.execute(
            "UPDATE sessions SET state='complete',ended_utc=?2 WHERE id=?1 AND state='open'",
            params![id, chrono::Utc::now().to_rfc3339()],
        )?;
        if n == 0 {
            bail!("Sessione inesistente o già chiusa");
        }
        Ok(())
    }
    /// Metadata-only check for observers; never loads the recorded sample history.
    pub fn session_state(&self, id: i64) -> Result<String> {
        self.connection
            .query_row("SELECT state FROM sessions WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .context("Sessione inesistente")
    }
    pub fn rename_session(&self, id: i64, name: &str) -> Result<()> {
        validate_name(name)?;
        if self
            .connection
            .execute("UPDATE sessions SET name=?2 WHERE id=?1", params![id, name])?
            == 0
        {
            bail!("Sessione inesistente");
        }
        Ok(())
    }
    pub fn delete_session(&self, id: i64) -> Result<()> {
        if self
            .connection
            .execute("DELETE FROM sessions WHERE id=?1", [id])?
            == 0
        {
            bail!("Sessione inesistente");
        }
        Ok(())
    }
    pub fn save_cpu(&self, session_id: Option<i64>, value: &CpuBenchmark) -> Result<i64> {
        if !value.single_ops_per_sec.is_finite()
            || !value.multi_ops_per_sec.is_finite()
            || !value.duration_secs.is_finite()
        {
            bail!("Benchmark CPU con valori non finiti: risultato non salvato");
        }
        self.save_benchmark(session_id, "cpu", &serde_json::to_string(value)?)
    }
    pub fn save_llm(
        &self,
        session_id: Option<i64>,
        value: &BenchmarkResult,
        observed: bool,
    ) -> Result<i64> {
        if !value.wall_seconds.is_finite() {
            bail!("Benchmark LLM con durata non finita: risultato non salvato");
        }
        self.save_benchmark(
            session_id,
            if observed { "observed" } else { "llm" },
            &serde_json::to_string(value)?,
        )
    }
    fn save_benchmark(&self, session_id: Option<i64>, kind: &str, payload: &str) -> Result<i64> {
        self.connection.execute(
            "INSERT INTO benchmarks(session_id,recorded_utc,kind,payload) VALUES(?1,?2,?3,?4)",
            params![session_id, chrono::Utc::now().to_rfc3339(), kind, payload],
        )?;
        Ok(self.connection.last_insert_rowid())
    }
    pub fn save_alert(&self, session_id: Option<i64>, value: &AlertEvent) -> Result<()> {
        if !value.value.is_finite() || !value.threshold.is_finite() {
            bail!("Avviso con valori non finiti: evento non salvato");
        }
        self.connection.execute(
            "INSERT INTO alerts(session_id,payload) VALUES(?1,?2)",
            params![session_id, serde_json::to_string(value)?],
        )?;
        Ok(())
    }
    pub fn benchmarks(&self, session: Option<i64>, limit: usize) -> Result<Vec<SavedBenchmark>> {
        self.read_benchmarks(session, limit.clamp(1, 10000) as i64)
    }
    // SQLite LIMIT -1 means all rows. Exports must not inherit a UI preview limit.
    fn read_benchmarks(&self, session: Option<i64>, limit: i64) -> Result<Vec<SavedBenchmark>> {
        let mut statement=self.connection.prepare("SELECT id,session_id,recorded_utc,kind,payload FROM benchmarks WHERE (?1 IS NULL OR session_id=?1) ORDER BY id DESC LIMIT ?2")?;
        let rows = statement.query_map(params![session, limit], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        let mut result = Vec::new();
        for row in rows {
            let (id, session_id, recorded_utc, kind, payload) = row?;
            let mut saved = SavedBenchmark {
                id,
                session_id,
                recorded_utc,
                kind: kind.clone(),
                ..Default::default()
            };
            if kind == "cpu" {
                saved.cpu = Some(serde_json::from_str(&payload)?);
            } else {
                saved.llm = Some(serde_json::from_str(&payload)?);
            }
            result.push(saved);
        }
        Ok(result)
    }
    pub fn alerts(&self, session: Option<i64>, limit: usize) -> Result<Vec<AlertEvent>> {
        self.read_alerts(session, limit.clamp(1, 10000) as i64)
    }
    fn read_alerts(&self, session: Option<i64>, limit: i64) -> Result<Vec<AlertEvent>> {
        let mut q=self.connection.prepare("SELECT payload FROM alerts WHERE (?1 IS NULL OR session_id=?1) ORDER BY id DESC LIMIT ?2")?;
        let rows = q.query_map(params![session, limit], |r| r.get::<_, String>(0))?;
        let mut output = Vec::new();
        for row in rows {
            output.push(serde_json::from_str(&row?)?);
        }
        Ok(output)
    }
    pub fn list_sessions(&self, limit: usize) -> Result<Vec<SessionSummary>> {
        self.read_snapshot(|store| store.list_sessions_inner(limit))
    }
    fn list_sessions_inner(&self, limit: usize) -> Result<Vec<SessionSummary>> {
        let ids = {
            let mut q = self
                .connection
                .prepare("SELECT id FROM sessions ORDER BY id DESC LIMIT ?1")?;
            q.query_map([limit.clamp(1, 5000) as i64], |r| r.get::<_, i64>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        ids.into_iter().map(|id| self.summary(id, false)).collect()
    }
    fn summary(&self, id: i64, percentiles: bool) -> Result<SessionSummary> {
        let mut summary = self
            .connection
            .query_row(
                "SELECT id,name,started_utc,ended_utc,state,app_version,interval_ms FROM sessions WHERE id=?1",
                [id],
                |r| {
                    let interval_ms: i64 = r.get(6)?;
                    Ok(SessionSummary {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        started_utc: r.get(2)?,
                        ended_utc: r.get(3)?,
                        state: r.get(4)?,
                        app_version: r.get(5)?,
                        interval_ms: interval_ms.try_into().map_err(|_| {
                            rusqlite::Error::IntegralValueOutOfRange(6, interval_ms)
                        })?,
                        ..Default::default()
                    })
                },
            )
            .context("Sessione inesistente")?;
        self.connection.query_row("SELECT COUNT(*),COALESCE(MAX(elapsed_secs)-MIN(elapsed_secs),0),AVG(cpu),MAX(cpu),AVG(ram),MAX(ram),AVG(gpu),MAX(gpu),AVG(vram),MAX(vram),AVG(llm_ram),MAX(llm_ram) FROM samples WHERE session_id=?1",[id],|r|{summary.samples=r.get::<_,i64>(0)? as u64;summary.duration_secs=r.get::<_,f64>(1)?.max(0.0);summary.cpu.average=r.get(2)?;summary.cpu.peak=r.get(3)?;summary.ram.average=r.get(4)?;summary.ram.peak=r.get(5)?;summary.gpu.average=r.get(6)?;summary.gpu.peak=r.get(7)?;summary.vram.average=r.get(8)?;summary.vram.peak=r.get(9)?;summary.llm_ram.average=r.get(10)?;summary.llm_ram.peak=r.get(11)?;Ok(())})?;
        if percentiles {
            summary.cpu.p95 = self.p95(id, "cpu")?;
            summary.ram.p95 = self.p95(id, "ram")?;
            summary.gpu.p95 = self.p95(id, "gpu")?;
            summary.vram.p95 = self.p95(id, "vram")?;
            summary.llm_ram.p95 = self.p95(id, "llm_ram")?;
        }
        summary.benchmark_count = self.connection.query_row(
            "SELECT COUNT(*) FROM benchmarks WHERE session_id=?1",
            [id],
            |r| r.get::<_, i64>(0),
        )? as u64;
        Ok(summary)
    }
    fn p95(&self, id: i64, column: &str) -> Result<Option<f64>> {
        debug_assert!(["cpu", "ram", "gpu", "vram", "llm_ram"].contains(&column));
        let count: i64 = self.connection.query_row(
            &format!("SELECT COUNT({column}) FROM samples WHERE session_id=?1"),
            [id],
            |r| r.get(0),
        )?;
        if count == 0 {
            return Ok(None);
        }
        let offset = ((count as u64).saturating_mul(95).div_ceil(100) - 1) as i64;
        Ok(self.connection.query_row(&format!("SELECT {column} FROM samples WHERE session_id=?1 AND {column} IS NOT NULL ORDER BY {column} LIMIT 1 OFFSET ?2"),params![id,offset],|r|r.get(0))?)
    }
    pub fn load_session(&self, id: i64, preview_limit: usize) -> Result<SessionData> {
        self.read_snapshot(|store| store.load_session_inner(id, preview_limit))
    }
    /// Exact descriptive statistics over all selected samples, independent of
    /// replay preview limits. Large requests fail explicitly before allocation.
    pub fn analysis_session(&self, id: i64, window_seconds: Option<u64>) -> Result<AnalysisReport> {
        self.read_snapshot(|store| {
            let (name, inventory): (String, String) = store.connection.query_row(
                "SELECT name,inventory_json FROM sessions WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).context("Sessione inesistente")?;
            let inventory: Inventory = serde_json::from_str(&inventory)?;
            let last_elapsed: Option<f64> = store.connection.query_row(
                "SELECT MAX(elapsed_secs) FROM samples WHERE session_id=?1", [id], |row| row.get(0),
            )?;
            let minimum_elapsed = window_seconds.zip(last_elapsed).map(|(window, last)| last - window as f64);
            let count: i64 = store.connection.query_row(
                "SELECT COUNT(*) FROM samples WHERE session_id=?1 AND (?2 IS NULL OR elapsed_secs>=?2)",
                params![id, minimum_elapsed], |row| row.get(0),
            )?;
            if count > 100_000 {
                bail!("Analisi limitata a 100000 campioni per contenere l'uso di memoria: selezionati {count}. Scegli una finestra temporale più breve.");
            }
            let mut statement = store.connection.prepare(
                "SELECT payload FROM samples WHERE session_id=?1 AND (?2 IS NULL OR elapsed_secs>=?2) ORDER BY id",
            )?;
            let rows = statement.query_map(params![id, minimum_elapsed], |row| row.get::<_, String>(0))?;
            let mut samples = Vec::with_capacity(count as usize);
            for row in rows {
                samples.push(serde_json::from_str::<Snapshot>(&row?)?);
            }
            let source = match window_seconds {
                Some(window) => format!("Sessione SQLite #{id} · {name} · ultimi {window} s"),
                None => format!("Sessione SQLite #{id} · {name}"),
            };
            let mut report = analyze_snapshots(&samples, &source);
            if inventory.logical_cores > 0 && samples.iter().any(|s| s.per_core.len() != inventory.logical_cores) {
                report.warnings.push(format!("Dati per core parziali rispetto all'inventario ({} core logici): analizzati solo i valori registrati, senza topologia ricostruita.", inventory.logical_cores));
            }
            Ok(report)
        })
    }
    fn load_session_inner(&self, id: i64, preview_limit: usize) -> Result<SessionData> {
        let summary = self.summary(id, true)?;
        let inventory_json: String = self.connection.query_row(
            "SELECT inventory_json FROM sessions WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        let count = summary.samples as usize;
        let limit = preview_limit.clamp(2, 10000).min(count);
        let indices: std::collections::BTreeSet<usize> = (0..limit)
            .map(|i| {
                if limit <= 1 {
                    0
                } else {
                    i * (count - 1) / (limit - 1)
                }
            })
            .collect();
        let mut samples = Vec::new();
        let mut q = self
            .connection
            .prepare("SELECT payload FROM samples WHERE session_id=?1 ORDER BY id")?;
        let mut rows = q.query([id])?;
        let mut index = 0;
        while let Some(row) = rows.next()? {
            if indices.contains(&index) {
                let json: String = row.get(0)?;
                samples.push(serde_json::from_str(&json)?);
            }
            index += 1;
        }
        Ok(SessionData {
            total_samples: summary.samples,
            summary,
            inventory: serde_json::from_str(&inventory_json)?,
            samples,
            benchmarks: self.benchmarks(Some(id), 1000)?,
            alerts: self.alerts(Some(id), 1000)?,
        })
    }
    pub fn compare(&self, left_id: i64, right_id: i64) -> Result<SessionComparison> {
        self.read_snapshot(|store| store.compare_inner(left_id, right_id))
    }
    fn compare_inner(&self, left_id: i64, right_id: i64) -> Result<SessionComparison> {
        if left_id == right_id {
            bail!("Seleziona due sessioni diverse per il confronto.");
        }
        let mut left = self.load_session_inner(left_id, 400)?;
        let mut right = self.load_session_inner(right_id, 400)?;
        // Benchmark statistics use the complete history, independently of the
        // bounded event list shown by the replay UI.
        left.benchmarks = self.read_benchmarks(Some(left_id), -1)?;
        right.benchmarks = self.read_benchmarks(Some(right_id), -1)?;
        let mut metrics = Vec::new();
        for (label, unit, a, b, lower) in [
            (
                "CPU media",
                "%",
                left.summary.cpu.average,
                right.summary.cpu.average,
                true,
            ),
            (
                "CPU picco",
                "%",
                left.summary.cpu.peak,
                right.summary.cpu.peak,
                true,
            ),
            (
                "CPU P95",
                "%",
                left.summary.cpu.p95,
                right.summary.cpu.p95,
                true,
            ),
            (
                "RAM media",
                "B",
                left.summary.ram.average,
                right.summary.ram.average,
                true,
            ),
            (
                "RAM picco",
                "B",
                left.summary.ram.peak,
                right.summary.ram.peak,
                true,
            ),
            (
                "GPU media",
                "%",
                left.summary.gpu.average,
                right.summary.gpu.average,
                true,
            ),
            (
                "GPU P95",
                "%",
                left.summary.gpu.p95,
                right.summary.gpu.p95,
                true,
            ),
            (
                "VRAM picco",
                "B",
                left.summary.vram.peak,
                right.summary.vram.peak,
                true,
            ),
            (
                "RAM processi LLM picco",
                "B",
                left.summary.llm_ram.peak,
                right.summary.llm_ram.peak,
                true,
            ),
            (
                "Durata campionata",
                "s",
                Some(left.summary.duration_secs),
                Some(right.summary.duration_secs),
                false,
            ),
        ] {
            metrics.push(comparison_metric(label, unit, a, b, lower));
        }
        let mut warnings=vec!["Medie e P95 calcolati su TUTTI i campioni salvati; assenze escluse, non convertite in zero. Media dei campioni, non pesata per tempo. I grafici usano un'anteprima distribuita sull'intera sessione e avanzamento normalizzato.".into(),"Minore utilizzo non significa automaticamente maggiori prestazioni: confrontare lo stesso lavoro, durata, modello, contesto, quantizzazione e stato cache.".into()];
        if left.inventory.cpu_name != right.inventory.cpu_name
            || left.inventory.logical_cores != right.inventory.logical_cores
        {
            warnings.push("Hardware CPU differente: i carichi percentuali non misurano la stessa capacità di calcolo.".into());
        }
        if left.samples.first().map(|s| s.memory_total)
            != right.samples.first().map(|s| s.memory_total)
        {
            warnings.push("Quantità RAM differente tra le sessioni.".into());
        }
        let gpu_names = |data: &SessionData| {
            data.samples
                .first()
                .map(|s| s.gpus.iter().map(|g| g.name.clone()).collect::<Vec<_>>())
                .unwrap_or_default()
        };
        if gpu_names(&left) != gpu_names(&right) {
            warnings.push("GPU o ordine adattatori differenti; metriche aggregate GPU0 da interpretare con cautela.".into());
        }
        let gpu_source = |data: &SessionData| {
            data.samples
                .first()
                .and_then(|sample| sample.gpus.first())
                .map(|gpu| gpu.source.trim().to_string())
                .unwrap_or_default()
        };
        let left_source = gpu_source(&left);
        let right_source = gpu_source(&right);
        let unknown_source = |source: &str| {
            source.is_empty()
                || ["n/d", "unknown", "WMI inventory"]
                    .iter()
                    .any(|value| source.eq_ignore_ascii_case(value))
        };
        if unknown_source(&left_source) || unknown_source(&right_source) {
            warnings.push("Fonte delle misure GPU0 sconosciuta o di solo inventario in una sessione: non assumere metriche GPU equivalenti.".into());
        } else if left_source != right_source {
            warnings.push(format!("Provider GPU0 differenti ({left_source} / {right_source}): carico e memoria possono usare criteri diversi."));
        }
        if left.summary.app_version.is_empty() || right.summary.app_version.is_empty() {
            warnings.push("Versione RUST-CPU di origine non disponibile per una sessione importata: confrontabilità non verificata.".into());
        } else if left.summary.app_version != right.summary.app_version {
            warnings.push(format!("Versioni RUST-CPU di origine differenti ({} / {}): verificare le variazioni dei provider e dei metodi.", left.summary.app_version, right.summary.app_version));
        }
        if left.summary.samples == 0 || right.summary.samples == 0 {
            warnings.push("Una sessione non contiene campioni: i valori sono n/d.".into());
        }
        if left.summary.state != "complete" || right.summary.state != "complete" {
            warnings.push("Una sessione è ancora aperta/incompleta: il confronto è una fotografia dei dati già salvati.".into());
        }
        let benchmarks = compare_benchmarks(&left.benchmarks, &right.benchmarks);
        Ok(SessionComparison {
            left: left.summary,
            right: right.summary,
            metrics,
            warnings,
            left_series: left.samples,
            right_series: right.samples,
            left_benchmarks: left.benchmarks,
            right_benchmarks: right.benchmarks,
            benchmarks,
        })
    }
    pub fn quick_check(&self) -> Result<String> {
        let value: String = self
            .connection
            .query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if value != "ok" {
            bail!("Controllo integrità SQLite: {value}");
        }
        Ok(value)
    }
    pub fn backup(&self, path: &Path) -> Result<()> {
        self.backup_with_limit(path, Duration::from_secs(5))
    }
    fn backup_with_limit(&self, path: &Path, limit: Duration) -> Result<()> {
        let deadline = Instant::now() + limit;
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent)?;
        }
        let reservation = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .context("Il backup deve avere un nome nuovo")?;
        drop(reservation);
        let result = (|| -> Result<()> {
            self.connection.busy_timeout(Duration::from_millis(10))?;
            let mut destination = Connection::open(path)?;
            destination.busy_timeout(Duration::from_millis(10))?;
            let backup = rusqlite::backup::Backup::new(&self.connection, &mut destination)?;
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    bail!("Backup SQLite oltre il limite di attesa.");
                }
                match backup.step(128)? {
                    rusqlite::backup::StepResult::Done => return Ok(()),
                    rusqlite::backup::StepResult::More => {}
                    rusqlite::backup::StepResult::Busy | rusqlite::backup::StepResult::Locked => {
                        std::thread::sleep(remaining.min(Duration::from_millis(10)))
                    }
                    _ => bail!("Stato backup SQLite non riconosciuto."),
                }
            }
        })();
        let result = result.and(
            self.connection
                .busy_timeout(Duration::from_secs(2))
                .map_err(Into::into),
        );
        match result {
            Ok(()) => Ok(()),
            Err(error) => match fs::remove_file(path) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(error.context(format!(
                    "Rimozione backup incompleto non riuscita ({}): {cleanup}",
                    path.display()
                ))),
            },
        }
    }
    pub fn export_session(&self, id: i64, path: &Path) -> Result<()> {
        self.read_snapshot(|store| store.export_session_inner(id, path))
    }
    fn export_session_inner(&self, id: i64, path: &Path) -> Result<()> {
        let summary = self.summary(id, true)?;
        let inventory: String = self.connection.query_row(
            "SELECT inventory_json FROM sessions WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().write(true).create_new(true).open(path)?;
        let result = (|| -> Result<()> {
            let mut w = BufWriter::new(file);
            write!(w, "{{\"format_version\":1,\"summary\":")?;
            serde_json::to_writer(&mut w, &summary)?;
            write!(
                w,
                ",\"inventory\":{inventory},\"total_samples\":{},\"benchmarks\":",
                summary.samples
            )?;
            serde_json::to_writer(&mut w, &self.read_benchmarks(Some(id), -1)?)?;
            write!(w, ",\"alerts\":")?;
            serde_json::to_writer(&mut w, &self.read_alerts(Some(id), -1)?)?;
            write!(w, ",\"samples\":[")?;
            let mut q = self
                .connection
                .prepare("SELECT payload FROM samples WHERE session_id=?1 ORDER BY id")?;
            let mut rows = q.query([id])?;
            let mut first = true;
            while let Some(row) = rows.next()? {
                if !first {
                    write!(w, ",")?;
                }
                first = false;
                let json: String = row.get(0)?;
                w.write_all(json.as_bytes())?;
            }
            write!(w, "]}}")?;
            w.flush()?;
            w.get_ref().sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(path);
        }
        result
    }
    pub fn import_session(&mut self, path: &Path) -> Result<i64> {
        let file = fs::File::open(path)?;
        if file.metadata()?.len() > 64 * 1024 * 1024 {
            bail!("Import JSON limitato a 64 MiB.");
        }
        let value: serde_json::Value = serde_json::from_reader(file)?;
        let mut data: SessionData =
            if value.get("format_version").and_then(|v| v.as_u64()) == Some(1) {
                serde_json::from_value(value)?
            } else if value.get("schema_version").and_then(|v| v.as_u64()) == Some(1) {
                let inventory: Inventory = serde_json::from_value(
                    value
                        .get("inventory")
                        .cloned()
                        .context("Inventario assente")?,
                )?;
                let snapshot: Snapshot = serde_json::from_value(
                    value.get("snapshot").cloned().context("Campione assente")?,
                )?;
                let mut benchmarks = Vec::new();
                if let Some(v) = value.get("cpu_benchmark").filter(|v| !v.is_null()) {
                    benchmarks.push(SavedBenchmark {
                        kind: "cpu".into(),
                        cpu: Some(serde_json::from_value(v.clone())?),
                        ..Default::default()
                    });
                }
                if let Some(v) = value.pointer("/llm/benchmark").filter(|v| !v.is_null()) {
                    benchmarks.push(SavedBenchmark {
                        kind: "llm".into(),
                        llm: Some(serde_json::from_value(v.clone())?),
                        ..Default::default()
                    });
                }
                SessionData {
                    summary: SessionSummary {
                        name: "Snapshot importato".into(),
                        started_utc: value
                            .get("captured_utc")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_owned(),
                        ended_utc: value
                            .get("captured_utc")
                            .and_then(|v| v.as_str())
                            .filter(|v| !v.is_empty())
                            .map(str::to_owned),
                        app_version: value
                            .get("app_version")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_owned(),
                        ..Default::default()
                    },
                    inventory,
                    samples: vec![snapshot],
                    benchmarks,
                    ..Default::default()
                }
            } else {
                bail!("Formato JSON non riconosciuto (sessione v1 o snapshot v1).");
            };
        if data.samples.len() > 50000 || data.benchmarks.len() > 10000 || data.alerts.len() > 10000
        {
            bail!("Import oltre i limiti (50000 campioni / 10000 eventi).");
        }
        data.summary.name = if data.summary.name.trim().is_empty() {
            "Sessione importata".into()
        } else {
            data.summary.name.chars().take(120).collect()
        };
        validate_name(&data.summary.name)?;
        // Old format-v1 exports omitted the interval. Retain their historical
        // 1000 ms fallback, while preserving the declared interval in new files.
        let interval_ms = if data.summary.interval_ms == 0 {
            1000
        } else {
            data.summary.interval_ms
        };
        let interval_ms = i64::try_from(interval_ms).context("Intervallo sessione non valido")?;
        let imported_utc = chrono::Utc::now().to_rfc3339();
        let tx = self.connection.transaction()?;
        tx.execute("INSERT INTO sessions(name,started_utc,ended_utc,state,interval_ms,app_version,inventory_json) VALUES(?1,?2,?3,'complete',?4,?5,?6)",params![data.summary.name,if data.summary.started_utc.is_empty(){imported_utc.clone()}else{data.summary.started_utc.clone()},data.summary.ended_utc.filter(|v| !v.is_empty()).unwrap_or_else(|| imported_utc.clone()),interval_ms,data.summary.app_version,serde_json::to_string(&data.inventory)?])?;
        let id = tx.last_insert_rowid();
        for sample in data.samples {
            insert_sample(&tx, id, &sample)?;
        }
        for benchmark in data.benchmarks {
            let payload = match (
                benchmark.kind.as_str(),
                benchmark.cpu.as_ref(),
                benchmark.llm.as_ref(),
            ) {
                ("cpu", Some(cpu), None) => serde_json::to_string(cpu)?,
                ("llm" | "observed", None, Some(llm)) => serde_json::to_string(llm)?,
                _ => bail!(
                    "Benchmark importato incoerente: kind deve corrispondere a un unico payload CPU o LLM."
                ),
            };
            tx.execute(
                "INSERT INTO benchmarks(session_id,recorded_utc,kind,payload) VALUES(?1,?2,?3,?4)",
                params![
                    id,
                    if benchmark.recorded_utc.is_empty() {
                        imported_utc.clone()
                    } else {
                        benchmark.recorded_utc
                    },
                    benchmark.kind,
                    payload
                ],
            )?;
        }
        for alert in data.alerts {
            tx.execute(
                "INSERT INTO alerts(session_id,payload) VALUES(?1,?2)",
                params![id, serde_json::to_string(&alert)?],
            )?;
        }
        tx.commit()?;
        Ok(id)
    }
}
pub fn comparison_metric(
    label: &str,
    unit: &str,
    left: Option<f64>,
    right: Option<f64>,
    lower_is_better: bool,
) -> ComparisonMetric {
    let delta = left.zip(right).map(|(a, b)| b - a);
    let delta_percent = left.zip(delta).and_then(|(a, d)| {
        if a.abs() > f64::EPSILON {
            Some(d / a.abs() * 100.0)
        } else {
            None
        }
    });
    ComparisonMetric {
        label: label.into(),
        unit: unit.into(),
        left,
        right,
        delta,
        delta_percent,
        lower_is_better,
    }
}
pub fn compare_benchmarks(
    left: &[SavedBenchmark],
    right: &[SavedBenchmark],
) -> Vec<BenchmarkComparison> {
    fn origin_or_unknown(value: &str) -> &str {
        if value.trim().is_empty() {
            "unknown"
        } else {
            value
        }
    }
    fn group_key(run: &SavedBenchmark) -> Option<String> {
        if let Some(cpu) = &run.cpu {
            Some(format!(
                "CPU | {} | {} worker | {}",
                cpu.algorithm,
                cpu.threads,
                origin_or_unknown(&cpu.build_profile)
            ))
        } else {
            run.llm.as_ref().map(|llm| {
                format!(
                    "{} | {} | {} | {}",
                    run.kind,
                    llm.runtime,
                    llm.model,
                    origin_or_unknown(&llm.throughput_kind)
                )
            })
        }
    }
    fn method_is_known(run: &SavedBenchmark) -> bool {
        if let Some(cpu) = &run.cpu {
            !origin_or_unknown(&cpu.build_profile).eq_ignore_ascii_case("unknown")
        } else {
            run.llm.as_ref().is_some_and(|llm| {
                matches!(llm.throughput_kind.as_str(), "native_decode" | "end_to_end")
            })
        }
    }
    fn mean(values: &[f64]) -> Option<f64> {
        (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
    }
    fn population_stddev(values: &[f64]) -> Option<f64> {
        let average = mean(values)?;
        let variance = values
            .iter()
            .map(|value| (value - average).powi(2))
            .sum::<f64>()
            / values.len() as f64;
        Some(variance.sqrt())
    }
    fn median(values: &[f64]) -> Option<f64> {
        if values.is_empty() {
            return None;
        }
        let mut sorted = values.to_vec();
        sorted.sort_by(f64::total_cmp);
        let middle = sorted.len() / 2;
        Some(if sorted.len().is_multiple_of(2) {
            (sorted[middle - 1] + sorted[middle]) / 2.0
        } else {
            sorted[middle]
        })
    }
    fn cpu_metrics(left: &[&SavedBenchmark], right: &[&SavedBenchmark]) -> Vec<ComparisonMetric> {
        let rates = |runs: &[&SavedBenchmark], multi: bool| {
            runs.iter()
                .filter_map(|run| {
                    run.cpu.as_ref().map(|cpu| {
                        if multi {
                            cpu.multi_ops_per_sec
                        } else {
                            cpu.single_ops_per_sec
                        }
                    })
                })
                .collect::<Vec<_>>()
        };
        [("CPU single media", false), ("CPU multi media", true)]
            .into_iter()
            .map(|(label, multi)| {
                comparison_metric(
                    label,
                    "mix/s",
                    mean(&rates(left, multi)),
                    mean(&rates(right, multi)),
                    false,
                )
            })
            .collect()
    }
    fn llm_metrics(left: &[&SavedBenchmark], right: &[&SavedBenchmark]) -> Vec<ComparisonMetric> {
        let rates = |runs: &[&SavedBenchmark]| {
            runs.iter()
                .filter_map(|run| {
                    run.llm
                        .as_ref()
                        .and_then(|llm| llm.generation_tokens_per_sec)
                })
                .filter(|value| value.is_finite())
                .collect::<Vec<_>>()
        };
        let ttfts = |runs: &[&SavedBenchmark]| {
            runs.iter()
                .filter_map(|run| run.llm.as_ref().and_then(|llm| llm.time_to_first_token_ms))
                .collect::<Vec<_>>()
        };
        let wall_times = |runs: &[&SavedBenchmark]| {
            runs.iter()
                .filter_map(|run| run.llm.as_ref().map(|llm| llm.wall_seconds))
                .collect::<Vec<_>>()
        };
        let left_rates = rates(left);
        let right_rates = rates(right);
        vec![
            comparison_metric(
                "Throughput medio",
                "token/s",
                mean(&left_rates),
                mean(&right_rates),
                false,
            ),
            comparison_metric(
                "Deviazione standard",
                "token/s",
                population_stddev(&left_rates),
                population_stddev(&right_rates),
                true,
            ),
            comparison_metric(
                "Throughput mediano",
                "token/s",
                median(&left_rates),
                median(&right_rates),
                false,
            ),
            comparison_metric(
                "TTFT medio",
                "ms",
                mean(&ttfts(left)),
                mean(&ttfts(right)),
                true,
            ),
            comparison_metric(
                "Tempo client medio",
                "s",
                mean(&wall_times(left)),
                mean(&wall_times(right)),
                true,
            ),
        ]
    }

    let keys: std::collections::BTreeSet<_> =
        left.iter().chain(right).filter_map(group_key).collect();
    keys.into_iter().map(|key| {
        let left_runs: Vec<_> = left.iter().filter(|run| group_key(run).as_ref() == Some(&key)).collect();
        let right_runs: Vec<_> = right.iter().filter(|run| group_key(run).as_ref() == Some(&key)).collect();
        let representative = left_runs.first().or_else(|| right_runs.first()).expect("non-empty benchmark group");
        let cpu_group = representative.cpu.is_some();
        let known_method = method_is_known(representative);
        let mut metrics = if cpu_group {
            cpu_metrics(&left_runs, &right_runs)
        } else {
            llm_metrics(&left_runs, &right_runs)
        };
        let mut warnings = vec!["Stesso gruppo non garantisce stesso contesto/offload/cache; il primo run può includere caricamento. Le osservazioni esterne hanno prompt differenti e sono separate dai benchmark sintetici.".into()];
        if left_runs.is_empty() || right_runs.is_empty() {
            warnings.push("Gruppo presente in una sola sessione: differenze n/d.".into());
        }
        if !known_method {
            for metric in &mut metrics {
                metric.delta = None;
                metric.delta_percent = None;
            }
            warnings.push(if cpu_group {
                "Profilo di compilazione CPU di origine sconosciuto: valori consultabili, compatibilità non verificata e differenze n/d."
            } else {
                "Metodo throughput LLM di origine sconosciuto: decode nativo/end-to-end non verificabile; valori consultabili e differenze n/d."
            }.into());
        }
        BenchmarkComparison {
            label: key,
            kind: if cpu_group { "cpu" } else { "llm" }.into(),
            method: if !known_method { "unknown" } else if cpu_group { "mix64" } else { "runtime/model/metodo esatti" }.into(),
            runs_left: left_runs.len(),
            runs_right: right_runs.len(),
            metrics,
            warnings,
        }
    }).collect()
}
fn validate_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        bail!("Nome sessione: 1–120 caratteri visibili.");
    }
    Ok(())
}
fn insert_sample(connection: &Connection, id: i64, s: &Snapshot) -> Result<()> {
    if !s.elapsed_secs.is_finite()
        || !s.cpu_percent.is_finite()
        || s.per_core.len() > 4096
        || s.processes.len() > 20000
        || s.disks.len() > 2048
        || s.networks.len() > 2048
    {
        bail!("Campione non valido o troppo grande");
    }
    // serde_json serializes NaN/Inf as null. For mandatory numeric fields this
    // would commit a payload that Snapshot can never deserialize for replay.
    if s.per_core.iter().any(|value| !value.is_finite())
        || s.sensors
            .iter()
            .any(|sensor| !sensor.temperature.is_finite())
        || s.processes
            .iter()
            .filter(|process| process.is_llm)
            .any(|process| {
                !process.cpu_percent.is_finite()
                    || !process.read_bytes_per_sec.is_finite()
                    || !process.write_bytes_per_sec.is_finite()
            })
        || s.disks.iter().any(|disk| {
            !disk.read_bytes_per_sec.is_finite() || !disk.write_bytes_per_sec.is_finite()
        })
        || s.networks.iter().any(|network| {
            !network.received_per_sec.is_finite() || !network.transmitted_per_sec.is_finite()
        })
    {
        bail!("Campione con valori numerici non finiti: nessun dato aggiunto all'archivio");
    }
    let mut compact = s.clone();
    compact.processes.retain(|p| p.is_llm); // Only attributed LLM process rows are archived; live view remains complete.
    let gpu = s.gpus.first();
    let cpu = (!s.per_core.is_empty()).then_some(s.cpu_percent as f64);
    let ram = (s.memory_total > 0).then_some(s.memory_used as f64);
    let gpu_use = gpu
        .and_then(|g| g.utilization)
        .filter(|v| v.is_finite())
        .map(f64::from);
    let vram = gpu.and_then(|g| g.memory_used).map(|v| v as f64);
    let llm_ram = s
        .processes
        .iter()
        .filter(|p| p.is_llm)
        .map(|p| p.memory_bytes as f64)
        .sum::<f64>();
    connection.execute("INSERT INTO samples(session_id,timestamp_unix,elapsed_secs,cpu,ram,gpu,vram,llm_ram,disk_read,disk_write,net_rx,net_tx,payload) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![id,i64::try_from(s.timestamp_unix)?,s.elapsed_secs,cpu,ram,gpu_use,vram,llm_ram,s.disks.iter().map(|d|d.read_bytes_per_sec).sum::<f64>(),s.disks.iter().map(|d|d.write_bytes_per_sec).sum::<f64>(),s.networks.iter().map(|n|n.received_per_sec).sum::<f64>(),s.networks.iter().map(|n|n.transmitted_per_sec).sum::<f64>(),serde_json::to_string(&compact)?])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(cpu: f32, t: f64) -> Snapshot {
        Snapshot {
            timestamp_unix: 100 + t as u64,
            elapsed_secs: t,
            cpu_percent: cpu,
            per_core: vec![cpu],
            memory_used: 100,
            memory_total: 1000,
            processes: vec![
                crate::model::ProcessRow {
                    name: "llama-server".into(),
                    is_llm: true,
                    memory_bytes: 80,
                    ..Default::default()
                },
                crate::model::ProcessRow {
                    name: "private-app".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }
    #[test]
    fn durable_roundtrip_and_parameter_binding() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("archive.sqlite3");
        let id;
        {
            let store = Store::open(&path).unwrap();
            id = store
                .begin_session(
                    "L'apostrofo'); DROP TABLE samples;--",
                    &Inventory::default(),
                    1000,
                )
                .unwrap();
            store.append_sample(id, &sample(10.0, 1.0)).unwrap();
            store.finish_session(id).unwrap();
            store
                .save_preferences(&crate::settings::Preferences {
                    theme_light: true,
                    ..Default::default()
                })
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let data = store.load_session(id, 200).unwrap();
            assert_eq!(data.total_samples, 1);
            assert_eq!(data.samples[0].processes.len(), 1);
            assert_eq!(data.summary.cpu.average, Some(10.0));
            assert!(store.preferences().unwrap().theme_light);
            assert_eq!(store.quick_check().unwrap(), "ok");
            assert!(store.append_sample(id, &sample(20.0, 2.0)).is_err());
        }
    }
    #[test]
    fn comparison_uses_all_rows_and_preserves_missing_gpu_and_zero_baseline() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::open(&d.path().join("archive.db")).unwrap();
        let a = store
            .begin_session("A", &Inventory::default(), 1000)
            .unwrap();
        let b = store
            .begin_session("B", &Inventory::default(), 1000)
            .unwrap();
        for i in 0..21 {
            store.append_sample(a, &sample(0.0, i as f64)).unwrap();
            store.append_sample(b, &sample(i as f32, i as f64)).unwrap();
        }
        store.finish_session(a).unwrap();
        store.finish_session(b).unwrap();
        let preview = store.load_session(b, 3).unwrap();
        assert_eq!(preview.samples.len(), 3);
        assert_eq!(preview.samples[2].cpu_percent, 20.0);
        let c = store.compare(a, b).unwrap();
        assert_eq!(c.right.cpu.average, Some(10.0));
        assert_eq!(c.right.cpu.p95, Some(19.0));
        assert_eq!(c.metrics[0].delta, Some(10.0));
        assert_eq!(c.metrics[0].delta_percent, None);
        assert_eq!(c.left.gpu.average, None);
    }
    #[test]
    fn read_snapshot_stays_consistent_while_another_wal_connection_commits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("archive.db");
        let store = Store::open(&path).unwrap();
        let writer = Store::open(&path).unwrap();
        let id = store
            .begin_session("Live", &Inventory::default(), 1000)
            .unwrap();
        store.append_sample(id, &sample(10.0, 0.0)).unwrap();
        store
            .read_snapshot(|reader| {
                let before = reader.summary(id, true)?;
                writer.append_sample(id, &sample(90.0, 1.0))?;
                let after = reader.load_session_inner(id, 10)?;
                assert_eq!(before.samples, 1);
                assert_eq!(after.summary.samples, 1);
                assert_eq!(after.samples.len(), 1);
                assert_eq!(after.summary.cpu.average, Some(10.0));
                Ok(())
            })
            .unwrap();
        let refreshed = store.load_session(id, 10).unwrap();
        assert_eq!(refreshed.summary.samples, 2);
        assert_eq!(refreshed.samples.len(), 2);
        assert_eq!(refreshed.summary.cpu.average, Some(50.0));
        // An error also releases the read transaction for the next operation.
        assert!(store.load_session(-1, 10).is_err());
        assert_eq!(store.list_sessions(10).unwrap().len(), 1);
    }
    #[test]
    fn comparison_benchmark_statistics_include_runs_older_than_replay_preview() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("archive.db")).unwrap();
        let left = store
            .begin_session("A", &Inventory::default(), 1000)
            .unwrap();
        let right = store
            .begin_session("B", &Inventory::default(), 1000)
            .unwrap();
        let tx = store.connection.transaction().unwrap();
        for index in 0..1001 {
            let benchmark = CpuBenchmark {
                build_profile: "optimized".into(),
                single_ops_per_sec: if index == 0 { 1001.0 } else { 0.0 },
                multi_ops_per_sec: 0.0,
                threads: 1,
                duration_secs: 1.2,
                algorithm: "test".into(),
            };
            tx.execute("INSERT INTO benchmarks(session_id,recorded_utc,kind,payload) VALUES(?1,'2024-02-03T10:00:00Z','cpu',?2)", params![left, serde_json::to_string(&benchmark).unwrap()]).unwrap();
        }
        tx.commit().unwrap();
        assert_eq!(store.load_session(left, 10).unwrap().benchmarks.len(), 1000);
        let comparison = store.compare(left, right).unwrap();
        assert_eq!(comparison.left_benchmarks.len(), 1001);
        assert_eq!(comparison.benchmarks[0].runs_left, 1001);
        assert_eq!(comparison.benchmarks[0].metrics[0].left, Some(1.0));
    }
    #[test]
    fn session_analysis_uses_exact_window_and_preserves_real_core_and_gpu_rows() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("archive.db")).unwrap();
        let inventory = Inventory {
            logical_cores: 2,
            ..Default::default()
        };
        let id = store.begin_session("Analysis", &inventory, 1000).unwrap();
        for index in 0..20 {
            let mut snapshot = sample(index as f32, index as f64);
            snapshot.per_core = vec![index as f32, 2.0 * index as f32];
            snapshot.gpus = vec![
                crate::model::GpuRow {
                    name: "A".into(),
                    utilization: Some(10.0),
                    ..Default::default()
                },
                crate::model::GpuRow {
                    name: "B".into(),
                    utilization: Some(80.0),
                    temperature: Some(60.0),
                    ..Default::default()
                },
            ];
            store.append_sample(id, &snapshot).unwrap();
        }
        let metric = |report: &AnalysisReport, id: &str| {
            report
                .metrics
                .iter()
                .find(|m| m.id == id)
                .unwrap()
                .statistics
                .clone()
        };
        let all = store.analysis_session(id, None).unwrap();
        assert_eq!(all.samples, 20);
        assert_eq!(metric(&all, "cpu.total").mean, Some(9.5));
        let window = store.analysis_session(id, Some(4)).unwrap();
        assert_eq!(window.samples, 5);
        assert_eq!(window.duration_secs, 4.0);
        assert_eq!(metric(&window, "cpu.total").min, Some(15.0));
        assert_eq!(metric(&window, "cpu.total").mean, Some(17.0));
        assert_eq!(metric(&window, "cpu.core.1").mean, Some(34.0));
        assert_eq!(metric(&window, "gpu.1.utilization").mean, Some(80.0));
        let last = store.analysis_session(id, Some(0)).unwrap();
        assert_eq!(last.samples, 1);
        assert_eq!(metric(&last, "cpu.total").std_dev, None);
        let replay = store.load_session(id, 2).unwrap();
        assert_eq!(replay.samples[1].per_core, vec![19.0, 38.0]);
        assert_eq!(replay.samples[1].gpus.len(), 2);
    }
    #[test]
    fn session_analysis_warns_on_partial_legacy_core_data_without_inventing_cores() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("archive.db")).unwrap();
        let inventory = Inventory {
            logical_cores: 8,
            ..Default::default()
        };
        let id = store
            .begin_session("Legacy partial", &inventory, 1000)
            .unwrap();
        let mut snapshot = sample(30.0, 0.0);
        snapshot.per_core.clear();
        store.append_sample(id, &snapshot).unwrap();
        let report = store.analysis_session(id, None).unwrap();
        assert!(!report.metrics.iter().any(|m| m.id.starts_with("cpu.core.")));
        assert!(report.warnings.iter().any(|w| w.contains("8 core logici")));
        assert_eq!(
            store.load_session(id, 2).unwrap().samples[0].per_core.len(),
            0
        );
    }
    #[test]
    fn session_analysis_rejects_oversized_requests_before_decoding_payloads() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("archive.db")).unwrap();
        let id = store
            .begin_session("Large", &Inventory::default(), 1000)
            .unwrap();
        // Invalid payloads prove that the explicit sample-count guard runs
        // before allocating/deserializing the requested history.
        store.connection.execute(
            "WITH RECURSIVE numbers(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM numbers WHERE x<100001) INSERT INTO samples(session_id,timestamp_unix,elapsed_secs,payload) SELECT ?1,x,x,'{}' FROM numbers",
            [id],
        ).unwrap();
        let error = store.analysis_session(id, None).unwrap_err().to_string();
        assert!(error.contains("100000 campioni"));
        assert!(error.contains("100001"));
        assert!(store.analysis_session(-1, None).is_err());
    }
    #[test]
    fn backup_delete_cascade_and_import_export_are_real() {
        let d = tempfile::tempdir().unwrap();
        let mut store = Store::open(&d.path().join("archive.db")).unwrap();
        let id = store
            .begin_session("A", &Inventory::default(), 1000)
            .unwrap();
        store.append_sample(id, &sample(40.0, 0.0)).unwrap();
        store
            .save_llm(
                Some(id),
                &BenchmarkResult {
                    model: "example".into(),
                    ..Default::default()
                },
                false,
            )
            .unwrap();
        store.finish_session(id).unwrap();
        let exported = d.path().join("session.json");
        store.export_session(id, &exported).unwrap();
        assert!(store.export_session(id, &exported).is_err());
        let imported = store.import_session(&exported).unwrap();
        assert_ne!(imported, id);
        assert_eq!(
            store.load_session(imported, 100).unwrap().benchmarks.len(),
            1
        );
        let backup = d.path().join("backup.db");
        store.backup(&backup).unwrap();
        assert!(store.backup(&backup).is_err());
        store.delete_session(id).unwrap();
        assert!(store.load_session(id, 10).is_err());
        let restored = Store::open(&backup).unwrap();
        assert_eq!(restored.list_sessions(10).unwrap().len(), 2);
        assert_eq!(restored.quick_check().unwrap(), "ok");
    }
    #[test]
    fn session_roundtrip_preserves_capture_dates_interval_and_benchmark_dates() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("archive.db")).unwrap();
        let id = store
            .begin_session_with_sample(
                "Historical",
                &Inventory::default(),
                2500,
                &sample(20.0, 0.0),
            )
            .unwrap();
        store.finish_session(id).unwrap();
        let started = "2024-02-03T10:00:00+00:00";
        let ended = "2024-02-03T10:15:00+00:00";
        let recorded = "2024-02-03T10:05:00+00:00";
        store
            .connection
            .execute(
                "UPDATE sessions SET started_utc=?2,ended_utc=?3 WHERE id=?1",
                params![id, started, ended],
            )
            .unwrap();
        let benchmark_id = store
            .save_llm(Some(id), &BenchmarkResult::default(), false)
            .unwrap();
        store
            .connection
            .execute(
                "UPDATE benchmarks SET recorded_utc=?2 WHERE id=?1",
                params![benchmark_id, recorded],
            )
            .unwrap();
        let path = dir.path().join("historical.json");
        store.export_session(id, &path).unwrap();
        let imported = store.import_session(&path).unwrap();
        let data = store.load_session(imported, 10).unwrap();
        assert_eq!(data.summary.started_utc, started);
        assert_eq!(data.summary.ended_utc.as_deref(), Some(ended));
        assert_eq!(data.summary.interval_ms, 2500);
        assert_eq!(data.benchmarks[0].recorded_utc, recorded);

        // Existing format-v1 files have no interval; import remains compatible.
        let mut legacy: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        legacy["summary"]
            .as_object_mut()
            .unwrap()
            .remove("interval_ms");
        let path = dir.path().join("legacy.json");
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let imported = store.import_session(&path).unwrap();
        assert_eq!(
            store
                .load_session(imported, 10)
                .unwrap()
                .summary
                .interval_ms,
            1000
        );
    }
    #[test]
    fn snapshot_import_preserves_capture_time() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("archive.db")).unwrap();
        let captured = "2024-02-03T10:00:00Z";
        let value = serde_json::json!({
            "schema_version": 1,
            "captured_utc": captured,
            "inventory": Inventory::default(),
            "snapshot": sample(20.0, 0.0)
        });
        let path = dir.path().join("snapshot.json");
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        let id = store.import_session(&path).unwrap();
        let summary = store.load_session(id, 10).unwrap().summary;
        assert_eq!(summary.started_utc, captured);
        assert_eq!(summary.ended_utc.as_deref(), Some(captured));
    }
    #[test]
    fn export_preserves_events_beyond_ui_and_import_limits() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("archive.db")).unwrap();
        let id = store
            .begin_session("Long session", &Inventory::default(), 1000)
            .unwrap();
        let benchmark = serde_json::to_string(&BenchmarkResult::default()).unwrap();
        let alert = serde_json::to_string(&AlertEvent {
            timestamp_unix: 123,
            kind: "cpu".into(),
            message: "CPU".into(),
            value: 99.0,
            threshold: 95.0,
        })
        .unwrap();
        let tx = store.connection.transaction().unwrap();
        for index in 0..10001 {
            tx.execute("INSERT INTO benchmarks(session_id,recorded_utc,kind,payload) VALUES(?1,?2,'llm',?3)", params![id, index.to_string(), benchmark]).unwrap();
            tx.execute(
                "INSERT INTO alerts(session_id,payload) VALUES(?1,?2)",
                params![id, alert],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let path = dir.path().join("all-events.json");
        store.export_session(id, &path).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["benchmarks"].as_array().unwrap().len(), 10001);
        assert_eq!(value["alerts"].as_array().unwrap().len(), 10001);
        assert_eq!(value["summary"]["benchmark_count"], 10001);
        assert_eq!(store.benchmarks(Some(id), usize::MAX).unwrap().len(), 10000);
        assert_eq!(store.alerts(Some(id), usize::MAX).unwrap().len(), 10000);
        // The documented import guard remains explicit and transactional.
        assert!(store.import_session(&path).is_err());
        assert_eq!(store.list_sessions(10).unwrap().len(), 1);
    }
    #[test]
    fn rejects_other_databases_and_future_versions_without_mutating() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("other.db");
        {
            let c = Connection::open(&p).unwrap();
            c.execute("CREATE TABLE unrelated(id INTEGER)", []).unwrap();
        }
        assert!(Store::open(&p).is_err());
        let p = d.path().join("future.db");
        {
            let c = Connection::open(&p).unwrap();
            c.pragma_update(None, "user_version", 99).unwrap();
        }
        assert!(Store::open(&p).is_err());
    }
    #[test]
    fn invalid_import_rolls_back_everything() {
        let d = tempfile::tempdir().unwrap();
        let mut store = Store::open(&d.path().join("archive.db")).unwrap();
        let data = SessionData {
            summary: SessionSummary {
                name: "invalid".into(),
                ..Default::default()
            },
            benchmarks: vec![SavedBenchmark {
                kind: "wrong".into(),
                llm: Some(BenchmarkResult::default()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut v = serde_json::to_value(data).unwrap();
        v["format_version"] = 1.into();
        let p = d.path().join("invalid.json");
        fs::write(&p, serde_json::to_vec(&v).unwrap()).unwrap();
        assert!(store.import_session(&p).is_err());
        assert!(store.list_sessions(10).unwrap().is_empty());
    }
    #[test]
    fn failed_first_sample_does_not_leave_an_open_session() {
        let d = tempfile::tempdir().unwrap();
        let mut store = Store::open(&d.path().join("archive.db")).unwrap();
        assert!(
            store
                .begin_session_with_sample("A", &Inventory::default(), 1000, &sample(f32::NAN, 0.0))
                .is_err()
        );
        assert!(store.list_sessions(10).unwrap().is_empty());
        let id = store
            .begin_session_with_sample("B", &Inventory::default(), 1000, &sample(25.0, 0.0))
            .unwrap();
        assert_eq!(store.load_session(id, 10).unwrap().total_samples, 1);
    }
    #[test]
    fn recovery_interrupts_open_sessions_beyond_the_ui_listing_limit() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("archive.db")).unwrap();
        let inventory = serde_json::to_string(&Inventory::default()).unwrap();
        let tx = store.connection.transaction().unwrap();
        for index in 0..5002 {
            tx.execute("INSERT INTO sessions(name,started_utc,state,interval_ms,app_version,inventory_json) VALUES(?1,'2026-01-01T00:00:00Z','open',1000,'test',?2)", params![format!("open-{index}"), inventory]).unwrap();
        }
        tx.execute("INSERT INTO sessions(name,started_utc,ended_utc,state,interval_ms,app_version,inventory_json) VALUES('closed','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','complete',1000,'test',?1)", [inventory]).unwrap();
        tx.commit().unwrap();
        assert_eq!(store.interrupt_open_sessions().unwrap(), 5002);
        assert_eq!(store.interrupt_open_sessions().unwrap(), 0);
        let incomplete: i64 = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE state='incomplete' AND ended_utc IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(incomplete, 5002);
        let ended: String = store
            .connection
            .query_row(
                "SELECT ended_utc FROM sessions WHERE name='closed' AND state='complete'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ended, "2026-01-02T00:00:00Z");
    }
    #[test]
    fn invalid_nested_numeric_fields_cannot_commit_an_unreadable_replay_payload() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("archive.db")).unwrap();
        let valid = sample(25.0, 0.0);
        let id = store
            .begin_session_with_sample("healthy", &Inventory::default(), 1000, &valid)
            .unwrap();
        let mut invalid = Vec::new();
        let mut s = valid.clone();
        s.per_core[0] = f32::NAN;
        invalid.push(s);
        let mut s = valid.clone();
        s.sensors.push(crate::model::SensorRow {
            name: "CPU".into(),
            temperature: f32::INFINITY,
        });
        invalid.push(s);
        let mut s = valid.clone();
        s.processes[0].cpu_percent = f32::NAN;
        invalid.push(s);
        let mut s = valid.clone();
        s.processes[0].read_bytes_per_sec = f64::INFINITY;
        invalid.push(s);
        let mut s = valid.clone();
        s.disks.push(crate::model::DiskRow {
            write_bytes_per_sec: f64::NAN,
            ..Default::default()
        });
        invalid.push(s);
        let mut s = valid;
        s.networks.push(crate::model::NetworkRow {
            transmitted_per_sec: f64::INFINITY,
            ..Default::default()
        });
        invalid.push(s);
        for value in invalid {
            assert!(store.append_sample(id, &value).is_err());
            assert_eq!(store.load_session(id, 10).unwrap().total_samples, 1);
            assert!(
                store
                    .begin_session_with_sample("invalid", &Inventory::default(), 1000, &value)
                    .is_err()
            );
        }
        assert_eq!(store.list_sessions(100).unwrap().len(), 1);
        assert_eq!(store.quick_check().unwrap(), "ok");
    }
    #[test]
    fn nonfinite_benchmark_or_alert_payloads_do_not_poison_history() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("archive.db")).unwrap();
        let cpu = CpuBenchmark {
            single_ops_per_sec: f64::NAN,
            multi_ops_per_sec: 1.0,
            threads: 1,
            duration_secs: 1.0,
            build_profile: "test".into(),
            algorithm: "test".into(),
        };
        assert!(store.save_cpu(None, &cpu).is_err());
        assert!(
            store
                .save_llm(
                    None,
                    &BenchmarkResult {
                        wall_seconds: f64::INFINITY,
                        ..Default::default()
                    },
                    false
                )
                .is_err()
        );
        assert!(
            store
                .save_alert(
                    None,
                    &AlertEvent {
                        timestamp_unix: 1,
                        kind: "test".into(),
                        message: "test".into(),
                        value: f64::NAN,
                        threshold: 80.0
                    }
                )
                .is_err()
        );
        assert!(store.benchmarks(None, 100).unwrap().is_empty());
        assert!(store.alerts(None, 100).unwrap().is_empty());
    }
    #[test]
    fn inconsistent_import_benchmark_payloads_roll_back_without_poisoning_history() {
        let d = tempfile::tempdir().unwrap();
        let mut store = Store::open(&d.path().join("archive.db")).unwrap();
        let healthy = store
            .begin_session("healthy", &Inventory::default(), 1000)
            .unwrap();
        store
            .save_llm(Some(healthy), &BenchmarkResult::default(), false)
            .unwrap();
        let cpu = CpuBenchmark {
            build_profile: "test".into(),
            single_ops_per_sec: 1.0,
            multi_ops_per_sec: 2.0,
            threads: 2,
            duration_secs: 1.2,
            algorithm: "mix64 test".into(),
        };
        let invalid = [
            SavedBenchmark {
                kind: "cpu".into(),
                llm: Some(BenchmarkResult::default()),
                ..Default::default()
            },
            SavedBenchmark {
                kind: "llm".into(),
                cpu: Some(cpu.clone()),
                ..Default::default()
            },
            SavedBenchmark {
                kind: "observed".into(),
                cpu: Some(cpu),
                llm: Some(BenchmarkResult::default()),
                ..Default::default()
            },
            SavedBenchmark {
                kind: "cpu".into(),
                ..Default::default()
            },
        ];
        for (i, benchmark) in invalid.into_iter().enumerate() {
            let data = SessionData {
                summary: SessionSummary {
                    name: "invalid".into(),
                    ..Default::default()
                },
                benchmarks: vec![benchmark],
                samples: vec![sample(10.0, 0.0)],
                ..Default::default()
            };
            let mut value = serde_json::to_value(data).unwrap();
            value["format_version"] = 1.into();
            let path = d.path().join(format!("invalid-{i}.json"));
            fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
            assert!(store.import_session(&path).is_err());
            assert_eq!(store.list_sessions(10).unwrap().len(), 1);
            assert_eq!(store.benchmarks(None, 10).unwrap().len(), 1);
        }
    }
    #[test]
    fn busy_backup_has_a_deadline_cleans_partial_file_and_restores_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("source.db")).unwrap();
        let id = store
            .begin_session("locked", &Inventory::default(), 1000)
            .unwrap();
        store.connection.execute_batch("BEGIN IMMEDIATE").unwrap();
        let destination = dir.path().join("backup.db");
        let started = Instant::now();
        let result = store.backup_with_limit(&destination, Duration::from_millis(20));
        store.connection.execute_batch("ROLLBACK").unwrap();
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(!destination.exists());
        let timeout: i64 = store
            .connection
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .unwrap();
        assert_eq!(timeout, 2000);
        assert_eq!(store.session_state(id).unwrap(), "open");
        assert_eq!(store.quick_check().unwrap(), "ok");
    }
    #[test]
    fn imported_versions_and_gpu_sources_preserve_origin_and_warn_on_comparison() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("archive.db")).unwrap();
        let snapshot = |source: &str| Snapshot {
            gpus: vec![crate::model::GpuRow {
                name: "GPU".into(),
                source: source.into(),
                utilization: Some(30.0),
                ..Default::default()
            }],
            ..sample(10.0, 0.0)
        };
        let report = serde_json::json!({ "schema_version": 1, "app_version": "0.1.0", "inventory": Inventory::default(), "snapshot": snapshot("nvidia-smi") });
        let path = dir.path().join("legacy.json");
        fs::write(&path, serde_json::to_vec(&report).unwrap()).unwrap();
        let left = store.import_session(&path).unwrap();
        assert_eq!(
            store.load_session(left, 10).unwrap().summary.app_version,
            "0.1.0"
        );
        let right = store
            .begin_session_with_sample(
                "current",
                &Inventory::default(),
                1000,
                &snapshot("Windows WDDM PDH/DXGI"),
            )
            .unwrap();
        store.finish_session(right).unwrap();
        let comparison = store.compare(left, right).unwrap();
        assert!(
            comparison
                .warnings
                .iter()
                .any(|warning| warning.contains("Provider GPU0 differenti"))
        );
        assert!(
            comparison
                .warnings
                .iter()
                .any(|warning| warning.contains("Versioni RUST-CPU di origine differenti"))
        );
        let exported = dir.path().join("session.json");
        store.export_session(left, &exported).unwrap();
        let roundtrip = store.import_session(&exported).unwrap();
        assert_eq!(
            store
                .load_session(roundtrip, 10)
                .unwrap()
                .summary
                .app_version,
            "0.1.0"
        );
    }
    #[test]
    fn import_without_origin_version_keeps_unknown_instead_of_claiming_current_build() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("archive.db")).unwrap();
        let report = serde_json::json!({ "schema_version": 1, "inventory": Inventory::default(), "snapshot": sample(10.0, 0.0) });
        let path = dir.path().join("unknown.json");
        fs::write(&path, serde_json::to_vec(&report).unwrap()).unwrap();
        let imported = store.import_session(&path).unwrap();
        assert!(
            store
                .load_session(imported, 10)
                .unwrap()
                .summary
                .app_version
                .is_empty()
        );
    }
    #[test]
    fn legacy_missing_method_fields_keep_means_but_never_claim_comparable_deltas() {
        fn old_cpu(rate: f64) -> SavedBenchmark {
            let cpu: CpuBenchmark = serde_json::from_value(serde_json::json!({
                "single_ops_per_sec": rate, "multi_ops_per_sec": rate * 2.0,
                "threads": 2, "duration_secs": 1.2, "algorithm": "mix64 v1"
            }))
            .unwrap();
            SavedBenchmark {
                kind: "cpu".into(),
                cpu: Some(cpu),
                ..Default::default()
            }
        }
        fn old_llm(rate: f64) -> SavedBenchmark {
            let mut json = serde_json::to_value(BenchmarkResult {
                runtime: "ollama".into(),
                model: "same-model".into(),
                generation_tokens_per_sec: Some(rate),
                time_to_first_token_ms: Some(100.0),
                wall_seconds: 1.0,
                ..Default::default()
            })
            .unwrap();
            json.as_object_mut().unwrap().remove("throughput_kind");
            SavedBenchmark {
                kind: "llm".into(),
                llm: Some(serde_json::from_value(json).unwrap()),
                ..Default::default()
            }
        }
        let groups = compare_benchmarks(
            &[old_cpu(100.0), old_llm(10.0)],
            &[old_cpu(200.0), old_llm(20.0)],
        );
        assert_eq!(groups.len(), 2);
        let cpu = groups.iter().find(|group| group.kind == "cpu").unwrap();
        let llm = groups.iter().find(|group| group.kind == "llm").unwrap();
        assert_eq!(
            (cpu.metrics[0].left, cpu.metrics[0].right),
            (Some(100.0), Some(200.0))
        );
        assert_eq!(
            (llm.metrics[0].left, llm.metrics[0].right),
            (Some(10.0), Some(20.0))
        );
        for group in &groups {
            assert_eq!(group.method, "unknown");
            assert!(
                group
                    .metrics
                    .iter()
                    .all(|metric| metric.delta.is_none() && metric.delta_percent.is_none())
            );
        }
        assert!(
            cpu.warnings
                .iter()
                .any(|warning| warning.contains("compilazione CPU"))
        );
        assert!(
            llm.warnings
                .iter()
                .any(|warning| warning.contains("decode nativo/end-to-end"))
        );
    }
    #[test]
    fn known_native_end_to_end_and_observed_groups_stay_separate_with_zero_baseline() {
        let run = |kind: &str, method: &str, rate: f64| SavedBenchmark {
            kind: kind.into(),
            llm: Some(BenchmarkResult {
                runtime: "ollama".into(),
                model: "same-model".into(),
                throughput_kind: method.into(),
                generation_tokens_per_sec: Some(rate),
                ..Default::default()
            }),
            ..Default::default()
        };
        let groups = compare_benchmarks(
            &[
                run("llm", "native_decode", 0.0),
                run("observed", "native_decode", 30.0),
            ],
            &[
                run("llm", "native_decode", 10.0),
                run("llm", "end_to_end", 20.0),
            ],
        );
        assert_eq!(groups.len(), 3);
        let native = groups
            .iter()
            .find(|group| {
                group.label.starts_with("llm |") && group.label.ends_with("native_decode")
            })
            .unwrap();
        assert_eq!((native.runs_left, native.runs_right), (1, 1));
        assert_eq!(native.metrics[0].delta, Some(10.0));
        assert_eq!(native.metrics[0].delta_percent, None);
        let end_to_end = groups
            .iter()
            .find(|group| group.label.ends_with("end_to_end"))
            .unwrap();
        assert_eq!((end_to_end.runs_left, end_to_end.runs_right), (0, 1));
        assert_eq!(end_to_end.metrics[0].right, Some(20.0));
        assert_eq!(end_to_end.metrics[0].delta, None);
        let observed = groups
            .iter()
            .find(|group| group.label.starts_with("observed |"))
            .unwrap();
        assert_eq!((observed.runs_left, observed.runs_right), (1, 0));
        assert!(groups.iter().all(|group| group.method != "unknown"));
    }
    #[test]
    fn known_llm_mean_population_stddev_and_median_are_preserved() {
        let run = |rate| SavedBenchmark {
            kind: "llm".into(),
            llm: Some(BenchmarkResult {
                runtime: "ollama".into(),
                model: "same-model".into(),
                throughput_kind: "native_decode".into(),
                generation_tokens_per_sec: Some(rate),
                ..Default::default()
            }),
            ..Default::default()
        };
        let groups = compare_benchmarks(&[run(10.0), run(20.0)], &[run(30.0), run(40.0)]);
        assert_eq!(groups.len(), 1);
        let metrics = &groups[0].metrics;
        assert_eq!(
            (metrics[0].left, metrics[0].right, metrics[0].delta),
            (Some(15.0), Some(35.0), Some(20.0))
        );
        assert_eq!((metrics[1].left, metrics[1].right), (Some(5.0), Some(5.0)));
        assert_eq!(
            (metrics[2].left, metrics[2].right),
            (Some(15.0), Some(35.0))
        );
    }
}
