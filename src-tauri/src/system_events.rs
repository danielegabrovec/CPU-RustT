//! Optional, read-only inspection of a bounded subset of the Windows System log.
//! Events are evidence to inspect; their IDs do not diagnose hardware failures.
use serde::{Deserialize, Serialize};
#[cfg(any(windows, test))]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(windows)]
static SCAN_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[cfg(any(windows, test))]
struct ScanGuard<'a>(&'a AtomicBool);
#[cfg(any(windows, test))]
impl<'a> ScanGuard<'a> {
    fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(flag))
    }
}
#[cfg(any(windows, test))]
impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SystemEvent {
    pub timestamp: String,
    pub provider: String,
    pub event_id: u32,
    pub level: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SystemEventReport {
    pub events: Vec<SystemEvent>,
    pub warnings: Vec<String>,
}

#[cfg(any(windows, test))]
const OUTPUT_LIMIT: usize = 1024 * 1024;
#[cfg(any(windows, test))]
const MAX_EVENTS: usize = 100;
#[cfg(any(windows, test))]
const PROVIDERS: [&str; 6] = [
    "Microsoft-Windows-WHEA-Logger",
    "Display",
    "disk",
    "stornvme",
    "storahci",
    "Microsoft-Windows-Kernel-Power",
];

#[cfg(any(windows, test))]
fn powershell_script() -> &'static str {
    // Filtering by log, time and numeric level happens in the event-log query.
    // The exact provider whitelist is applied before Select-Object, so unrelated
    // warnings cannot consume the 100-event allowance. Missing providers on a
    // particular Windows installation do not invalidate the whole query.
    r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$events = @()
$warnings = @()
$providers = @('Microsoft-Windows-WHEA-Logger','Display','disk','stornvme','storahci','Microsoft-Windows-Kernel-Power')
try {
    $filter = @{LogName='System'; Level=@(1,2,3); StartTime=(Get-Date).AddHours(-24)}
    $events = @(Get-WinEvent -FilterHashtable $filter -ErrorAction Stop |
        Where-Object { $providers -contains $_.ProviderName } |
        Select-Object -First 100 |
        ForEach-Object {
            $message = [string]$_.Message
            if ($message.Length -gt 2000) {
                $limit = 2000
                if ([char]::IsHighSurrogate($message[$limit - 1])) { $limit-- }
                $message = $message.Substring(0,$limit) + ' [troncato]'
            }
            $level = switch ([int]$_.Level) { 1 {'Critical'} 2 {'Error'} 3 {'Warning'} }
            [ordered]@{
                timestamp=$_.TimeCreated.ToUniversalTime().ToString('o')
                provider=[string]$_.ProviderName
                event_id=[uint32]$_.Id
                level=[string]$level
                message=$message
            }
        })
} catch {
    if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') {
        if ($_.Exception -is [System.UnauthorizedAccessException] -or
            $_.Exception -is [System.Security.SecurityException] -or
            $_.FullyQualifiedErrorId -match 'Unauthorized|AccessDenied|PermissionDenied') {
            $warnings = @('Accesso al registro System negato. Nessuna elevazione richiesta; eventi non disponibili.')
        } else {
            $detail = [string]$_.Exception.Message
            if ($detail.Length -gt 512) { $detail = $detail.Substring(0,512) }
            $warnings = @('Lettura del registro System non disponibile: ' + $detail)
        }
    }
}
[ordered]@{events=@($events); warnings=@($warnings)} | ConvertTo-Json -Depth 5 -Compress
"#
}

#[cfg(any(windows, test))]
fn parse_report(bytes: &[u8]) -> Result<SystemEventReport, String> {
    if bytes.len() > OUTPUT_LIMIT {
        return Err("Registro eventi: risposta oltre il limite di 1 MiB; dati omessi.".into());
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    let mut report: SystemEventReport = serde_json::from_slice(bytes)
        .map_err(|_| "Registro eventi: risposta JSON non valida; dati omessi.".to_owned())?;
    let initial_count = report.events.len();
    report.events.retain(|event| {
        PROVIDERS
            .iter()
            .any(|provider| event.provider.eq_ignore_ascii_case(provider))
            && matches!(event.level.as_str(), "Critical" | "Error" | "Warning")
    });
    if report.events.len() != initial_count {
        report
            .warnings
            .push("Registro eventi: esclusi elementi fuori dai provider/livelli richiesti.".into());
    }
    if report.events.len() > MAX_EVENTS {
        report.events.truncate(MAX_EVENTS);
        report
            .warnings
            .push("Registro eventi: mostrati al massimo 100 eventi.".into());
    }
    Ok(report)
}

#[cfg(windows)]
fn warning(message: impl Into<String>) -> SystemEventReport {
    SystemEventReport {
        events: Vec::new(),
        warnings: vec![message.into()],
    }
}

/// Call on a blocking worker. Never requests elevation or modifies event logs.
#[cfg(windows)]
pub fn scan() -> SystemEventReport {
    let Some(_scan) = ScanGuard::acquire(&SCAN_IN_PROGRESS) else {
        return warning(
            "Una lettura degli eventi Windows è già in corso; attendere il suo completamento.",
        );
    };
    use std::{
        io::Read,
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        sync::mpsc,
        thread,
        time::{Duration, Instant},
    };

    const TIMEOUT: Duration = Duration::from_secs(8);
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let started = Instant::now();
    let shell = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .map(|root| root.join(r"System32\WindowsPowerShell\v1.0\powershell.exe"))
        .unwrap_or_else(|| "powershell.exe".into());
    let mut child = match Command::new(shell)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            powershell_script(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return warning(format!(
                "Avvio lettura registro eventi non riuscito: {error}"
            ));
        }
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return warning("Registro eventi: output del provider non disponibile.");
    };
    let (sender, output) = mpsc::sync_channel(1);
    // Drain stdout while the process runs, otherwise a full pipe can deadlock
    // PowerShell before it exits. Allocation and accepted output remain bounded.
    let reader = thread::Builder::new()
        .name("cpu-rustt-eventlog-output".into())
        .spawn(move || {
            let mut bytes = Vec::new();
            let result = stdout
                .take((OUTPUT_LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .map(|_| bytes);
            let _ = sender.send(result);
        });
    if reader.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return warning("Registro eventi: impossibile avviare il lettore isolato.");
    }
    let mut result = None;
    loop {
        if let Ok(value) = output.try_recv() {
            match value {
                Ok(bytes) if bytes.len() <= OUTPUT_LIMIT => result = Some(bytes),
                Ok(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return warning(
                        "Registro eventi: risposta oltre il limite di 1 MiB; lettura interrotta.",
                    );
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return warning(format!(
                        "Registro eventi: lettura output non riuscita: {error}"
                    ));
                }
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return warning(
                        "Registro eventi: il provider PowerShell non ha completato la lettura.",
                    );
                }
                let bytes = match result {
                    Some(bytes) => bytes,
                    None => match output.recv_timeout(TIMEOUT.saturating_sub(started.elapsed())) {
                        Ok(Ok(bytes)) => bytes,
                        _ => {
                            return warning(
                                "Registro eventi: output incompleto o limite di 8 secondi superato.",
                            );
                        }
                    },
                };
                return parse_report(&bytes).unwrap_or_else(warning);
            }
            Ok(None) if started.elapsed() < TIMEOUT => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return warning(
                    "Registro eventi: limite di 8 secondi superato o provider non disponibile; lettura interrotta.",
                );
            }
        }
    }
}

