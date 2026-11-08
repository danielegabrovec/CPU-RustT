# Changelog

## 0.1.1 — seconda revisione e prima release pubblica

- Export coerenti con pausa/replay e report analitico visualizzato.
- Grafici precisi a 500 ms; cursore, selezioni e bozze dei moduli conservati.
- Risposte runtime obsolete ignorate, aggiornamento periodico dei metadati locali.
- Comandi scaduti/abbandonati non eseguiti successivamente dalla coda.
- Drenaggio in chiusura e recupero completo delle sessioni aperte.
- Rifiuto dei numeri non finiti che rendevano il JSON SQLite illeggibile.
- Retry WDDM e ricostruzione DXGI quando cambia configurazione.
- GPU Package distinto dalla CPU, dati impossibili distinti dalla pressione.
- Dati GPU mancanti distinti da zero anche nella CLI; eventi serializzati e Unicode sicuro.
- Testi più leggibili, feedback espliciti e statistiche live aggiornabili su scelta.
- Informazioni e licenze offline: **Ideazione, struttura e sviluppo: Daniele Gabrovec**.
- Licenze incorporate, copyright e versioni Windows coerenti.
- Fixture frontend ripetibile, galleria dimostrativa e runner nativo isolato.
- Installer, ZIP portabile, checksum, CI Windows e test core Linux.
- Manuale, guida statistica, hardware, architettura, sviluppo e audit aggiornati.

## 0.1.0 — prima versione locale

Motore RUST-CPU integrato in un'app Tauri autonoma con 14 viste, raccolta in
background, sessioni SQLite, statistiche, grafici, benchmark e diagnostica.
