# Architettura di CPU-RustT

CPU-RustT è un'app locale con interfaccia HTML/CSS/JavaScript, finestra Tauri
e motore Rust incluso nel repository. La cartella originale RUST-CPU non è una
dipendenza di compilazione o di esecuzione.

## Componenti

| Percorso | Responsabilità |
|---|---|
| `Cargo.toml` e `Cargo.lock` | Workspace Rust con lockfile unico; membri desktop e core. |
| `src-tauri/` | Finestra, comandi IPC, coordinamento dei worker, diagnostica e lettura facoltativa degli eventi Windows. |
| `crates/monitor-core/` | Raccolta hardware, modelli dei dati, SQLite, analisi, benchmark, runtime LLM, observer e CLI/TUI. |
| `web/` | Rendering delle viste, navigazione, moduli, tema, cursori dei grafici e contesti visualizzati. |
| `tests/` | Verifiche frontend e controllo della vera WebView mediante Playwright/CDP. |
| `scripts/` | Verifica, build, icone e generazione delle attribuzioni delle dipendenze. |
| `docs/` | Guide, metodi, audit e limiti delle verifiche. |

La GUI usa i comandi Tauri per richiedere dati e operazioni. Le misure sono
raccolte dal codice Rust; i grafici non simulano l'utilizzo del computer.
L'HTML non richiede un server applicativo esterno o un CDN per il rendering.
Il core conserva anche il proprio eseguibile da terminale per le operazioni
headless e per il proxy observer facoltativo.

## Raccolta, archivio e lavori espliciti

Il sampler Rust possiede il `Collector` e invia i campioni a una coda limitata
di 16 elementi. Un secondo worker possiede la connessione SQLite e serializza
comandi, registrazioni, avvisi e risultati. Lo stato destinato alla GUI è
condiviso mediante `RwLock`; la cronologia live conserva al massimo 180 campioni.

La coda delle richieste ammette 32 comandi. Le attese hanno una scadenza;
un comando abbandonato prima dell'esecuzione non viene avviato più tardi.
L'annullamento dei benchmark imposta direttamente un flag atomico, così non
attende che si liberi la coda dell'archivio.

Se la raccolta supera la capacità della coda, l'app segnala i campioni mancanti
e interrompe la registrazione come incompleta. Una registrazione non viene
dichiarata completa dopo una perdita silenziosa di dati. All'avvio le sessioni
rimaste aperte vengono recuperate con una query senza il limite dell'elenco UI.

WDDM e LibreHardwareMonitor lavorano su worker dedicati e offrono letture
recenti senza attendere il provider sulla GUI. La lettura `nvidia-smi` è
separata e limitata nel tempo. Un provider non disponibile non autorizza
l'invenzione di misure zero. Inventario memorizzato e contatori live hanno
responsabilità distinte; dettagli in [HARDWARE.md](HARDWARE.md).

Scoperta dei runtime e benchmark eseguono lavori separati. La scoperta non
avvia inferenza, aggiorna i runtime a intervalli e usa una generazione per
scartare risultati riferiti a preferenze superate. I benchmark CPU/LLM partono
su comando esplicito; la GUI ne richiede conferma. La chiusura richiede la
cancellazione dei lavori e raccoglie i risultati già completati prima di
finalizzare lo stato delle registrazioni.

La pausa congela il contesto visualizzato, mentre raccolta e registrazione
continuano. Il replay usa dati dell'archivio ed è distinto dallo stato live.

## Persistenza e statistiche

SQLite è incorporato; non serve un server database. WAL e transazioni di lettura
mantengono coerenti query articolate mentre un altro client aggiunge dati.
Sessioni, campioni, benchmark, avvisi e preferenze hanno strutture distinte.
Il core preserva date, intervallo e versione di origine dei dati importati.

I campi numerici obbligatori devono essere finiti prima del salvataggio. Questo
impedisce che `NaN` o infinito diventino `null` JSON e rendano impossibile il
successivo replay. Le misure opzionali possono invece rappresentare l'assenza.
I dettagli dei processi vengono ridotti ai processi LLM nell'archivio; i carichi
per thread e le altre risorse presenti nel campione restano conservati.

L'analisi Rust calcola prima le statistiche su tutti i campioni selezionati,
poi riduce eventualmente i punti del grafico a 1.000. Il limite esplicito di
100.000 campioni per richiesta produce un errore se superato. La media è
aritmetica non pesata per tempo, il P95 usa il rango più vicino e la deviazione
standard è campionaria. Missing e zero sono distinti. Il replay ha una propria
anteprima limitata: non determina la popolazione delle statistiche.

I controlli diagnostici aggiungono evidenze e suggerimenti alle misure. Non
costituiscono una diagnosi di guasto. La lettura degli eventi System è un comando
facoltativo su un worker bloccante: solo provider/livelli selezionati, ultime
24 ore, massimo 100 eventi, timeout di otto secondi e risposta fino a 1 MiB.
Non richiede elevazione né modifica il registro.

## Esportazioni coerenti con la vista

L'esportazione hardware accetta un `SnapshotContext` tipizzato, contenente
inventario, campione, stato LLM ed eventuale benchmark CPU. La GUI può inviare
il contesto congelato che l'utente sta leggendo. Rust ne controlla dimensioni
e numeri prima di scrivere: il pulsante di export non deve sostituire
silenziosamente la vista in pausa con un campione live più recente.

L'esportazione dell'analisi può ricevere il report Rust già visualizzato,
tipizzato e validato, per conservarne la stessa popolazione e gli stessi valori.
I chiamanti che omettono il contesto mantengono il percorso di ricalcolo
esplicito nel backend. L'export di una sessione legge invece l'archivio coerente
e conserva tutte le righe, indipendentemente dai limiti delle anteprime.

Le scritture usano nomi nuovi con creazione esclusiva. Gli errori di scrittura
non devono lasciare un file parziale presentato come risultato completato.
Il backup ha una scadenza, ripristina il timeout SQLite e pulisce la destinazione
parziale in caso di fallimento. L'interfaccia segnala il completamento soltanto
dopo la risposta dell'operazione.

## Dati, rete e confini

Il database desktop predefinito è nella directory locale dell'applicazione,
determinata dall'identificatore Tauri. Le esportazioni sono nella cartella
Documenti del sistema; `CPU_RUSTT_DATA_DIR` permette un archivio isolato o
portabile. La CLI usa l'opzione `--database` per scegliere il proprio archivio.

Il codice dell'app non prevede account, analytics o upload automatici dei
report. Le sonde e i benchmark LLM accettano origini HTTP loopback; non usano
proxy di ambiente né seguono redirect. Il runtime locale può avere proprie
politiche o instradamenti: il suo funzionamento non è certificato dalla sola
origine loopback. I token restano variabili d'ambiente del processo.

Il proxy observer vede soltanto richieste che un client sceglie di instradare
attraverso di esso. Non registra prompt o risposte; il runtime e il client
possono avere registrazioni proprie.

Database, export, screenshot e report di prove native possono contenere nomi
di processi, modelli, volumi, interfacce e messaggi del sistema. Sono risultati
locali esclusi dal repository, da controllare prima di una condivisione.
La compilazione e l'esecuzione su altri sistemi operativi richiedono verifiche
separate; il supporto dichiarato per la consegna è Windows x64.

Riferimenti: [main desktop](../src-tauri/src/main.rs),
[engine e worker](../src-tauri/src/engine.rs),
[archivio](../crates/monitor-core/src/storage.rs),
[analisi](../crates/monitor-core/src/analysis.rs),
[metodi statistici](ANALISI.md), [verifiche](VERIFICHE.md).
