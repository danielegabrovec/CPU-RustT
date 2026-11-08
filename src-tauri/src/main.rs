#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod diagnostics;
mod engine;
mod system_events;

use engine::{Engine, Operation, SnapshotContext, View};
use rust_cpu::analysis::AnalysisReport;
use rust_cpu::settings::Preferences;
use serde::Serialize;
use serde_json::Value;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

async fn request(engine: &Engine, op: Operation) -> Result<Value, String> {
    let engine = engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.call(op))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
fn get_state(engine: State<'_, Engine>) -> Result<View, String> {
    engine.view().map_err(|e| e.to_string())
}
#[tauri::command]
async fn get_sessions(engine: State<'_, Engine>) -> Result<Value, String> {
    request(&engine, Operation::Sessions).await
}
#[tauri::command]
async fn start_recording(engine: State<'_, Engine>, name: String) -> Result<Value, String> {
    request(&engine, Operation::Start(name)).await
}
#[tauri::command]
async fn stop_recording(engine: State<'_, Engine>) -> Result<Value, String> {
    request(&engine, Operation::Stop).await
}
#[tauri::command]
async fn load_session(engine: State<'_, Engine>, id: i64) -> Result<Value, String> {
    request(&engine, Operation::Load(id)).await
}
#[tauri::command]
async fn compare_sessions(
    engine: State<'_, Engine>,
    left: i64,
    right: i64,
) -> Result<Value, String> {
    request(&engine, Operation::Compare(left, right)).await
}
#[tauri::command]
async fn rename_session(engine: State<'_, Engine>, id: i64, name: String) -> Result<Value, String> {
    request(&engine, Operation::Rename(id, name)).await
}
#[tauri::command]
async fn delete_session(engine: State<'_, Engine>, id: i64) -> Result<Value, String> {
    request(&engine, Operation::Delete(id)).await
}
#[tauri::command]
async fn save_preferences(
    engine: State<'_, Engine>,
    preferences: Preferences,
) -> Result<Value, String> {
    request(&engine, Operation::Preferences(Box::new(preferences))).await
}
#[tauri::command]
async fn export_snapshot(
    engine: State<'_, Engine>,
    context: Option<SnapshotContext>,
) -> Result<Value, String> {
    request(&engine, Operation::ExportSnapshot(context.map(Box::new))).await
}
#[tauri::command]
async fn export_session(engine: State<'_, Engine>, id: i64) -> Result<Value, String> {
    request(&engine, Operation::ExportSession(id)).await
}
#[tauri::command]
async fn import_session(app: tauri::AppHandle, engine: State<'_, Engine>) -> Result<Value, String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Sessione JSON", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Importazione annullata".to_string())?
    .into_path()
    .map_err(|e| e.to_string())?;
    request(&engine, Operation::Import(path)).await
}
#[tauri::command]
async fn backup_database(engine: State<'_, Engine>) -> Result<Value, String> {
    request(&engine, Operation::Backup).await
}
#[tauri::command]
async fn refresh_llm(engine: State<'_, Engine>) -> Result<Value, String> {
    request(&engine, Operation::Probe).await
}
#[tauri::command]
async fn run_cpu_benchmark(engine: State<'_, Engine>, repeats: u32) -> Result<Value, String> {
    request(&engine, Operation::Cpu(repeats)).await
}
#[tauri::command]
async fn run_llm_benchmark(
    engine: State<'_, Engine>,
    runtime: String,
    model: String,
    repeats: u32,
) -> Result<Value, String> {
    request(&engine, Operation::Llm(runtime, model, repeats)).await
}
#[tauri::command]
async fn cancel_benchmark(engine: State<'_, Engine>) -> Result<Value, String> {
    request(&engine, Operation::Cancel).await
}
#[tauri::command]
async fn analyze_data(
    engine: State<'_, Engine>,
    session_id: Option<i64>,
    window_seconds: Option<u64>,
) -> Result<Value, String> {
    request(&engine, Operation::Analyze(session_id, window_seconds)).await
}
#[tauri::command]
async fn get_diagnostics(
    engine: State<'_, Engine>,
    session_id: Option<i64>,
    window_seconds: Option<u64>,
) -> Result<Value, String> {
    request(&engine, Operation::Diagnostics(session_id, window_seconds)).await
}
#[tauri::command]
async fn export_analysis(
    engine: State<'_, Engine>,
    session_id: Option<i64>,
    window_seconds: Option<u64>,
    report: Option<AnalysisReport>,
) -> Result<Value, String> {
    request(
        &engine,
        Operation::ExportAnalysis(session_id, window_seconds, report.map(Box::new)),
    )
    .await
}

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    author: &'static str,
    copyright: &'static str,
    license: &'static str,
    repository: &'static str,
    third_party_notices: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "CPU-RustT",
        version: env!("CARGO_PKG_VERSION"),
        author: "Daniele Gabrovec",
        copyright: "© 2026 Daniele Gabrovec",
        license: "MIT",
        repository: "https://github.com/danielegabrovec/CPU-RustT",
        third_party_notices: include_str!("../../THIRD-PARTY-NOTICES.txt"),
    }
}
#[tauri::command]
async fn scan_system_events() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        serde_json::to_value(system_events::scan()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let data_override =
                std::env::var_os("CPU_RUSTT_DATA_DIR").map(std::path::PathBuf::from);
            let base = data_override
                .clone()
                .unwrap_or(app.path().app_local_data_dir()?);
            let exports = if data_override.is_some() {
                base.join("exports")
            } else {
                app.path()
                    .document_dir()
                    .unwrap_or_else(|_| base.clone())
                    .join("CPU-RustT")
                    .join("exports")
            };
            let engine = Engine::start(base.join("workspace.sqlite3"), exports)?;
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_sessions,
            start_recording,
            stop_recording,
            load_session,
            compare_sessions,
            rename_session,
            delete_session,
            save_preferences,
            export_snapshot,
            export_session,
            import_session,
            backup_database,
            refresh_llm,
            run_cpu_benchmark,
            run_llm_benchmark,
            cancel_benchmark,
            analyze_data,
            get_diagnostics,
            export_analysis,
            scan_system_events,
            app_info
        ])
        .build(tauri::generate_context!())
        .expect("Impossibile avviare CPU-RustT");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event
            && let Some(engine) = handle.try_state::<Engine>()
        {
            engine.shutdown();
        }
    });
}

#[cfg(test)]
mod attribution_tests {
    #[test]
    fn application_metadata_keeps_authorship_and_embedded_licenses() {
        let info = super::app_info();
        assert_eq!(info.name, "CPU-RustT");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.author, "Daniele Gabrovec");
        assert_eq!(info.copyright, "© 2026 Daniele Gabrovec");
        assert_eq!(info.license, "MIT");
        assert_eq!(
            info.repository,
            "https://github.com/danielegabrovec/CPU-RustT"
        );
        assert!(!info.third_party_notices.is_empty());
        assert!(info.third_party_notices.contains("MIT"));
    }
}
