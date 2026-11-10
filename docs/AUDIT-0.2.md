# Revisione CPU-RustT 0.2

Data: 10 novembre 2026. Ambito: app Tauri autonoma, core incorporato, interfaccia,
prove native, installer e pubblicazione. La cartella originale RUST-CPU non fa
parte di queste modifiche. Dati di prova reali e archivi restano esclusi da Git.

## Piano e priorità

1. Correttezza dei dati: separare misure impossibili da pressione hardware,
   impedire importazioni apparentemente complete di copie troncate e conservare
   lo stato reale delle registrazioni, anche durante la chiusura.
2. Chiarezza delle operazioni: distinguere selezioni A/B dal risultato già
   calcolato, rendere espliciti gli stati e preservare il contesto durante i refresh.
3. Uso quotidiano: trovare sessioni e viste rapidamente; ordinare i processi
   senza dipendere dal mouse; limitare le righe visibili nell'archivio.
4. Verifica e distribuzione: test di regressione, WebView nativa sul binario
   finale, chiusura/riapertura, installazione isolata, CI e hash degli asset.

## Problemi e correzioni

| Evidenza nel codice precedente | Intervento | Verifica pertinente |
|---|---|---|
| Un valore CPU superiore al 100% o memoria usata maggiore del totale poteva produrre un allarme hardware. | I contatori incoerenti non alimentano gli avvisi e non consumano il cooldown. | Regressione con valori fuori intervallo, infinito e successivi valori validi. |
| L'import assegnava sempre lo stato complete. | Sessioni incomplete e copie di sessioni aperte vengono importate come incomplete. | Roundtrip di tre stati. |
| Un'anteprima o un JSON troncato poteva diventare una nuova sessione apparentemente completa. | Confronto fra campioni presenti e conteggi dichiarati prima della transazione; rifiuto di stati sconosciuti. | Payload troncati/incoerenti rifiutati senza INSERT; conteggi zero legacy restano non specificati. |
| Overflow della coda fra ultimo controllo e arresto non riconosciuto. | Nuovo controllo dopo il drenaggio del campionatore prima della finalizzazione. | Ultimi campioni conservati e registrazione incompleta. |
| Selettori A/B cambiati ma risultato precedente ancora visibile senza distinzione. | Indicazione del confronto da ricalcolare e nomi delle origini visualizzate. | Fixture e prova nativa. |
| Archivio lungo ridisegnato con tutte le righe, ricerca assente. | Ricerca nome/ID, filtro stato, paginazione da 25 righe, assegnazioni A/B. | Fixture con molti record e controlli nativi dei filtri. |
| Ordinamento processi dipendente dai controlli separati. | Pulsanti nelle intestazioni con aria-sort, attivabili da tastiera. | Fixture e prova WebView reale. |
| Numerose viste da percorrere manualmente. | Ricerca della navigazione e scorciatoia Ctrl+K. | Tastiera, filtri e finestra ridotta. |

## Migliorie future e limiti

- Per archivi oltre il limite attuale della lista backend, servono ricerca e
  paginazione SQL: la paginazione UI si applica alle sessioni caricate.
- Per conservare tutti i processi storici occorre una scelta esplicita di schema,
  spazio e privacy: il replay attuale conserva i processi identificati come LLM.
- L'inventario firmware viene letto all'avvio; il rinnovo completo dopo modifiche
  hardware richiede ancora riavvio. Hotplug fisico e guasti driver non simulati.
- Nuovi provider temperature/SMART richiedono API documentate e hardware di prova;
  nessun valore assente viene inventato e nessun driver viene installato.
- Firma del codice e prove su Windows pulito restano attività di distribuzione
  separate; macOS/Linux desktop non sono certificati.
- Il risultato dei controlli non costituisce una diagnosi delle cause hardware.

Gli esiti effettivi della revisione sono registrati in [VERIFICHE.md](VERIFICHE.md).
