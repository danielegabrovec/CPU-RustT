# Audit del runtime Rust e dell'archivio

Data: 8 novembre 2026. Ambito: `storage.rs`, `workspace_runtime.rs`,
`app_runtime.rs`, `bench.rs`, `settings.rs`, `llm.rs`, `observer.rs`, `export.rs`.
L'analisi riguarda il sorgente RUST-CPU e il suo riuso nel core di CPU-RustT.

## Analisi statistica delle serie

Il modulo puro `analysis::analyze_snapshots` restituisce statistiche descrittive
per CPU totale, ogni core registrato, RAM in percentuale e byte e ogni adattatore
GPU disponibile: carico, memoria dedicata, memoria condivisa, temperatura e
potenza. Dischi e rete includono velocità aggregate quando sono presenti nei
campioni. Ogni metrica conserva il numero di valori validi e mancanti; zero resta
un valore valido. CPU priva di un array di core registrato e RAM priva della
capacità totale vengono trattate come non disponibili, coerentemente con il DB.

Le statistiche comprendono minimo, massimo, media dei campioni, mediana, P95 a
rango più vicino, deviazione standard campionaria con denominatore `n−1` e delta
tra ultimo e primo valore valido. Valori non finiti sono esclusi; con meno di due
valori la deviazione standard è non disponibile. Non si attribuiscono cause o
un significato prestazionale generale alle variazioni osservate.

`Store::analysis_session(id, window_seconds)` legge tutti i campioni selezionati
all'interno di una transazione coerente. La finestra è inclusiva e relativa al
massimo tempo trascorso della sessione. Le statistiche sono calcolate prima della
riduzione dei grafici a 1000 punti distribuiti, mantenendo gli estremi. Oltre
100.000 campioni selezionati l'analisi restituisce un errore esplicito prima di
caricare i payload; una finestra più breve permette di ridurre la richiesta.

Gli array per core e tutti gli adattatori GPU erano già conservati integralmente
da `insert_sample`; nessuna modifica di formato o falsa ricostruzione legacy è
stata necessaria. Un numero di core diverso dall'inventario genera un avviso.
Se cambia il nome della GPU allo stesso indice, i suoi valori non vengono
mescolati con quelli dell'adattatore originario: diventano mancanti e il rapporto
lo dichiara. Cambi di provider e tempi non monotoni producono avvisi; timestamp
Unix uguali sono ammessi perché la loro risoluzione è di un secondo.

Percentuali finite fuori dall'intervallo 0–100% vengono mantenute come dati
originali e segnalate esplicitamente nel rapporto, senza correggere o nascondere
in silenzio i valori del provider.

Verifica del nuovo modulo: **8 test statistici** e **3 test aggiuntivi SQLite**,
inclusi percentili noti, deviazione campionaria, valori estremi, assenze distinte
dagli zeri, core/GPU indipendenti, cambio adattatore, riduzione della serie,
finestra inclusiva e limite di 100.000 campioni. La suite Rust completa è passata
con **123 test unitari**; dopo l'ultimo allineamento CPU mancante e l'avviso di
qualità delle percentuali sono stati rieseguiti gli 8 test statistici. Clippy su
tutti i target passa con warning trattati
come errori.

## Errori individuati e corretti nel core

| Errore verificato | Correzione | Prova |
| --- | --- | --- |
| L'import sostituiva la data finale della sessione e le date dei benchmark con l'ora dell'importazione. | Conservazione dei metadati temporali originali; fallback corrente soltanto se assenti. | Roundtrip con date storiche distinte per inizio, fine e benchmark. |
| L'intervallo originario non era esportato e veniva reimpostato a 1000 ms all'import. | `SessionSummary.interval_ms`, letto dal DB e trasferito nel JSON. I vecchi file privi del campo restano importabili con fallback 1000 ms. | Roundtrip di una sessione a 2500 ms e import legacy senza il campo. |
| L'import di uno snapshot ignorava `captured_utc`. | Conservazione del momento della cattura come inizio e fine della sessione di un campione. | Snapshot con data storica. |
| L'export interrompeva silenziosamente benchmark e avvisi a 10.000 elementi, pur esportando tutti i campioni. | Lettura completa degli eventi per l'export; limiti separati per viste e import. | Esportazione di 10.001 benchmark e 10.001 avvisi, con conteggi integrali. |
| Le letture articolate in più query potevano mescolare riepilogo e righe acquisiti prima e dopo un commit concorrente. | Una transazione di lettura deferred per elenco sessioni, caricamento, confronto ed export. | Una seconda connessione WAL salva tra due letture; la prima operazione resta coerente, quella successiva vede il nuovo dato. |
| Le statistiche dei benchmark nel confronto usavano soltanto gli ultimi 1000 run caricati per il replay. | Il confronto usa tutti i benchmark della sessione, senza il limite dell'anteprima. | 1001 run con valore significativo nel più vecchio: conteggio e media restano esatti. |
| Nella TUI un benchmark avviato nella sessione A poteva essere salvato nella B aperta prima del suo completamento. | La sessione di avvio viene catturata nella coda SQLite prima del carico e trasportata fino al risultato. Se nel frattempo è chiusa, il risultato resta separato. | Un vero microbenchmark CPU parte in A; A viene chiusa e B aperta durante il lavoro. CPU e fixture LLM non vengono attribuiti a B. |

Non sono cambiate le firme dei metodi pubblici di `Store`. L'aggiunta di
`interval_ms` al DTO ha un default serde per i JSON precedenti. Lo schema SQLite
resta alla versione 1: la colonna `sessions.interval_ms` era già presente.

