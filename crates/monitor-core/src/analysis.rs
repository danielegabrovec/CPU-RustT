//! Descriptive statistics over recorded measurements. No inference or causal claims.
use crate::model::Snapshot;
use serde::{Deserialize, Serialize};

const MAX_POINTS: usize = 1000;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AnalysisReport {
    pub source: String,
    pub samples: usize,
    pub start_unix: Option<u64>,
    pub end_unix: Option<u64>,
    pub duration_secs: f64,
    pub metrics: Vec<MetricAnalysis>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MetricAnalysis {
    pub id: String,
    pub label: String,
    pub unit: String,
    pub statistics: Statistics,
    pub points: Vec<AnalysisPoint>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Statistics {
    pub count: usize,
    pub missing: usize,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub mean: Option<f64>,
    pub median: Option<f64>,
    pub p95: Option<f64>,
    pub std_dev: Option<f64>,
    pub delta: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AnalysisPoint {
    pub timestamp_unix: u64,
    pub elapsed_secs: f64,
    pub value: Option<f64>,
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite())
}

fn statistics(values: &[f64], total: usize) -> Statistics {
    let mut result = Statistics {
        count: values.len(),
        missing: total.saturating_sub(values.len()),
        ..Default::default()
    };
    if values.is_empty() {
        return result;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let count = sorted.len();
    result.min = sorted.first().copied();
    result.max = sorted.last().copied();
    result.median = Some(if count.is_multiple_of(2) {
        sorted[count / 2 - 1] / 2.0 + sorted[count / 2] / 2.0
    } else {
        sorted[count / 2]
    });
    result.p95 = Some(sorted[count.saturating_mul(95).div_ceil(100) - 1]);
    // Scaling avoids overflowing the sum/variance for finite extreme inputs.
    let scale = values.iter().map(|v| v.abs()).fold(0.0, f64::max);
    if scale == 0.0 {
        result.mean = Some(0.0);
        result.std_dev = (count > 1).then_some(0.0);
    } else {
        let normalized_mean = values.iter().map(|v| v / scale).sum::<f64>() / count as f64;
        // Preserve ordinary exact integer means without unnecessary scaling;
        // use the normalized fallback only if the direct sum overflows.
        result.mean = finite(Some(values.iter().sum::<f64>() / count as f64))
            .or_else(|| finite(Some(normalized_mean * scale)));
        if count > 1 {
            let variance = values
                .iter()
                .map(|v| (v / scale - normalized_mean).powi(2))
                .sum::<f64>()
                / (count - 1) as f64;
            result.std_dev = finite(Some(variance.sqrt() * scale));
        }
    }
    result.delta = finite(
        values
            .first()
            .zip(values.last())
            .map(|(first, last)| last - first),
    );
    result
}

fn add_metric(
    metrics: &mut Vec<MetricAnalysis>,
    samples: &[Snapshot],
    id: String,
    label: String,
    unit: &str,
    value: impl Fn(&Snapshot) -> Option<f64>,
) {
    let values = samples
        .iter()
        .filter_map(|s| finite(value(s)))
        .collect::<Vec<_>>();
    let length = samples.len().min(MAX_POINTS);
    let points = (0..length)
        .map(|index| {
            let index = if length <= 1 {
                0
            } else {
                index * (samples.len() - 1) / (length - 1)
            };
            let sample = &samples[index];
            AnalysisPoint {
                timestamp_unix: sample.timestamp_unix,
                // Invalid time metadata must not produce non-JSON numbers.
                elapsed_secs: if sample.elapsed_secs.is_finite() {
                    sample.elapsed_secs
                } else {
                    0.0
                },
                value: finite(value(sample)),
            }
        })
        .collect();
    metrics.push(MetricAnalysis {
        id,
        label,
        unit: unit.into(),
        statistics: statistics(&values, samples.len()),
        points,
    });
}

fn aggregate(values: impl Iterator<Item = f64>) -> Option<f64> {
    let values = values.collect::<Vec<_>>();
    if values.is_empty() || values.iter().any(|v| !v.is_finite()) {
        return None;
    }
    finite(Some(values.iter().sum()))
}

/// Analyze every supplied sample before thinning chart points to at most 1000.
/// Means give equal weight to samples; std_dev uses n-1 and P95 nearest rank.
/// Missing/nonfinite measurements are excluded and never converted to zero.
pub fn analyze_snapshots(samples: &[Snapshot], source: &str) -> AnalysisReport {
    let mut warnings = vec![
        "Statistiche descrittive: media dei campioni non pesata per tempo; deviazione standard campionaria (n−1); P95 a rango più vicino. Non dimostrano cause né prestazioni a parità di lavoro.".into(),
        "Delta = ultimo valore valido meno primo valore valido nell'ordine dei campioni; dati mancanti esclusi, zeri validi inclusi.".into(),
    ];
    if samples.is_empty() {
        warnings.push("Nessun campione disponibile nell'intervallo selezionato.".into());
    }
    if samples.len() > MAX_POINTS {
        warnings.push(format!("Grafici ridotti a {MAX_POINTS} punti distribuiti sull'intera serie; statistiche calcolate su tutti i {} campioni.", samples.len()));
    }
    if samples
        .windows(2)
        .any(|pair| pair[1].elapsed_secs < pair[0].elapsed_secs)
    {
        warnings.push("Tempo trascorso non monotono: delta e grafici seguono l'ordine dei campioni acquisiti.".into());
    }
    if samples.iter().any(|s| !s.elapsed_secs.is_finite()) {
        warnings.push("Metadati temporali non finiti: durata calcolata sui tempi validi; punti con tempo non valido rappresentati a 0 s.".into());
    }
    let core_count = samples.iter().map(|s| s.per_core.len()).max().unwrap_or(0);
    if samples.iter().any(|s| s.per_core.len() != core_count) {
        warnings.push("Numero di core logici registrati variabile o dati per core parziali: valori assenti mantenuti mancanti, senza ricostruzione.".into());
    }
    if core_count == 0 && !samples.is_empty() {
        warnings.push("Carichi per core non presenti nei campioni; nessuna topologia CPU ricostruita dal carico totale.".into());
    }
    let mut metrics = Vec::new();
    add_metric(
        &mut metrics,
        samples,
        "cpu.total".into(),
        "CPU totale".into(),
        "%",
        |s| (!s.per_core.is_empty()).then_some(f64::from(s.cpu_percent)),
    );
    for index in 0..core_count {
        add_metric(
            &mut metrics,
            samples,
            format!("cpu.core.{index}"),
            format!("CPU · core logico {}", index + 1),
            "%",
            |s| s.per_core.get(index).map(|v| f64::from(*v)),
        );
    }
    add_metric(
        &mut metrics,
        samples,
        "ram.percent".into(),
        "RAM utilizzata".into(),
        "%",
        |s| (s.memory_total > 0).then(|| s.memory_used as f64 / s.memory_total as f64 * 100.0),
    );
    add_metric(
        &mut metrics,
        samples,
        "ram.bytes".into(),
        "RAM utilizzata".into(),
        "B",
        |s| (s.memory_total > 0).then_some(s.memory_used as f64),
    );
    let gpu_count = samples.iter().map(|s| s.gpus.len()).max().unwrap_or(0);
    for index in 0..gpu_count {
        let name = samples
            .iter()
            .find_map(|s| s.gpus.get(index).map(|g| g.name.as_str()))
            .unwrap_or("");
        if samples
            .iter()
            .filter_map(|s| s.gpus.get(index))
            .any(|g| g.name != name)
        {
            warnings.push(format!("GPU {}: nome/ordine adattatore cambiato. Metriche riferite a «{name}»; gli adattatori diversi allo stesso indice sono mancanti.", index + 1));
        }
        let mut sources = samples
            .iter()
            .filter_map(|s| s.gpus.get(index))
            .filter(|g| g.name == name)
            .map(|g| g.source.as_str())
            .collect::<Vec<_>>();
        sources.sort_unstable();
        sources.dedup();
        if sources.len() > 1 {
            warnings.push(format!("GPU {} «{name}»: provider differenti nella serie ({}); confrontabilità delle misure da verificare.", index + 1, sources.join(" / ")));
        }
        for (suffix, label, unit) in [
            ("utilization", "Carico", "%"),
            ("memory_used", "Memoria dedicata", "B"),
            ("temperature", "Temperatura", "°C"),
            ("power", "Potenza", "W"),
            ("shared_memory_used", "Memoria condivisa", "B"),
        ] {
            add_metric(
                &mut metrics,
                samples,
                format!("gpu.{index}.{suffix}"),
                format!("{name} · {label}"),
                unit,
                |s| {
                    let gpu = s.gpus.get(index).filter(|g| g.name == name)?;
                    match suffix {
                        "utilization" => gpu.utilization.map(f64::from),
                        "memory_used" => gpu.memory_used.map(|v| v as f64),
                        "temperature" => gpu.temperature.map(f64::from),
                        "power" => gpu.power_watts.map(f64::from),
                        "shared_memory_used" => gpu.shared_memory_used.map(|v| v as f64),
                        _ => None,
                    }
                },
            );
        }
    }
    if samples.iter().any(|s| !s.disks.is_empty()) {
        add_metric(
            &mut metrics,
            samples,
            "disk.read_bytes_per_sec".into(),
            "Dischi · lettura totale".into(),
            "B/s",
            |s| aggregate(s.disks.iter().map(|d| d.read_bytes_per_sec)),
        );
        add_metric(
            &mut metrics,
            samples,
            "disk.write_bytes_per_sec".into(),
            "Dischi · scrittura totale".into(),
            "B/s",
            |s| aggregate(s.disks.iter().map(|d| d.write_bytes_per_sec)),
        );
    }
    if samples.iter().any(|s| !s.networks.is_empty()) {
        add_metric(
            &mut metrics,
            samples,
            "network.received_bytes_per_sec".into(),
            "Rete · ricezione totale".into(),
            "B/s",
            |s| aggregate(s.networks.iter().map(|n| n.received_per_sec)),
        );
        add_metric(
            &mut metrics,
            samples,
            "network.transmitted_bytes_per_sec".into(),
            "Rete · trasmissione totale".into(),
            "B/s",
            |s| aggregate(s.networks.iter().map(|n| n.transmitted_per_sec)),
        );
    }
    let invalid_percentages = metrics
        .iter()
        .filter(|metric| {
            metric.unit == "%"
                && (metric.statistics.min.is_some_and(|value| value < 0.0)
                    || metric.statistics.max.is_some_and(|value| value > 100.0))
        })
        .map(|metric| metric.id.as_str())
        .collect::<Vec<_>>();
    if !invalid_percentages.is_empty() {
        warnings.push(format!("{} metriche con percentuali fuori dall'intervallo 0–100% ({}{}). Le statistiche includono i valori originali: verificare provider e qualità dei dati.",
            invalid_percentages.len(), invalid_percentages.iter().take(8).copied().collect::<Vec<_>>().join(", "),
            if invalid_percentages.len() > 8 { ", …" } else { "" }));
    }
    let elapsed = samples
        .iter()
        .map(|s| s.elapsed_secs)
        .filter(|v| v.is_finite())
        .collect::<Vec<_>>();
    let duration_secs = elapsed
        .iter()
        .copied()
        .reduce(f64::max)
        .zip(elapsed.iter().copied().reduce(f64::min))
        .map_or(0.0, |(max, min)| (max - min).max(0.0));
    AnalysisReport {
        source: source.into(),
        samples: samples.len(),
        start_unix: samples.iter().map(|s| s.timestamp_unix).min(),
        end_unix: samples.iter().map(|s| s.timestamp_unix).max(),
        duration_secs: finite(Some(duration_secs)).unwrap_or(0.0),
        metrics,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::GpuRow;

    fn sample(cpu: f32, elapsed: f64) -> Snapshot {
        Snapshot {
            timestamp_unix: 100 + elapsed.max(0.0) as u64,
            elapsed_secs: elapsed,
            cpu_percent: cpu,
            per_core: vec![cpu, cpu / 2.0],
            memory_total: 1000,
            memory_used: cpu.max(0.0) as u64,
            ..Default::default()
        }
    }
    fn metric<'a>(report: &'a AnalysisReport, id: &str) -> &'a MetricAnalysis {
        report
            .metrics
            .iter()
            .find(|metric| metric.id == id)
            .unwrap()
    }
    #[test]
    fn known_statistics_include_zeros_and_use_sample_standard_deviation() {
        let report = analyze_snapshots(
            &[
                sample(0.0, 0.0),
                sample(10.0, 1.0),
                sample(20.0, 2.0),
                sample(30.0, 3.0),
            ],
            "test",
        );
        let stats = &metric(&report, "cpu.total").statistics;
        assert_eq!(stats.count, 4);
        assert_eq!(stats.missing, 0);
        assert_eq!(stats.min, Some(0.0));
        assert_eq!(stats.max, Some(30.0));
        assert_eq!(stats.mean, Some(15.0));
        assert_eq!(stats.median, Some(15.0));
        assert_eq!(stats.p95, Some(30.0));
        assert_eq!(stats.delta, Some(30.0));
        assert!((stats.std_dev.unwrap() - (500.0_f64 / 3.0).sqrt()).abs() < 1e-10);
        assert_eq!(report.duration_secs, 3.0);
        assert_eq!(report.start_unix, Some(100));
    }
    #[test]
    fn nearest_rank_percentile_and_odd_median_are_exact() {
        let samples = (1..=21)
            .map(|i| sample(i as f32, i as f64))
            .collect::<Vec<_>>();
        let report = analyze_snapshots(&samples, "test");
        let stats = &metric(&report, "cpu.total").statistics;
        assert_eq!(stats.median, Some(11.0));
        assert_eq!(stats.p95, Some(20.0));
    }
    #[test]
    fn nonfinite_values_are_missing_and_single_value_has_no_standard_deviation() {
        let report = analyze_snapshots(
            &[
                sample(f32::NAN, 0.0),
                sample(0.0, 1.0),
                sample(f32::INFINITY, 2.0),
            ],
            "test",
        );
        let stats = &metric(&report, "cpu.total").statistics;
        assert_eq!(stats.count, 1);
        assert_eq!(stats.missing, 2);
        assert_eq!(stats.mean, Some(0.0));
        assert_eq!(stats.std_dev, None);
        assert_eq!(metric(&report, "cpu.total").points[0].value, None);
        assert!(serde_json::to_value(report).is_ok());
        let stats = statistics(&[f64::MAX, f64::MAX], 2);
        assert_eq!(stats.mean, Some(f64::MAX));
        assert_eq!(stats.std_dev, Some(0.0));
    }
    #[test]
    fn per_core_and_every_gpu_are_independent_with_missing_sensors() {
        let mut first = sample(20.0, 0.0);
        first.gpus = vec![
            GpuRow {
                name: "A".into(),
                utilization: Some(0.0),
                memory_used: Some(0),
                ..Default::default()
            },
            GpuRow {
                name: "B".into(),
                utilization: Some(80.0),
                temperature: Some(60.0),
                shared_memory_used: Some(100),
                ..Default::default()
            },
        ];
        let mut second = first.clone();
        second.elapsed_secs = 1.0;
        second.per_core.truncate(1);
        second.gpus[1].temperature = None;
        let report = analyze_snapshots(&[first, second], "test");
        assert_eq!(metric(&report, "cpu.core.1").statistics.missing, 1);
        assert_eq!(
            metric(&report, "gpu.0.utilization").statistics.mean,
            Some(0.0)
        );
        assert_eq!(
            metric(&report, "gpu.1.utilization").statistics.mean,
            Some(80.0)
        );
        assert_eq!(metric(&report, "gpu.1.temperature").statistics.missing, 1);
        assert_eq!(
            metric(&report, "gpu.1.shared_memory_used").statistics.mean,
            Some(100.0)
        );
        assert_eq!(metric(&report, "gpu.0.power").statistics.count, 0);
    }
    #[test]
    fn changing_gpu_identity_is_not_mixed_and_time_order_is_reported() {
        let mut first = sample(20.0, 2.0);
        first.gpus = vec![GpuRow {
            name: "A".into(),
            utilization: Some(10.0),
            source: "providerA".into(),
            ..Default::default()
        }];
        let mut second = first.clone();
        second.elapsed_secs = 1.0;
        second.gpus[0].name = "B".into();
        second.gpus[0].utilization = Some(90.0);
        let mut third = first.clone();
        third.elapsed_secs = 3.0;
        third.gpus[0].source = "providerB".into();
        let report = analyze_snapshots(&[first, second, third], "test");
        assert_eq!(
            metric(&report, "gpu.0.utilization").statistics.mean,
            Some(10.0)
        );
        assert_eq!(metric(&report, "gpu.0.utilization").statistics.missing, 1);
        assert!(report.warnings.iter().any(|w| w.contains("non monotono")));
        assert!(
            report
                .warnings
                .iter()
                .any(|w| w.contains("provider differenti"))
        );
    }
    #[test]
    fn point_thinning_preserves_endpoints_and_full_statistics() {
        let samples = (0..2001)
            .map(|i| sample(i as f32, i as f64))
            .collect::<Vec<_>>();
        let report = analyze_snapshots(&samples, "test");
        let metric = metric(&report, "cpu.total");
        assert_eq!(metric.statistics.count, 2001);
        assert_eq!(metric.statistics.mean, Some(1000.0));
        assert_eq!(metric.points.len(), 1000);
        assert_eq!(metric.points[0].value, Some(0.0));
        assert_eq!(metric.points.last().unwrap().value, Some(2000.0));
    }
    #[test]
    fn empty_and_legacy_without_core_data_never_invent_topology() {
        let report = analyze_snapshots(&[], "empty");
        assert_eq!(report.samples, 0);
        assert_eq!(report.start_unix, None);
        assert_eq!(metric(&report, "cpu.total").statistics.mean, None);
        let mut legacy = sample(30.0, 0.0);
        legacy.per_core.clear();
        legacy.memory_total = 0;
        let report = analyze_snapshots(&[legacy], "legacy");
        assert!(!report.metrics.iter().any(|m| m.id.starts_with("cpu.core.")));
        assert_eq!(metric(&report, "cpu.total").statistics.mean, None);
        assert_eq!(metric(&report, "ram.percent").statistics.missing, 1);
        let report = analyze_snapshots(&[Snapshot::default()], "unavailable");
        assert_eq!(metric(&report, "cpu.total").statistics.count, 0);
        assert_eq!(metric(&report, "cpu.total").statistics.missing, 1);
        assert_eq!(metric(&report, "cpu.total").points[0].value, None);
    }
    #[test]
    fn impossible_percentages_are_flagged_without_silently_rewriting_raw_measurements() {
        let mut snapshot = sample(120.0, 0.0);
        snapshot.per_core = vec![-5.0];
        snapshot.memory_used = 1500;
        snapshot.gpus = vec![GpuRow {
            name: "GPU".into(),
            utilization: Some(101.0),
            ..Default::default()
        }];
        let report = analyze_snapshots(&[snapshot], "quality");
        assert_eq!(metric(&report, "cpu.total").statistics.mean, Some(120.0));
        assert_eq!(metric(&report, "ram.percent").statistics.mean, Some(150.0));
        let warning = report
            .warnings
            .iter()
            .find(|warning| warning.contains("percentuali fuori"))
            .unwrap();
        assert!(warning.contains("4 metriche"));
        assert!(warning.contains("gpu.0.utilization"));
    }
}
