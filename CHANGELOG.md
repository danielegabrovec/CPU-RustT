# Changelog

## 0.2.0 — 10 novembre 2026

- Archivio con ricerca per nome/ID, filtro dello stato e pagine da 25 sessioni.
- Assegnazione A/B nell'archivio, scambio dei lati e indicazione esplicita del confronto da ricalcolare.
- Intestazioni ordinabili dei processi, stato accessibile dell'ordinamento e navigazione rapida delle viste con Ctrl+K.
- Scorrimento delle tabelle e focus conservati durante gli aggiornamenti; adattamenti per finestre strette e temi.
- Avvisi CPU/RAM/VRAM escludono valori incoerenti senza consumare il cooldown delle misure valide.
- Import di sessioni interrotte o aperte conserva lo stato incompleto; conteggi troncati/incoerenti vengono rifiutati senza modificare l'archivio.
- Chiusura: un overflow finale della coda non può dichiarare completa una registrazione con campioni mancanti.
- Test nativi estesi a ricerca, ordinamento, filtri, chiusura durante registrazione e riapertura dello stesso archivio.

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