## Verifiche eseguite

Nel progetto RUST-CPU, dopo l'ultima modifica:

```powershell
cargo test --lib storage::tests --locked
```

Esito: **18 test passati, 0 falliti**, inclusi cinque nuovi casi di regressione.
Sono passati anche `rustfmt --edition 2024 src/storage.rs` e `git diff --check`.
Questo esito riguarda i test dell'archivio; la compilazione Tauri e la verifica
dell'app desktop sono registrate nel rapporto generale del nuovo progetto.

Dopo la correzione dell'attribuzione dei benchmark nella TUI:

```powershell
cargo test --lib workspace_runtime::tests --locked
```

Esito: **8 test passati, 0 falliti**, compresi due nuovi test. Il primo esegue
un microbenchmark CPU reale mentre si passa dalla sessione A alla B e verifica
che nessun risultato CPU/LLM finisca nella B. Il secondo verifica che l'avvio
fallito di una sessione automatica non riutilizzi una sessione futura. Il carico
CPU o l'inferenza non iniziano senza conferma della sessione dalla coda SQLite.

I test esistenti controllano inoltre transazioni di import, rollback di payload
incoerenti, database estranei/futuri, backup occupato con deadline, nomi con
apostrofi, P95, confronto di metodi LLM diversi e conservazione dei dati mancanti.

## Contratti utili per il desktop

- `Store::preferences/save_preferences`: preferenze persistenti normalizzate.
  La normalizzazione numerica non convalida gli URL: il chiamante deve applicare
  `llm::validate_endpoint` a tutti gli endpoint prima del salvataggio.
- `begin_session_with_sample/append_sample/finish_session`: avvio atomico,
  campioni committati singolarmente e chiusura esplicita. Un processo interrotto
  può lasciare una sessione `open`; tale stato non dimostra che una registrazione
  sia ancora attiva in un altro processo.
- `list_sessions/load_session/compare`: consultazione coerente di uno snapshot
  del database, senza bloccare i writer WAL per l'intera durata della lettura.
- `export_session/import_session/backup`: file nuovi, niente sovrascrittura
  automatica e backup mediante API online SQLite.
- `bench::run`: microbenchmark volontario con cancellazione, due fasi di circa
  600 ms e al massimo 16 worker. Il profilo debug/ottimizzato è parte del risultato.
- `llm::probe_all/benchmark`: API sincrone che costruiscono un runtime Tokio.
  Vanno eseguite in worker o `spawn_blocking`, evitando il thread della WebView
  e una chiamata diretta all'interno di un altro runtime asincrono.

## Limiti da mostrare e scelte da rispettare

L'anteprima di una sessione può contenere meno campioni della registrazione e
carica al massimo 1000 benchmark e 1000 avvisi. Le statistiche dei campioni e il
confronto dei benchmark usano i dati completi. L'export JSON conserva tutti gli
eventi; l'import ha invece limiti espliciti di 64 MiB, 50.000 campioni e 10.000
benchmark/avvisi, quindi un export molto grande può richiedere consultazione
esterna o backup SQLite per la conservazione dell'intero archivio.

I campioni SQLite conservano soltanto i processi riconosciuti come LLM tramite
euristica sul nome. Il monitor live può mostrare tutti i processi; il replay non
deve presentarsi come una registrazione integrale del sistema. L'euristica non
attribuisce CPU/RAM/VRAM a una specifica conversazione.

GPU0 è il riferimento delle metriche aggregate archiviate; dispositivi o provider
diversi producono avvisi di confrontabilità. Gli zeri validi e i dati mancanti
hanno significati distinti. Le medie dei campioni non sono pesate sul tempo.

I benchmark CPU mix64 misurano soltanto quel kernel e non sono un punteggio
generale del processore. Il limite di 16 worker è intenzionale: un sistema con
più thread logici non viene necessariamente saturato. Il benchmark LLM richiede
un comando esplicito e limita l'output a 64 token; l'avvio dell'app non deve
produrre inferenza.

L'observer resta un proxy loopback facoltativo: misura soltanto richieste che il
client instrada esplicitamente alla sua porta. Prompt e risposte non vengono
persistiti. I test HTTP con server simulati non certificano ogni runtime reale.

## Correzione del ciclo benchmark e altri vincoli del runtime

La TUI ora usa `CaptureBenchmarkSession`, ordinato nella coda dopo l'avvio della
registrazione, e salva mediante `CpuForSession/LlmForSession` con identificativo
esplicito. Il thread del benchmark attende la risposta per un massimo di cinque
secondi prima di avviare il carico. I risultati di una sessione chiusa diventano
standalone; non vengono spostati nella nuova registrazione. Le vecchie varianti
`Cpu/Llm` rimangono disponibili per compatibilità, ma non vengono più utilizzate
dal runtime TUI per i benchmark interattivi.

Il collector e le operazioni SQLite sono sincroni: non devono vivere nel percorso
di rendering. La TUI originale usa un canale non limitato per i messaggi hardware;
per un desktop è preferibile mantenere l'ultimo snapshot e una storia limitata,
senza accumulare copie se la WebView viene sospesa o rallenta.

Una richiesta accodata non equivale a un salvataggio confermato. Errori di coda,
I/O o chiusura devono essere propagati e restare visibili; i dati già committati
non vanno dichiarati perduti e i comandi non confermati non vanno dichiarati
salvati.
