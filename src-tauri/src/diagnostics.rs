//! Evidence-based observations, never a diagnosis of a defective component.
use rust_cpu::{analysis::AnalysisReport, model::Snapshot, settings::Preferences};
use serde::Serialize;

#[derive(Serialize)]
pub struct Finding {
    pub id: String,
    pub severity: String,
    pub title: String,
    pub message: String,
    pub evidence: String,
    pub recommendation: String,
}
#[derive(Serialize)]
pub struct DiagnosticReport {
    pub scope: String,
    pub samples: usize,
    pub findings: Vec<Finding>,
    pub summary: String,
}
fn finding(
    id: &str,
    severity: &str,
    title: &str,
    message: &str,
    evidence: String,
    recommendation: &str,
) -> Finding {
    Finding {
        id: id.into(),
        severity: severity.into(),
        title: title.into(),
        message: message.into(),
        evidence,
        recommendation: recommendation.into(),
    }
}
fn is_cpu_temperature(name: &str) -> bool {
    let name = name.to_lowercase();
    !name.contains("gpu")
        && !name.contains("graphics")
        && (name.contains("cpu") || name.contains("package") || name.contains("tctl"))
}
fn stale_after_seconds(interval_ms: u64) -> u64 {
    interval_ms.saturating_mul(3).div_ceil(1000).max(8)
}
pub fn analyze(
    report: &AnalysisReport,
    latest: Option<&Snapshot>,
    p: &Preferences,
    error: Option<&str>,
    live: bool,
) -> DiagnosticReport {
    let mut findings = Vec::new();
    if let Some(error) = error {
        findings.push(finding("runtime", "error", "Errore del monitor", "Un'operazione di raccolta o archivio ha segnalato un errore.", error.into(), "Verificare il percorso dell'archivio, lo spazio disponibile e gli avvisi del provider."));
    }
    if report.samples == 0 {
        findings.push(finding(
            "no-samples",
            "info",
            "Nessun campione da analizzare",
            "L'assenza di misure non dimostra un problema hardware.",
            "0 campioni".into(),
            "Attendere la raccolta o scegliere una sessione con campioni.",
        ));
    }
    for m in &report.metrics {
        let invalid_percentage = m.unit == "%"
            && (m.statistics.min.is_some_and(|v| v < 0.0)
                || m.statistics.max.is_some_and(|v| v > 100.0));
        if invalid_percentage {
            findings.push(finding(&format!("quality-{}", m.id), "warning", "Percentuale fuori intervallo", "La serie contiene valori fuori da 0–100%; il segnale riguarda la qualità della misura, non dimostra un carico reale oltre la capacità.", format!("{}: minimo {:?}, massimo {:?}", m.label, m.statistics.min, m.statistics.max), "Verificare unità, provider e dati importati. I valori originali restano disponibili nell'analisi."));
        }
        let threshold = match m.id.as_str() {
            "cpu.total" => Some((p.alerts.cpu_percent, "Carico CPU elevato")),
            "ram.percent" => Some((p.alerts.ram_percent, "Pressione sulla memoria RAM")),
            _ if m.id.starts_with("gpu.") && m.id.ends_with(".temperature") => {
                Some((p.alerts.gpu_temperature_c, "Temperatura GPU oltre soglia"))
            }
            _ => None,
        };
        if let Some((threshold, title)) = threshold.filter(|_| !invalid_percentage) {
            let temperature = m.unit == "°C";
            let value = if temperature {
                m.statistics.max
            } else {
                m.statistics.mean
            };
            if let Some(value) = value.filter(|value| *value >= threshold) {
                findings.push(finding(&m.id, "warning", title,
                    if temperature { "È stato osservato almeno un valore oltre la soglia configurata." } else { "La media dei campioni disponibili supera la soglia configurata." },
                    format!("{}: {} {:.1}{}; soglia {:.1}{}; {} misure valide, {} mancanti", m.label, if temperature { "massimo" } else { "media" }, value, m.unit, threshold, m.unit, m.statistics.count, m.statistics.missing),
                    "Confrontare con il carico in corso e le specifiche del produttore; questo segnale non identifica la causa né dimostra un guasto."));
            }
        }
        if m.statistics.missing > 0
            && (m.id == "cpu.total"
                || m.id.ends_with(".utilization")
                || m.id.ends_with(".temperature"))
        {
            findings.push(finding(&format!("missing-{}", m.id), "info", "Misure non disponibili", "I dati mancanti non sono stati trasformati in zeri.", format!("{}: {} di {} campioni senza misura", m.label, m.statistics.missing, report.samples), "Verificare disponibilità e aggiornamento del provider. Una temperatura non esposta non è un'anomalia termica."));
        }
        if m.id.starts_with("gpu.") && m.id.ends_with(".memory_used") {
            let prefix = m.id.trim_end_matches(".memory_used");
            if let Some(s) = latest {
                let index = prefix
                    .strip_prefix("gpu.")
                    .and_then(|v| v.parse::<usize>().ok());
                if let Some(gpu) = index.and_then(|i| s.gpus.get(i))
                    && let (Some(used), Some(total)) = (gpu.memory_used, gpu.memory_total)
                    && total > 0
                {
                    let percent = used as f64 / total as f64 * 100.0;
                    if used > total {
                        findings.push(finding(&format!("quality-vram-{prefix}"), "warning", "Contatori VRAM incoerenti", "La memoria dedicata usata supera la capacità dichiarata: non viene classificata come normale pressione sulla memoria.", format!("{}: {} byte usati su {} byte dichiarati", gpu.name, used, total), "Verificare provider, unità e identità dell'adattatore."));
                    } else if percent >= p.alerts.vram_percent {
                        findings.push(finding(&format!("vram-{prefix}"), "warning", "Memoria GPU dedicata quasi piena", "L'ultimo campione raggiunge la soglia VRAM configurata.", format!("{}: {:.1}%; soglia {:.1}%", gpu.name, percent, p.alerts.vram_percent), "Ridurre il carico o confrontare modelli e offload. La memoria condivisa resta distinta dalla dedicata."));
                    }
                }
            }
        }
    }
    let core_means: Vec<_> = report
        .metrics
        .iter()
        .filter(|m| m.id.starts_with("cpu.core."))
        .filter_map(|m| m.statistics.mean.map(|v| (&m.label, v)))
        .collect();
    if let (Some(low), Some(high)) = (
        core_means.iter().min_by(|a, b| a.1.total_cmp(&b.1)),
        core_means.iter().max_by(|a, b| a.1.total_cmp(&b.1)),
    ) && high.1 - low.1 >= 50.0
    {
        findings.push(finding("core-imbalance", "info", "Carico distribuito in modo diseguale", "Alcuni thread logici sono molto più impegnati di altri; può essere normale per carichi poco paralleli.", format!("{}: media {:.1}%; {}: media {:.1}%", low.0, low.1, high.0, high.1), "Usare il grafico per thread e l'elenco processi per contestualizzare. Non indica un core difettoso."));
    }
    if let Some(s) = latest {
        for sensor in &s.sensors {
            if !is_cpu_temperature(&sensor.name) {
                continue;
            }
            if !sensor.temperature.is_finite() {
                findings.push(finding("quality-cpu-temperature", "warning", "Temperatura CPU non valida", "Il provider ha restituito un valore non finito, escluso dai segnali termici.", sensor.name.clone(), "Verificare disponibilità e unità del sensore; non è una prova di surriscaldamento."));
            } else if f64::from(sensor.temperature) >= p.alerts.cpu_temperature_c {
                findings.push(finding(
                    "cpu-temperature",
                    "warning",
                    "Temperatura CPU oltre soglia",
                    "L'ultimo valore disponibile supera la soglia configurata.",
                    format!(
                        "{}: {:.1}°C, soglia {:.1}°C",
                        sensor.name, sensor.temperature, p.alerts.cpu_temperature_c
                    ),
                    "Controllare carico e raffreddamento e confrontare il limite del produttore.",
                ));
            }
        }
        for (i, disk) in s.disks.iter().enumerate() {
            if disk.total_bytes > 0 && disk.available_bytes > disk.total_bytes {
                findings.push(finding(&format!("quality-disk-{i}"), "warning", "Capacità del volume incoerente", "Lo spazio disponibile supera la capacità dichiarata nel campione.", format!("{}: {} byte disponibili su {} byte totali", disk.mount, disk.available_bytes, disk.total_bytes), "Verificare la fonte dei contatori prima di interpretare l'occupazione del volume."));
                continue;
            }
            if disk.total_bytes > 0 && disk.available_bytes as f64 / disk.total_bytes as f64 <= 0.05
            {
                findings.push(finding(&format!("disk-space-{i}"), "warning", "Spazio disco ridotto", "Il volume ha al massimo il 5% di spazio disponibile nell'ultimo campione.", format!("{}: {:.1} GiB liberi su {:.1} GiB", disk.mount, disk.available_bytes as f64 / 1073741824.0, disk.total_bytes as f64 / 1073741824.0), "Controllare i file e pianificare spazio aggiuntivo prima di registrazioni lunghe. Nessun file viene eliminato dall'app."));
            }
        }
        if live {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if s.timestamp_unix > now.saturating_add(5) {
                findings.push(finding("future-timestamp", "warning", "Ora del campione nel futuro", "L'ora del campione è successiva all'orologio corrente; l'età della misura non è interpretabile normalmente.", format!("Campione Unix {}, ora corrente Unix {}", s.timestamp_unix, now), "Verificare l'orologio di sistema e l'origine dei dati."));
            } else if now.saturating_sub(s.timestamp_unix) > stale_after_seconds(p.interval_ms) {
                findings.push(finding(
                    "stale",
                    "warning",
                    "Campione live in ritardo",
                    "La raccolta non si aggiorna entro l'attesa prevista.",
                    format!(
                        "Ultimo campione {} secondi fa",
                        now.saturating_sub(s.timestamp_unix)
                    ),
                    "Consultare gli avvisi del collector e verificare se un provider è bloccato.",
                ));
            }
        }
        for (i, warning) in s.warnings.iter().enumerate() {
            findings.push(finding(&format!("collector-{i}"), "info", "Avviso del collector", "Una fonte ha segnalato un limite o un dato mancante.", warning.clone(), "Consultare fonti e disponibilità nella diagnostica; l'avviso non dimostra da solo un guasto hardware."));
        }
    }
    for (i, warning) in report.warnings.iter().enumerate() {
        findings.push(finding(&format!("analysis-{i}"), "info", "Limite dell'analisi", "La qualità o il metodo dei dati richiede attenzione.", warning.clone(), "Interpretare i risultati nel contesto della finestra e delle misure effettivamente disponibili."));
    }
    let warnings = findings.iter().filter(|f| f.severity == "warning").count();
    let errors = findings.iter().filter(|f| f.severity == "error").count();
    let summary = format!(
        "{} campioni analizzati: {} errori del monitor, {} segnali da approfondire. Le misure descrivono il periodo selezionato e non certificano lo stato dell'hardware.",
        report.samples, errors, warnings
    );
    DiagnosticReport {
        scope: report.source.clone(),
        samples: report.samples,
        findings,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zero_and_unavailable_never_become_hardware_faults() {
        let report = rust_cpu::analysis::analyze_snapshots(&[], "test");
        let result = analyze(&report, None, &Preferences::default(), None, false);
        assert!(result.findings.iter().all(|f| f.severity == "info"));
    }
    #[test]
    fn real_pressure_and_disk_space_have_explicit_evidence() {
        let sample = Snapshot {
            cpu_percent: 99.0,
            per_core: vec![99.0],
            memory_used: 99,
            memory_total: 100,
            disks: vec![rust_cpu::model::DiskRow {
                total_bytes: 100,
                available_bytes: 1,
                ..Default::default()
            }],
            ..Default::default()
        };
        let report = rust_cpu::analysis::analyze_snapshots(std::slice::from_ref(&sample), "test");
        let result = analyze(&report, Some(&sample), &Preferences::default(), None, false);
        assert!(
            result
                .findings
                .iter()
                .any(|f| f.id == "cpu.total" && f.severity == "warning")
        );
        assert!(
            result
                .findings
                .iter()
                .any(|f| f.id.starts_with("disk-space"))
        );
        assert!(result.findings.iter().all(|f| f.severity != "error"));
    }
    #[test]
    fn invalid_data_and_gpu_package_are_not_reported_as_cpu_overheating_or_pressure() {
        let sample = Snapshot {
            cpu_percent: 120.0,
            per_core: vec![120.0],
            sensors: vec![
                rust_cpu::model::SensorRow {
                    name: "GPU Package".into(),
                    temperature: 110.0,
                },
                rust_cpu::model::SensorRow {
                    name: "CPU Package".into(),
                    temperature: f32::INFINITY,
                },
            ],
            gpus: vec![rust_cpu::model::GpuRow {
                name: "GPU".into(),
                memory_used: Some(200),
                memory_total: Some(100),
                ..Default::default()
            }],
            ..Default::default()
        };
        let report =
            rust_cpu::analysis::analyze_snapshots(std::slice::from_ref(&sample), "quality");
        let result = analyze(&report, Some(&sample), &Preferences::default(), None, false);
        assert!(result.findings.iter().any(|f| f.id == "quality-cpu.total"));
        assert!(
            result
                .findings
                .iter()
                .any(|f| f.id == "quality-cpu-temperature")
        );
        assert!(result.findings.iter().any(|f| f.id == "quality-vram-gpu.0"));
        assert!(
            !result
                .findings
                .iter()
                .any(|f| f.id == "cpu-temperature" || f.id == "cpu.total" || f.id == "vram-gpu.0")
        );
        assert!(!is_cpu_temperature("GPU Package"));
        assert!(is_cpu_temperature("CPU Package"));
    }
    #[test]
    fn fractional_sampling_intervals_are_not_rounded_down_for_staleness() {
        assert_eq!(stale_after_seconds(500), 8);
        assert_eq!(stale_after_seconds(9500), 29);
        assert_eq!(stale_after_seconds(10000), 30);
    }
}