#[cfg(not(windows))]
pub fn scan() -> SystemEventReport {
    SystemEventReport {
        events: Vec::new(),
        warnings: vec![
            "La lettura del registro eventi System è disponibile soltanto su Windows.".into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_matching_events_is_a_successful_empty_report() {
        let report = parse_report(br#"{"events":[],"warnings":[]}"#).unwrap();
        assert!(report.events.is_empty());
        assert!(report.warnings.is_empty());
    }

    #[test]
    fn parses_unicode_and_preserves_provider_and_id_without_interpretation() {
        let report = parse_report(
            r#"{"events":[{"timestamp":"2026-11-08T10:00:00.0000000Z","provider":"Microsoft-Windows-WHEA-Logger","event_id":17,"level":"Warning","message":"Messaggio già localizzato: periferica à."}],"warnings":[]}"#.as_bytes(),
        ).unwrap();
        assert_eq!(report.events.len(), 1);
        assert_eq!(report.events[0].event_id, 17);
        assert_eq!(report.events[0].level, "Warning");
        assert!(report.events[0].message.contains("à"));
        assert!(report.warnings.is_empty());
    }

    #[test]
    fn permission_warning_does_not_fabricate_events() {
        let report = parse_report(br#"{"events":[],"warnings":["Access denied"]}"#).unwrap();
        assert!(report.events.is_empty());
        assert_eq!(report.warnings, ["Access denied"]);
    }

    #[test]
    fn malformed_oversized_and_unrelated_data_are_not_accepted() {
        assert!(parse_report(b"not-json").is_err());
        assert!(parse_report(&vec![b' '; OUTPUT_LIMIT + 1]).is_err());
        let report = parse_report(br#"{"events":[{"timestamp":"2026-11-08T10:00:00Z","provider":"Other-Application","event_id":1,"level":"Error","message":"Unrelated"},{"timestamp":"2026-11-08T10:00:00Z","provider":"disk","event_id":2,"level":"Information","message":"Not an error"}],"warnings":[]}"#).unwrap();
        assert!(report.events.is_empty());
        assert_eq!(report.warnings.len(), 1);
    }

    #[test]
    fn caps_event_count_and_accepts_a_utf8_bom() {
        let event = SystemEvent {
            provider: "Display".into(),
            level: "Error".into(),
            ..Default::default()
        };
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend(
            serde_json::to_vec(&SystemEventReport {
                events: vec![event; 105],
                warnings: vec![],
            })
            .unwrap(),
        );
        let report = parse_report(&bytes).unwrap();
        assert_eq!(report.events.len(), 100);
        assert_eq!(report.warnings.len(), 1);
    }

    #[test]
    fn script_has_read_only_time_level_and_count_limits() {
        let script = powershell_script();
        assert!(script.contains("Get-WinEvent -FilterHashtable $filter -ErrorAction Stop"));
        assert!(script.contains("Level=@(1,2,3)"));
        assert!(script.contains("AddHours(-24)"));
        assert!(script.contains("Select-Object -First 100"));
        assert!(script.contains("NoMatchingEventsFound"));
        assert!(script.contains("ToUniversalTime()"));
        assert!(script.contains("IsHighSurrogate"));
        for provider in PROVIDERS {
            assert!(script.contains(provider));
        }
        for mutation in [
            "Clear-EventLog",
            "Remove-EventLog",
            "Limit-EventLog",
            "RunAs",
            "wevtutil cl",
        ] {
            assert!(!script.contains(mutation));
        }
    }
    #[test]
    fn concurrent_scans_are_bounded_and_guard_is_released_after_failure() {
        let flag = AtomicBool::new(false);
        let first = ScanGuard::acquire(&flag).unwrap();
        assert!(ScanGuard::acquire(&flag).is_none());
        drop(first);
        let next = ScanGuard::acquire(&flag).unwrap();
        drop(next);
        assert!(!flag.load(Ordering::Acquire));
    }
}
