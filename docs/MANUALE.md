# CPU-RustT

App desktop in italiano per monitorare CPU, RAM, GPU, processi, dischi e rete,
registrare sessioni SQLite e confrontare lavori. Interfaccia Tauri 2 e motore
Rust derivato da RUST-CPU, incluso nel progetto e utilizzabile anche da terminale.

## Avvio su Windows

Per avviare la versione pronta all'uso dalla cartella del progetto:

```powershell
.\artifacts\CPU-RustT.exe
```

L'installer per l'utente corrente si trova in
`artifacts\CPU-RustT_0.1.1_x64-setup.exe`. L'app richiede Microsoft Edge WebView2.
L'eseguibile è utilizzabile senza installare Rust, Node.js o un server SQLite.
Il setup non è firmato digitalmente.

Attendere il primo campione prima di iniziare una registrazione. L'inventario
hardware e i provider opzionali possono impiegare qualche secondo. La seconda
apertura dell'app porta in primo piano l'istanza già avviata.

## Le quattordici viste

| Vista | Funzioni |
|---|---|
| Panoramica | CPU, RAM, GPU, spazio dei volumi, andamento risorse, thread e processi più attivi. |
| Processore | Identità CPUID, istruzioni, cache, carico per thread, frequenza OS e benchmark mix64 su richiesta. |
| Scheda madre | Scheda madre e firmware dichiarati da WMI/SMBIOS. |
| Memoria | RAM, memoria virtuale e dettagli dei moduli esposti dal firmware. |
| Schede grafiche | Adattatori, utilizzo, memoria dedicata/condivisa e sensori disponibili. |
| Dischi e rete | Capacità dei volumi, velocità I/O e traffico delle interfacce. |
| Processi | Ricerca, ordinamento, CPU/RAM/I/O, attribuzioni GPU e dettaglio del campione selezionato. |
| LLM locali | Scoperta runtime/modelli e benchmark espliciti con annullamento e cronologia. |
| Capacity Lab | Stima di pesi, cache KV FP16 e margini, con RAM e VRAM considerate separatamente. |
| Analisi dati | Serie CPU/thread, RAM e singole GPU; media, mediana, P95, dispersione, valori mancanti ed export JSON. |
| Diagnostica | Controlli sui campioni, soglie, disponibilità delle fonti, avvisi del monitor e lettura facoltativa degli eventi Windows. |
| Sessioni | Registrazione, rinomina, eliminazione, replay, importazione/esportazione JSON e backup SQLite. |
| Confronto A/B | Statistiche, progressione e benchmark confrontabili; delta sempre B meno A. |
| Impostazioni | Tema chiaro/scuro, intervallo, soglie, ripetizioni, runtime e preferenze persistenti. |

La pausa congela soltanto la vista: raccolta e registrazione continuano.
Per interrompere il salvataggio usare il pulsante di arresto registrazione.
Il replay mostra dati archiviati ed è distinto dalla vista live. Il confronto
usa le statistiche di tutti i campioni; le serie visualizzate possono essere
anteprime distribuite sull'intera sessione.

## Esplorare grafici, statistiche e problemi

Sui grafici spostare il puntatore per leggere ora e valori del campione. Da
tastiera, raggiungere il grafico con `Tab`, usare `←` e `→` per scorrere, `Home`
ed `End` per il primo e l'ultimo punto. Nella vista Processore scegliere
**CPU totale** oppure un **Thread logico**; nella vista Schede grafiche scegliere
un adattatore o tutti gli adattatori. Memoria dedicata e condivisa restano distinte.

In **Analisi dati**, scegliere origine e finestra, poi premere **Analizza dati**.
Il live conserva al massimo **180 campioni**, la cui durata dipende dall'intervallo
di raccolta. Una sessione usa invece **tutti i campioni salvati nella finestra
richiesta**, indipendentemente dall'anteprima del replay. I grafici dell'analisi
mostrano al massimo 1000 punti, mentre le statistiche utilizzano tutti i campioni
selezionati; oltre 100.000 campioni la richiesta restituisce un errore esplicito
e richiede una finestra più breve. Valori mancanti e zeri non sono equivalenti.

