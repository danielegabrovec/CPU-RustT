# Autore, copyright e licenze

**CPU-RustT**

**Ideazione, struttura e sviluppo: Daniele Gabrovec.**

Copyright © 2026 Daniele Gabrovec.

Il codice originale dell'applicazione è distribuito con licenza **MIT**.
Il testo completo, inclusi permessi, condizioni e clausole della licenza,
è nel file [LICENSE](../LICENSE). L'indicazione dell'autore è riportata
anche nei metadati Windows, nell'installer e nella schermata
**Informazioni e licenze** dell'applicazione.
Questi metadati non costituiscono una firma digitale: i pacchetti di questa
release non sono firmati con un certificato di code signing.

## Componenti di terze parti

CPU-RustT usa librerie indipendenti, fra cui Tauri, Rust/sysinfo, SQLite e
componenti dei rispettivi ecosistemi. Questi componenti conservano i propri
autori, copyright e condizioni di licenza: l'attribuzione dell'applicazione
a Daniele Gabrovec non attribuisce a lui la paternità delle dipendenze.

Le versioni sono bloccate nei lockfile. I testi di licenza e gli avvisi
dei componenti Windows e degli strumenti di sviluppo sono raccolti in
[THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt), consultabile anche
nell'app senza collegarsi a Internet. Il file è generato da
`scripts/generate-notices.py`; i testi upstream mancanti nei pacchetti
sono conservati con i rispettivi URL in `scripts/license-texts`.

Il codice sorgente della dipendenza `selectors`, soggetta a MPL-2.0,
è disponibile nella versione indicata nel lockfile su
[crates.io](https://crates.io/crates/selectors). Non sono state apportate
modifiche a tale dipendenza. Il motore incluso `crates/monitor-core`
deriva da RUST-CPU dello stesso autore ed è incluso con la sua licenza MIT.

## Nome e indipendenza

CPU-RustT è un progetto indipendente. Non è affiliato a CPUID/CPU-Z,
Microsoft o ai produttori dell'hardware rilevato. I nomi dei prodotti
riportati dall'inventario restano dei rispettivi titolari.

## Dati e funzionamento

L'applicazione non richiede un account e non invia automaticamente
telemetria, database o report a servizi esterni. SQLite ed esportazioni
restano nelle cartelle indicate dall'app. Le API LLM supportate sono
limitate a origini loopback; il runtime locale ha una propria configurazione.
L'installazione di WebView2, quando assente, può richiedere il download del
runtime Microsoft da parte dell'installer.

I report possono contenere nomi di processi, modelli, volumi, interfacce
ed eventi Windows. La pubblicazione del repository non include i report
reali del computer dell'autore; la galleria usa dati sintetici dichiarati.

Misure, stime e controlli aiutano a esaminare il periodo registrato:
non certificano la stabilità né attribuiscono automaticamente la causa
di un possibile problema hardware. Metodi e limiti sono descritti in
[ANALISI.md](ANALISI.md) e [HARDWARE.md](HARDWARE.md).
