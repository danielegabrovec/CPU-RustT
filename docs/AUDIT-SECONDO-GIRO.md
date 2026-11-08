# Secondo audit: core, desktop e interfaccia

Questo audit riguarda il core autonomo incluso in `crates/monitor-core`.
Le modifiche descritte qui non sono state applicate alla cartella originale
RUST-CPU. Il documento contiene soltanto prove ripetibili e dati sintetici;
non include percorsi personali, processi reali o contenuti dei log del computer.

## Problemi corretti

| Problema osservato nel codice | Correzione | Prova pertinente |
|---|---|---|
| Il worker WDDM terminava definitivamente al primo errore di inizializzazione. Un errore transitorio impediva ogni aggiornamento successivo. | Stato del provider recuperabile con backoff di dieci secondi; gli errori della raccolta invalidano il provider e consentono un nuovo tentativo. | Test del controllore con creazione fallita, tentativo prematuro escluso e successiva creazione riuscita. |
| Factory e query potevano continuare a usare una configurazione DXGI superata. | Controllo `IsCurrent`, invalidazione e nuova enumerazione; al ritorno di un sottoscrittore viene creata una configurazione corrente. | Test della transizione di stato con invalidazione immediata; compilazione Windows dell'integrazione DXGI. |
| L'archivio accettava campi numerici obbligatori non finiti dentro thread, sensori o I/O. `serde_json` li convertiva in `null`, salvando un campione che `Snapshot` non poteva rileggere. Lo stesso rischio esisteva in benchmark e avvisi. | Validazione prima dell'INSERT; l'operazione rifiuta il valore e mantiene leggibili i dati già salvati. | Fixture `NaN`/infinito per contatori per thread, sensori, processo LLM, disco, rete, benchmark CPU/LLM e avvisi; nessun record invalido commesso. |
| Il recupero delle sessioni aperte dipendeva da una lista UI limitata. Sessioni più vecchie potevano restare aperte. | Nuovo `interrupt_open_sessions()` con un solo UPDATE su tutte le righe aperte. | 5.002 sessioni aperte recuperate; una sessione già completa e la sua data finale rimangono intatte; seconda chiamata modifica zero righe. |
| La cronologia GPU della CLI convertiva un valore assente in zero. | `VecDeque<Option<u64>>`; la Sparkline distingue l'assenza con un simbolo separato. Uno zero misurato rimane `Some(0)`. | Fixture con zero, assenza, `NaN` e valore valido; cronologia ancora limitata a 180 punti. |
| Un sensore denominato `GPU Package` o `Graphics Package` poteva essere classificato come temperatura CPU perché conteneva `Package`. | Esclusione esplicita dei marcatori GPU/Graphics prima dei marcatori CPU/Package/Tctl. | Due sensori GPU caldi non generano avvisi CPU; aggiungere un sensore CPU caldo produce soltanto l'avviso pertinente. |

Per l'integrazione dell'export coerente con la vista, le quattro strutture
analitiche implementano anche `Deserialize`. Questo mantiene un contratto
tipizzato quando il backend riceve il report già visualizzato. Non cambia
il metodo delle statistiche né ricostruisce dati mancanti.

## Parti riesaminate senza correzioni inventate

Normalizzazione CPU per processo, unità binarie NVIDIA, differenze dei contatori
I/O, reset, chiave PID/ora di avvio e separazione dedicata/condivisa erano già
corrette. L'analisi usa valori mancanti distinti dagli zeri, P95 a rango più
vicino e deviazione standard campionaria. Le statistiche sono calcolate prima
della riduzione dei punti del grafico.

Il replay conserva i carichi per thread realmente presenti. La fixture con
`per_core: vec![cpu]` è un campione di test ridotto, non una trasformazione
applicata ai dati reali dalla persistenza. La riduzione intenzionale dell'archivio
riguarda la lista dei processi, limitata a quelli riconosciuti come LLM.

## Verifiche eseguite sul core

```powershell
cargo test --manifest-path crates/monitor-core/Cargo.toml --all-targets --locked
cargo clippy --manifest-path crates/monitor-core/Cargo.toml --all-targets --locked -- -D warnings
cargo fmt --manifest-path crates/monitor-core/Cargo.toml -- --check
```