La media dà lo stesso peso a ogni campione; la mediana usa il valore centrale
o la media dei due centrali; il P95 usa il rango `ceil(0,95 × N)` nella serie
ordinata. La deviazione standard è campionaria, con denominatore `N − 1`, e non è
disponibile con meno di due valori. Le statistiche descrivono le misure raccolte:
un utilizzo inferiore non dimostra da solo maggiore velocità.

In **Diagnostica**, **Analizza problemi** controlla soglie CPU/RAM, temperatura
GPU, VRAM, temperatura CPU disponibile, spazio libero dei volumi fino al 5%,
ritardi live, distribuzione del carico fra thread e avvisi dei provider o dei
dati. Ogni segnale riporta evidenza e indicazione da approfondire. Le soglie sono
configurabili nelle Impostazioni; i controlli non identificano automaticamente
la causa né certificano un guasto hardware.

**Informazioni e licenze** riporta versione, attribuzione a Daniele Gabrovec,
copyright, MIT e riconoscimenti di terze parti consultabili offline.

**Leggi eventi Windows** è facoltativo: consulta il registro System delle ultime
24 ore e mostra al massimo 100 eventi critici, errori o avvisi di provider
selezionati per hardware, grafica, dischi e alimentazione. L'assenza di eventi
non certifica l'assenza di problemi. Guida completa: [Analisi e diagnostica](ANALISI.md).

## Dati locali e modalità portabile

Il database predefinito su Windows è:

```text
%LOCALAPPDATA%\it.gabrovec.cpu-rustt\workspace.sqlite3
```

Il percorso deriva da `app_local_data_dir()` di Tauri e dall'identificatore
`it.gabrovec.cpu-rustt` in `src-tauri/tauri.conf.json`. SQLite è incorporato.
L'archivio della GUI è separato da quello predefinito di RUST-CPU.

I report e i backup vengono scritti nella cartella Documenti di Windows,
sottocartella `CPU-RustT\exports`. La cartella Documenti può essere reindirizzata,
per esempio a OneDrive: l'app usa il percorso restituito dal sistema.
Impostazioni e Diagnostica mostrano i percorsi effettivi. Gli export utilizzano
nomi univoci e non sovrascrivono file esistenti.

Per prove isolate o per tenere database ed esportazioni vicino all'eseguibile,
chiudere l'istanza aperta e avviare l'app con `CPU_RUSTT_DATA_DIR`:

```powershell
$env:CPU_RUSTT_DATA_DIR = Join-Path $PWD 'dati-portabili'
.\artifacts\CPU-RustT.exe
```

In questo caso il database sarà `dati-portabili\workspace.sqlite3` e gli export
saranno in `dati-portabili\exports`. La variabile vale per il processo avviato;
la CLI del core usa invece l'opzione `--database`.

## LLM locali e benchmark

Gli endpoint iniziali sono Ollama `http://127.0.0.1:11434`, LM Studio
`http://127.0.0.1:1234` e llama.cpp `http://127.0.0.1:8080`. Sono modificabili
nelle Impostazioni; sono accettate origini HTTP loopback senza percorsi o
credenziali. Un runtime offline non impedisce il monitoraggio hardware.

La scoperta interroga le API locali senza avviare inferenza. Il benchmark LLM
richiede un comando esplicito e una conferma nell'interfaccia: invia un breve
prompt sintetico, con massimo 64 token di uscita, e può caricare il modello.
Il benchmark CPU mix64 richiede anch'esso un avvio esplicito. Le ripetizioni
sono configurabili da 1 a 10. I risultati misurano il metodo indicato e non
costituiscono un punteggio universale; `native_decode` ed `end_to_end` misurano
intervalli diversi.

I token dei runtime protetti si configurano nelle variabili d'ambiente
`RUST_CPU_OLLAMA_TOKEN`, `RUST_CPU_LM_STUDIO_TOKEN` e `RUST_CPU_LLAMA_CPP_TOKEN`
prima dell'avvio. L'app non li salva nelle preferenze o nei report.

L'observer opzionale rimane disponibile nella CLI del core. Dalla radice:

```powershell
cargo run --manifest-path crates/monitor-core/Cargo.toml -- --help
cargo run --manifest-path crates/monitor-core/Cargo.toml -- --database "$env:LOCALAPPDATA\it.gabrovec.cpu-rustt\workspace.sqlite3" --observe-runtime ollama --observe-port 18434
```

