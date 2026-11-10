# CPU-RustT 0.2.0

Aggiornamento del monitor hardware desktop Rust/Tauri per Windows x64.

**Ideazione, struttura e sviluppo: Daniele Gabrovec.**
Copyright © 2026 Daniele Gabrovec. Licenza MIT; licenze delle dipendenze incluse.

- Ricerca rapida delle viste con Ctrl+K, Invio ed Esc.
- Archivio cercabile per nome/ID, filtro stato e pagine da 25 sessioni.
- Selezione A/B diretta, scambio dei lati e indicazione del risultato da ricalcolare.
- Ordinamento dei processi dalle intestazioni, accessibile da tastiera.
- Scroll delle tabelle e selezione negli input conservati durante gli aggiornamenti.
- Correzione dei falsi avvisi con contatori CPU/RAM/VRAM incoerenti.
- Importazioni incomplete conservate come tali; copie troncate rifiutate senza modificare l'archivio.
- Chiusura: perdita finale di campioni in coda segnalata come registrazione incompleta.

**Verifiche locali:** 160 test Rust, 16 gruppi frontend e 21 controlli nativi
sul portabile, ripetuti sulla copia installata. Installazione/disinstallazione,
riavvio durante registrazione, integrità SQLite e hash verificati.

Download: installer per l'utente corrente oppure ZIP da estrarre interamente.
Richiede Windows x64 e WebView2. Nessuna installazione Rust, Node.js o server SQLite.
Il setup è **non firmato digitalmente**.

Checksum dei tre pacchetti in `SHA256SUMS.txt`; manifest delle prove in
`VERIFICA-CONSEGNA.json`. Database, log ed esportazioni personali non sono pubblicati.

Piano, correzioni e attività future: [Revisione 0.2](https://github.com/danielegabrovec/CPU-RustT/blob/v0.2.0/docs/AUDIT-0.2.md).
Prove e limiti: [Verifiche](https://github.com/danielegabrovec/CPU-RustT/blob/v0.2.0/docs/VERIFICHE.md).