- **130 test unitari passati**.
- **6 test CLI passati**, comprese acquisizione headless e operazioni SQLite.
- Target di esempio compilato.
- Clippy senza warning e controllo di formattazione superato.

Questi risultati descrivono il core alla conclusione di questo audit. I test
desktop, le interazioni nella WebView, il confezionamento e i controlli della
release hanno evidenze separate in [VERIFICHE.md](VERIFICHE.md); non sono dedotti
dal solo superamento dei test unitari.

## Rischi residui e limiti delle prove

Il recupero WDDM e l'invalidazione della configurazione sono coperti da un
controllore sintetico e dalla compilazione Windows. Non è stato scollegato
fisicamente un adattatore né simulato un guasto reale del driver. Hardware,
driver e provider non presenti nelle prove restano non verificati.

L'inventario WMI è memorizzato all'avvio. Il rinnovo della telemetria DXGI non
aggiorna automaticamente ogni descrizione firmware o voce d'inventario.
Un provider bloccato indefinitamente dentro una chiamata del driver può restare
non disponibile anche se la GUI continua a ricevere il valore N/D.

Le validazioni impediscono nuovi payload obbligatori illeggibili; non effettuano
una riparazione automatica di archivi alterati in precedenza da altri client.
La recuperabilità del database e l'effettiva disponibilità dei sensori sono
proprietà distinte. La presenza o l'assenza di avvisi non certifica l'integrità
dell'hardware.

File principali: [WDDM](../crates/monitor-core/src/gpu_windows.rs),
[persistenza](../crates/monitor-core/src/storage.rs),
[modello e cronologia](../crates/monitor-core/src/model.rs),
[rendering CLI](../crates/monitor-core/src/ui.rs),
[avvisi](../crates/monitor-core/src/settings.rs),
[analisi](../crates/monitor-core/src/analysis.rs).

## Integrazione desktop e interfaccia

| Problema desktop/UI | Correzione e prova |
|---|---|
| Export del campione live mentre la vista era in pausa o replay; analisi ricalcolata al momento dell'export. | Contesti tipizzati e validati, esportazione esatta della vista/report; test backend e fixture confrontano timestamp e valori. |
| Risposta LLM relativa a endpoint precedenti; metadati non aggiornati. | Generazione delle sonde, scarto delle risposte obsolete e aggiornamento periodico solo dei metadati loopback. |
| Richieste abbandonate o scadute ancora eseguite dalla coda. | Deadline e segnale del chiamante verificati prima delle mutazioni; test con comando accodato e chiamante assente. |
| Chiusura prima dell'ultimo campione e perdita degli errori finali. | Drenaggio controllato, ordine di chiusura e conservazione dell'errore; prova di registrazione durante l'arresto. |
| Dati impossibili interpretati come pressione o temperatura GPU attribuita alla CPU. | Controlli di qualità separati e classificazione coerente dei sensori, con test dei casi negativi. |
| Letture eventi concorrenti e testo UTF-16 troncato a metà carattere. | Guardia della scansione e limite Unicode sicuro; parser e fixture verificati. |
| Punti a 500 ms sovrapposti e cursore/selezioni persi durante il refresh. | Asse del tempo trascorso preciso, cursore e selezioni preservati. |
| Bozze e ripetizioni azzerate, pulsanti riabilitati dopo il render durante un benchmark. | Stato dei moduli e controlli preservato; test dei flussi di modifica e busy/finally. |
| Selettore di origine non corrispondente al report già mostrato. | Distinzione esplicita fra selezione e analisi completata, aggiornamento automatico su scelta. |
| Testi troppo piccoli e attribuzione/licenze poco raggiungibili. | Tipografia più leggibile, navigazione raggruppata e dialogo Informazioni e licenze offline con autore Daniele Gabrovec. |

Backend desktop: **20 test passati**, compresa la prova esplicita su hardware.
Interfaccia: **12 gruppi di regressione** con fixture sintetiche e nessun errore
JavaScript. La prova nativa sul binario distribuito e la prova dell'installer
sono registrate separatamente in [VERIFICHE.md](VERIFICHE.md).

L'esportazione tipizzata è riepilogata in [ARCHITETTURA.md](ARCHITETTURA.md).