Occorre configurare il client esterno perché invii le richieste al proxy locale.
Le richieste dirette al runtime restano fuori dall'osservazione. Per associarle
a una registrazione aperta aggiungere `--observe-session ID`. Se l'upstream è
protetto, configurare anche la protezione d'ingresso
`RUST_CPU_OBSERVER_TOKEN`. Il proxy non archivia prompt o risposte.

## Sviluppo e verifiche

Prerequisiti Windows: Rust 1.95 o superiore con toolchain MSVC, Visual Studio
Build Tools con compilatore C++ e Windows SDK, Node.js con npm e WebView2.
I lockfile npm e Cargo fanno parte del progetto.

Eseguire dalla cartella `CPU-RustT`:

```powershell
npm ci
npm run dev

# Controlli automatici del workspace
.\scripts\verify.ps1

# Controlli, eseguibile release e installer NSIS nella cartella artifacts
.\scripts\build.ps1
```

Tauri produce l'eseguibile in `src-tauri\target\release\cpu-rustt.exe` e il
setup in `src-tauri\target\release\bundle\nsis`. La cartella `artifacts`
contiene le copie predisposte per la consegna. `npm run dev` apre l'app nativa;
aprire soltanto `web/index.html` in un browser non abilita i comandi Rust.
Gli script richiedono PowerShell 7. `npm run build` esegue direttamente la build
Tauri; `scripts/build.ps1` aggiunge controlli, copia degli artefatti e SHA-256.

Il workspace Cargo è definito dal `Cargo.toml` nella radice e include
`src-tauri` e `crates/monitor-core`, con un solo `Cargo.lock` nella radice.
`.cargo/config.toml` indirizza gli artefatti a `src-tauri/target`.

Controlli ripetibili:

```powershell
npm run check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked

# Include le prove opzionali che interrogano l'hardware reale
cargo test --workspace --all-targets --locked -- --include-ignored
# Equivalente percorso guidato per i controlli e le prove hardware dell'app
.\scripts\verify.ps1 -LiveHardware

# Smoke test della WebView nativa; richiede l'eseguibile compilato
npm run test:native
```

Gli esiti e l'ambito delle prove di questa consegna sono riportati in
[VERIFICHE.md](VERIFICHE.md). Compilazione, prove automatiche e interazione
con la GUI sono verifiche distinte. La piattaforma di riferimento per questa
consegna è Windows x64; non è dichiarata una verifica nativa su Linux o macOS.

## Architettura e limiti

`web/` contiene HTML, CSS e JavaScript locali; `src-tauri/` gestisce finestra,
IPC, worker e accesso all'archivio. `crates/monitor-core/` contiene una copia
autonoma del motore RUST-CPU 0.2, comprese raccolta hardware, SQLite, benchmark,
runtime LLM e CLI. Non occorre mantenere accanto la cartella sorgente RUST-CPU:
la dipendenza Rust punta al core incluso nel progetto. I futuri aggiornamenti
del progetto originale devono essere riportati e verificati esplicitamente.

CPU e processi sono normalizzati sul totale dei processori logici. La frequenza
OS può essere nominale e non è il clock effettivo per core. Temperature,
tensioni e alcuni contatori GPU dipendono dai provider disponibili; i valori
mancanti restano N/D. LibreHardwareMonitor è utilizzato solo se già attivo.
L'app non installa driver kernel e non legge direttamente SPD, timing RAM live,
SMBus/MSR o SMART. WDDM/DXGI dipende dal driver e non garantisce ogni GPU o
configurazione. WDDM riprova gli errori transitori e DXGI rinnova la configurazione;
i dettagli statici WMI dopo un cambio adattatore possono richiedere il riavvio.

Le sessioni conservano i contatori per thread presenti nei campioni reali;
la lista dei processi viene ridotta ai processi riconosciuti come LLM.
Alcuni archivi o fixture precedenti possono contenere soltanto il carico CPU
complessivo: in quel caso il replay segnala l'assenza della topologia completa.
Capacity Lab è una stima per una singola sequenza con
cache KV FP16; non garantisce caricamento o velocità di un modello.
Dettagli dell'audit in [AUDIT-CPU.md](AUDIT-CPU.md).

L'app non prevede account, analytics o upload automatici. I dati restano nei
percorsi locali indicati; report e archivi possono contenere nomi di processi,
modelli, dischi e interfacce. Licenza MIT. Autore: Daniele Gabrovec.
