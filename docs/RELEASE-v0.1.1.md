# CPU-RustT 0.1.1

Prima release pubblica del monitor hardware desktop Rust/Tauri per Windows x64.

**Ideazione, struttura e sviluppo: Daniele Gabrovec.**
Copyright © 2026 Daniele Gabrovec. Licenza MIT, con riconoscimenti delle dipendenze inclusi.

- CPU totale e ogni thread, RAM, tutte le GPU, processi, dischi e rete.
- Grafici con hover, tastiera e campioni a intervalli reali.
- Sessioni SQLite, replay, confronto A/B, statistiche e diagnostica.
- Export esatto della vista in pausa/replay e dell'analisi visualizzata.
- Migliorati retry WDDM, validazione SQLite, chiusura, richieste e metadati runtime.
- UI più leggibile, moduli e selezioni conservati, informazioni e licenze offline.

Verifiche locali: **156 test Rust**, **12 gruppi UI**, **17 controlli nativi**
sul portabile e ripetuti sul binario installato. Installazione, licenze,
uguaglianza SHA-256 e disinstallazione isolate verificate.

Download: setup per l'utente corrente oppure ZIP da estrarre interamente.
Il file diretto non richiede Rust, Node.js o un server SQLite. Serve WebView2;
il setup può scaricarlo se assente. I pacchetti non sono firmati digitalmente.

`SHA256SUMS.txt` consente di verificare eseguibile, setup e ZIP. Dati reali e
database restano locali e non sono inclusi nel repository. I controlli indicano
segnali da approfondire, senza certificare cause o guasti hardware.
