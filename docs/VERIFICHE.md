# Verifiche della release 0.1.1

Data: 8 novembre 2026. Piattaforma desktop verificata: Windows x64.

| Gate locale | Esito |
|---|---|
| Sintassi JavaScript, asset locali, versioni e attribuzione | Passato. |
| Rustfmt e Clippy workspace con `-D warnings` | Passati. |
| Core Rust | **130 test unitari + 6 CLI passati**. |
| Backend desktop, eventi, diagnostica e metadati autore | **20 test passati**, inclusa la prova opzionale su hardware reale. |
| Totale Rust | **156 test passati**. |
| Frontend con dati sintetici | **12 gruppi di regressione passati**, nessun errore JavaScript. |
| Eseguibile finale portabile nella WebView2 reale | **17 controlli passati**, nessuno saltato. |
| Eseguibile installato dal setup NSIS | Gli stessi **17 controlli passati**, nessuno saltato. |
| Installazione e disinstallazione isolate | Completate con exit code 0 e registrazione HKCU rimossa. |
| Identità dei binari | SHA-256 dell'installato uguale all'eseguibile portabile. |
| Licenze installate | LICENSE e THIRD-PARTY-NOTICES identici ai file del progetto. |
| ZIP portabile | Integrità verificata, esattamente quattro file previsti. |

La build usa Rust/Cargo 1.99.0, Node 24.15.0, Tauri 2.12.5 e CLI Tauri 2.12.2.
Versione applicativa verificata **0.1.1**; CompanyName e copyright Windows
riportano **Daniele Gabrovec**, come la schermata Informazioni e licenze.

## Prove della vera applicazione

I test sono stati eseguiti sul file finale in `artifacts`, dopo la build Tauri,
e ripetuti sul file estratto dal vero installer in una cartella di prova.
Il confronto degli hash conferma che si tratta dello stesso eseguibile.
Non sono prove di una pagina web di anteprima.

Copertura dei 17 controlli:

1. Inventario hardware reale e tutte le 14 viste.
2. Ricerca, ordinamento e dettaglio fissato di un processo.
3. Pausa della vista con raccolta ancora attiva.
4. Export del campione congelato, con timestamp e valore CPU corrispondenti.
5. Intervallo salvato a 500 ms e ripristinato a 1000 ms.
6. Registrazione e microbenchmark CPU dopo conferma nel dialogo.
7. Seconda sessione indipendente.
8. Replay e scorrimento dei contatori per thread conservati.
9. Confronto A/B e selezioni persistenti.
10. Export hardware e sessione JSON.
11. Backup SQLite completato e `PRAGMA quick_check = ok`.
12. Hover, cursore, tastiera e selettori thread/GPU.
13. Statistiche Rust confrontate con JSON e conteggio reale delle righe SQLite.
14. Export del rapporto analitico visualizzato.
15. Diagnostica e lettura facoltativa degli eventi Windows.
16. Temi chiaro/scuro.
17. Autore, versione, copyright e licenze incorporate/offline.

La verifica statistica ricostruisce i valori f32 in JavaScript e confronta
conteggio, media, minimo, massimo e P95 con i risultati Rust. I test unitari
coprono anche mediana, deviazione campionaria, zeri, valori mancanti/non finiti,
finestre, identità GPU, tempi e riduzione dei punti senza alterare le statistiche.

Le prove su hardware comprendono una configurazione multi-GPU e più thread
logici. I test non richiedono marche o conteggi fissi per essere riutilizzati
su un altro PC. I casi senza GPU e i 32 thread sono coperti anche da fixture.

## Installer, dati e pacchetti

La prova rifiuta installazioni preesistenti e processi CPU-RustT già attivi.
Usa una directory nuova sotto `test-output/install-runs`, senza elevazione.
Controlla versione, hash, risorse di licenza, registrazione per l'utente corrente,
avvio e flussi nativi. Disinstalla soltanto quella copia e verifica la rimozione
del binario e della registrazione, mantenendo il database isolato della prova.

La build usa `--no-binary-patching`: questo progetto non usa un updater per
più tipi di bundle e distribuisce un binario uguale fra ZIP, file diretto e setup.
La prima prova aveva rilevato la differenza del patching predefinito Tauri;
il gate è stato mantenuto e i pacchetti sono stati uniformati prima della release.

Il setup non è firmato. Non sono state provate VM Windows pulite, macOS,
Linux desktop, ogni driver o ogni modello hardware. Linux è verificato
separatamente dalla CI per il solo core e la CLI.

## Ripetere

```powershell
npm ci
.\scripts\verify.ps1 -LiveHardware
.\scripts\build.ps1
npm run test:native
.\scripts\test-installer.ps1
```

Il test dell'installer si ferma senza modifiche se CPU-RustT risulta già
installato. I benchmark LLM non vengono avviati; i test HTTP usano server simulati.
La scansione eventi è in sola lettura: il numero di eventi o la sua assenza
non certifica lo stato dell'hardware. Retry WDDM/hotplug sono coperti da un
controllore sintetico e compilazione, senza scollegamento fisico della GPU.

Evidenze locali escluse da Git: log di verifica/build, report frontend,
`test-output/native-runs`, `test-output/install-report.json` e screenshot reali.
La galleria pubblica usa soltanto dati sintetici e watermark dimostrativo.

La CI pubblica è consultabile in [GitHub Actions](https://github.com/danielegabrovec/CPU-RustT/actions/workflows/ci.yml).
Verifica Windows, fixture frontend e core Linux; non equivale alla prova
interattiva nativa locale descritta sopra.
