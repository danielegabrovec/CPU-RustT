# Audit della logica Rust e nuova applicazione

Questo documento raccoglie il primo giro di revisione. Le correzioni successive
della release 0.1.1 sono in [AUDIT-SECONDO-GIRO.md](AUDIT-SECONDO-GIRO.md).

8 novembre 2026. Il progetto `CPU-RustT` è autonomo, nella cartella accanto a
`RUST-CPU`; il motore revisionato è incluso in `crates/monitor-core`. Non occorre
conservare la cartella originale per compilare o avviare la nuova applicazione.
Le correzioni al motore sono state riportate anche nel progetto originale.

## Errori corretti

| Problema | Risultato della correzione |
|---|---|
| Il worker NVIDIA poteva conservare una lettura vecchia e assegnarle una nuova data di freschezza. | Ultima acquisizione disponibile con timestamp originale e scadenza effettiva. |
| L'importazione alterava le date originali di sessioni, benchmark e snapshot. | Conservazione dei metadati temporali presenti nel file. |
| L'intervallo della sessione veniva sostituito con 1000 ms. | Intervallo conservato; fallback esplicito per file precedenti senza il campo. |
| L'export tagliava silenziosamente gli eventi oltre 10.000 righe. | Esportazione integrale; limiti separati e dichiarati per import e anteprime. |
| Query articolate potevano vedere istanti SQLite differenti durante scritture concorrenti. | Transazioni di lettura coerenti con WAL. |
| Il confronto dei benchmark usava soltanto gli ultimi 1000 risultati. | Statistiche calcolate sull'intera storia del gruppo compatibile. |
| Un benchmark poteva essere attribuito alla nuova sessione aperta prima del suo completamento. | Sessione catturata all'avvio; se chiusa il risultato rimane separato, senza trasferirsi alla successiva. |
| Una fixture HTTP poteva leggere un socket Windows ancora non bloccante. | Modalità della fixture impostata esplicitamente, con timeout di lettura. |

Normalizzazione della CPU per processo sulla capacità dell'intera macchina,
unità MiB, differenze I/O sul tempo effettivo e reset dei contatori risultano
già corretti. Nessuna correzione inventata su queste parti.

## Funzioni aggiunte nel desktop

- Finestra Tauri con 14 viste, temi, comandi accessibili e raccolta Rust separata dal rendering.
- Thread CPU senza limite visivo a 16; selezione di una serie individuale e confronto col totale.
- Selezione di ogni GPU rilevata, con grafici di carico, memoria e temperatura.
- Grafici con cursore, valori al passaggio del mouse e navigazione da tastiera.
- Analisi descrittiva Rust su dati live o sessioni SQLite: minimo, massimo,
  media, mediana, P95, deviazione campionaria, delta e dati mancanti.
- Controlli dei problemi con evidenze, soglie e azioni suggerite; lettura opzionale
  degli eventi Windows pertinenti delle ultime 24 ore.
- Sessioni, replay, confronto A/B, import/export, backup e preferenze persistenti.
- Coda di raccolta limitata: un overflow viene dichiarato e interrompe la
  registrazione come incompleta, evitando perdite silenziose.
- Annullamento benchmark immediato anche mentre l'archivio è occupato e
  chiusura con cancellazione e drenaggio dei risultati completati.

I campioni conservano i carichi reali per thread, tutte le GPU, dischi e rete.
L'archiviazione dei processi conserva soltanto quelli riconosciuti come LLM:
il replay non è una registrazione integrale di tutti i processi del computer.

## Limiti ancora presenti

La revisione 0.1.1 aggiunge retry WDDM dopo errori transitori e ricrea DXGI
quando cambia la configurazione. L'inventario WMI resta memorizzato all'avvio.
Temperature CPU e sensori avanzati dipendono dalle
fonti esposte dal sistema o da LibreHardwareMonitor già attivo. Non vengono
installati driver, eseguiti accessi SPD/MSR/SMBus o effettuate prove SMART.

La media statistica assegna lo stesso peso a ogni campione; non è pesata per
durata. Le analisi live usano al massimo 180 campioni, quelle archiviate tutti
i campioni selezionati fino al limite esplicito di 100.000. I grafici possono
essere ridotti a 1000 punti; le statistiche precedono la riduzione.

Gli avvisi non certificano un guasto e gli eventi Windows non identificano
automaticamente una causa. Non è stato eseguito un test distruttivo o di
stabilità prolungata dell'hardware. Il microbenchmark CPU misura il solo
kernel mix64; non è un punteggio generale o proprietario.

La verifica nativa di questa consegna riguarda Windows x64. Il setup non è
firmato. L'inferenza LLM richiede un comando esplicito; i test HTTP simulati
non equivalgono a prove su ogni runtime e modello reale.

Dettagli: [raccolta CPU/GPU](AUDIT-CPU.md), [archivio e runtime](AUDIT-RUNTIME.md),
[metodi di analisi](ANALISI.md), [verifiche della consegna](VERIFICHE.md).

Fonti tecniche consultate: [comandi Tauri](https://v2.tauri.app/develop/calling-rust/),
[capabilities Tauri](https://v2.tauri.app/security/capabilities/),
[intervallo CPU sysinfo](https://docs.rs/sysinfo/0.39.6/sysinfo/constant.MINIMUM_CPU_UPDATE_INTERVAL.html),
[Get-WinEvent Microsoft](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent).
