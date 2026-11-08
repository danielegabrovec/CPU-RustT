# Fonti hardware e significato delle misure

CPU-RustT legge i contatori del sistema operativo e i provider disponibili.
Un valore assente viene mostrato come non disponibile; un valore misurato pari
a zero indica invece inattività o assenza di utilizzo nel campione.

## CPU, thread e frequenza

| Dato | Fonte e interpretazione |
|---|---|
| Nome, istruzioni, cache | CPUID sui processori x86/x86-64; informazioni dichiarate dall'hardware. WMI aggiunge i dati firmware disponibili su Windows. |
| Core fisici e thread logici | Inventario `sysinfo`; il numero di thread determina la dimensione della griglia live. Non è imposto un limite visivo a 16 thread. |
| Carico CPU complessivo | Contatori differenziali `sysinfo`, normalizzati da 0 a 100% dell'intera macchina. |
| Carico di un thread logico | Percentuale di utilizzo di quel processore logico nel periodo misurato. |
| CPU di un processo | Il valore cumulativo `sysinfo` viene diviso per il numero di processori logici. Su una macchina con 16 thread, un processo che occupa interamente un solo thread rappresenta circa il 6,25% della capacità complessiva. |
| Frequenza OS | Media delle frequenze in MHz restituite da `sysinfo`. Può essere nominale: non misura il clock effettivo di ciascun core né certifica boost o throttling. |

I contatori CPU richiedono almeno due letture distanziate. La GUI attende
prima del primo campione e ammette intervalli richiesti da 500 a 10.000 ms.
La durata della raccolta è separata dall'intervallo richiesto: un provider lento
può allungare il tempo fra campioni. Il core segnala un campionamento troppo
ravvicinato e il relativo riscaldamento dei contatori.

Le istruzioni CPUID descrivono il supporto hardware; il sistema operativo può
limitarne l'uso. Il microbenchmark mix64 è facoltativo, usa due brevi fasi
singola/multithread e al massimo 16 worker. Questo limite del carico di prova
è distinto dal numero di thread osservabili nell'interfaccia. Il risultato
misura quel kernel intero, senza equivalere a un punteggio generale della CPU.

## RAM e processi

`sysinfo` restituisce capacità e utilizzo della memoria in byte. La GUI usa
unità binarie: KiB = 1.024 byte, MiB = 1.024² byte, GiB = 1.024³ byte.
La RAM totale è quella utilizzabile dal sistema operativo, che può essere
inferiore alla capacità fisicamente installata. Swap/pagefile rimane distinto
dalla RAM. Su Windows la memoria del processo rappresenta il working set.

I dettagli DIMM e la configurazione dichiarata provengono da WMI/SMBIOS.
Le velocità firmware sono etichettate come dichiarate, non come misure live.
Non vengono letti direttamente SPD, timing RAM, SMBus o registri MSR.

## GPU e memoria grafica

Su Windows il provider WDDM usa i contatori PDH con nomi inglesi, indipendenti
dalla lingua dell'interfaccia del sistema. DXGI correla gli adattatori tramite
LUID interni, che non vengono esportati come identificatori del computer.

- Il carico rappresenta il motore GPU più occupato. Vengono combinate le
  occupazioni dei processi sullo stesso motore; motori diversi non vengono
  sommati come se costituissero una sola percentuale.
- La memoria dedicata utilizzata e la memoria condivisa utilizzata sono campi
  separati. La capacità dedicata è quella dichiarata da DXGI; sulle GPU integrate
  può comprendere memoria di sistema riservata, distinta dalla RAM condivisa
  utilizzabile dinamicamente.
- Le attribuzioni dedicate/condivise per PID possono riferirsi a risorse visibili
  in più processi. Sommarle non ricostruisce la memoria fisica occupata.
- Quando disponibile, `nvidia-smi` aggiunge misure NVIDIA, inclusi temperatura
  in °C e potenza in watt. La memoria riportata in MiB viene convertita in byte
  con fattore binario. Un dato non supportato resta assente.
- L'integrazione dei sensori NVIDIA con gli adattatori DXGI usa una corrispondenza
  esatta del nome soltanto quando non è ambigua. Adattatori con lo stesso nome
  non ereditano automaticamente la medesima temperatura o potenza.

La mailbox NVIDIA conserva l'ultima acquisizione e il suo timestamp originale:
un consumatore lento non rende nuovamente fresco un campione vecchio. Le misure
NVIDIA oltre sei secondi e quelle WDDM oltre cinque secondi sono omesse come
dati correnti.

Dal secondo audit, WDDM riprova l'inizializzazione e gli errori di raccolta con
un'attesa di dieci secondi. Una factory DXGI non più corrente viene ricreata,
per aggiornare la configurazione degli adattatori. L'inventario WMI resta invece
memorizzato all'avvio: le relative descrizioni sono una fotografia iniziale.
Queste correzioni non equivalgono a una certificazione di hotplug su ogni driver.
Un provider bloccato dentro il driver rimane isolato dal percorso di lettura
della GUI; i dati scadono, ma il riavvio può essere necessario per ripristinarlo.

## Dischi, rete e sensori

Le velocità I/O sono differenze fra contatori cumulativi divise per il tempo
trascorso, in byte al secondo. Primo campione, contatore azzerato o intervallo
non valido non generano velocità ricavate dall'intera vita del dispositivo.
Per i processi, la baseline include PID e ora di avvio per gestire PID riciclati.
Volumi montati diversi possono condividere lo stesso dispositivo: il riepilogo
I/O non è un benchmark del disco. Non vengono eseguite prove SMART.

Le temperature disponibili provengono dai componenti esposti dal sistema e,
facoltativamente, da LibreHardwareMonitor già in esecuzione. Tensioni e altri
dettagli restano separati dalle temperature. Non viene installato o avviato
automaticamente un driver kernel.

La classificazione degli avvisi CPU esclude esplicitamente sensori GPU/Graphics:
una temperatura denominata `GPU Package` non diventa una temperatura CPU perché
contiene la parola `Package`. Un sensore mancante non equivale a una temperatura
anomala né a una temperatura sicura.

## Archivio, analisi e limiti delle prove

Le sessioni conservano i carichi per thread, le GPU, i dischi, la rete e i sensori
effettivamente presenti nei campioni. La lista dei processi archiviati è filtrata
ai processi riconosciuti come LLM. File precedenti o fixture parziali possono non
contenere tutta la topologia: la GUI lo dichiara senza ricostruirla dal totale.

Statistiche e confronti descrivono i campioni disponibili. Una CPU meno occupata
non dimostra da sola un lavoro più veloce. Le prove native della consegna
riguardano Windows x64; i test di retry e cambio configurazione WDDM usano un
controllore sintetico e non uno scollegamento fisico. La disponibilità di tutte
le misure su altri driver, GPU o sistemi operativi resta da verificare.

Fonti: [implementazione del collector](../crates/monitor-core/src/collector.rs),
[provider Windows](../crates/monitor-core/src/gpu_windows.rs),
[intervallo minimo sysinfo](https://docs.rs/sysinfo/0.39.6/sysinfo/constant.MINIMUM_CPU_UPDATE_INTERVAL.html),
[criteri delle misure GPU Microsoft](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/),
[documentazione NVIDIA SMI](https://docs.nvidia.com/deploy/nvidia-smi/index.html).
