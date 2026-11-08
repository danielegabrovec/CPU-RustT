# Audit della raccolta CPU e hardware

L'analisi ha riguardato `collector.rs`, `sensors.rs`, `gpu_windows.rs` e
`model.rs` del motore RUST-CPU, successivamente incluso in
`crates/monitor-core`. Questo documento descrive problemi e limiti osservati
nel codice; gli esiti complessivi della consegna sono in
[VERIFICHE.md](VERIFICHE.md).

## Correzione della freschezza dei campioni NVIDIA

Il worker `nvidia-smi` usava un canale con capacità uno e `try_send`.
Se il consumatore leggeva lentamente, il canale conservava il primo campione
non letto e scartava quelli successivi. Alla ricezione, il collector assegnava
`Instant::now()` al campione vecchio: il controllo di scadenza lo considerava
appena acquisito. Un intervallo lungo poteva quindi mostrare misure superate
come correnti.

La correzione sostituisce il canale con una mailbox che conserva l'ultima
lettura. Ogni aggiornamento include il timestamp di acquisizione; il collector
mantiene quel timestamp e applica a esso il limite di freschezza. Il lettore
usa `try_lock`, così non attende il worker GPU. Una lettura fallita non lascia
carico, memoria utilizzata, temperatura o potenza precedenti come valori live.

Due test di regressione controllano che un consumatore lento riceva l'ultima
acquisizione senza aggiornare il timestamp e che il consumo non blocchi su
una pubblicazione in corso. Le API pubbliche di `Collector` e `Snapshot`
restano compatibili.

## Logica già presente e mantenuta

| Aspetto | Comportamento riscontrato |
|---|---|
| CPU dei processi | `sysinfo` restituisce un valore cumulabile sui thread; il core lo divide per il numero di processori logici e mostra una quota dell'intero host. |
| Intervallo CPU | Il core segnala il riscaldamento e sopprime i contatori differenziali troppo ravvicinati. La GUI attende prima del primo campione e impone intervalli da 500 a 10.000 ms. |
| I/O | Le velocità derivano dalla differenza dei contatori cumulativi divisa per il tempo effettivamente trascorso; primo campione, reset e intervalli non validi sono gestiti. |
| Identità dei processi per I/O | La chiave include PID e ora di avvio, evitando di riutilizzare la baseline I/O di un PID riciclato. |
| Memoria NVIDIA | Le unità MiB del provider sono convertite in byte con fattore binario. |
| GPU Windows | WDDM correla adattatori tramite LUID interni; il carico rappresenta il motore più occupato, senza sommare motori diversi. |
| Memoria GPU | Dedicata e condivisa restano separate. Le attribuzioni per processo non vengono sommate per ricavare VRAM fisica. |
| Associazione sensori GPU | L'integrazione NVIDIA per nome avviene soltanto con corrispondenza esatta e non ambigua. Due adattatori identici non ereditano lo stesso sensore. |
| Inventario | CPUID e WMI/SMBIOS sono separati dal percorso di campionamento; la lettura WMI iniziale ha un limite d'attesa. |
| Sensori opzionali | LibreHardwareMonitor è letto su un worker isolato; dati avanzati scaduti o assenti sono omessi. |

## Dati mancanti e nuova interfaccia

Nel vecchio `History::push` della TUI, un carico GPU assente veniva convertito
in zero per la serie intera. Questo confondeva un contatore non disponibile
con una GPU inattiva.

La GUI Tauri conserva l'assenza come valore nullo: le schede mostrano N/D e il
rendering delle serie interrompe il tracciato sui punti mancanti. Lo zero
resta un valore misurato. Il vecchio contenitore `History` rimane nel codice
della CLI per compatibilità; la GUI non lo usa per la propria cronologia.

## Analisi dei campioni e segnalazioni Windows

La nuova vista Analisi dati calcola le statistiche nel motore Rust e mantiene
il conteggio dei valori presenti e mancanti. Media non pesata per tempo,
deviazione standard campionaria, P95 a rango più vicino e delta ultimo meno
primo sono dichiarati nell'interfaccia. Per le sessioni le statistiche precedono
la riduzione dei punti del grafico; l'esportazione include il report descrittivo.

I controlli di Diagnostica descrivono pressioni sulle risorse, dati non
disponibili, ritardi e avvisi. Le conclusioni restano legate alle misure e alle
soglie; un segnale non identifica la causa né dimostra un componente guasto.

`src-tauri/src/system_events.rs` aggiunge una lettura facoltativa e isolata del
registro System. Usa il cmdlet Microsoft
[Get-WinEvent](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent?view=powershell-5.1)
con filtro su registro, intervallo di 24 ore e livelli numerici 1/2/3; applica
una whitelist esatta di provider prima di limitare a 100 eventi. I provider sono
`Microsoft-Windows-WHEA-Logger`, `Display`, `disk`, `stornvme`, `storahci` e
`Microsoft-Windows-Kernel-Power`. Date UTC e ID sono restituiti senza deduzioni
automatiche sullo stato dell'hardware.

Il processo PowerShell viene avviato senza finestra e senza elevazione.
L'output è drenato separatamente per evitare blocchi della pipe, limitato a
1 MiB e soggetto a timeout di otto secondi. Nessun evento corrispondente è un
risultato vuoto valido; permessi insufficienti e provider non disponibili
producono avvisi. I test di parsing usano fixture sintetiche e non accedono
al registro eventi.

## Limiti ancora presenti

- Dalla revisione 0.1.1 WDDM riprova gli errori transitori e DXGI verifica
  la configurazione. L'inventario WMI iniziale resta memorizzato: alcuni
  dettagli statici dopo hotplug possono richiedere il riavvio.
- La disponibilità dei contatori dipende dal driver e dall'hardware.
  Il supporto del codice non equivale a una prova fisica su ogni GPU Intel,
  AMD o NVIDIA né su ogni sistema con più GPU.
- La frequenza OS può essere nominale. Non sono misurati clock effettivi per
  core, SPD diretto, timing RAM live, SMBus/MSR o SMART.
- Temperature e tensioni dipendono dai provider del sistema e dall'eventuale
  LibreHardwareMonitor già attivo. La presenza di sensori GPU non dimostra
  la disponibilità della temperatura CPU.
- Le sessioni SQLite conservano i contatori per thread dei campioni reali.
  La riduzione riguarda la lista dei processi, filtrata ai processi LLM.
  Il vettore `per_core: vec![cpu]` presente nelle fixture dei test non descrive
  una trasformazione applicata dalla persistenza ai campioni reali.
  Archivi precedenti incompleti restano leggibili; la GUI segnala quando manca
  la topologia completa invece di inventare thread o contatori.
- L'identificazione di un processo LLM dal nome è un indizio. Non dimostra
  quale conversazione stia usando la GPU. L'observer vede soltanto richieste
  che un client instrada esplicitamente attraverso il proxy.
- Le stime Capacity Lab e il microbenchmark mix64 hanno ipotesi e metodo
  dichiarati. Non misurano tutte le prestazioni del sistema e non sono
  punteggi CPU-Z.

Le verifiche native di questa consegna riguardano Windows. Le piattaforme e
i provider non presenti nelle prove restano non verificati; consultare il
report di consegna per distinguere test simulati, compilazione e uso reale.
