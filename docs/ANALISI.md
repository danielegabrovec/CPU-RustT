# Analisi dati e diagnostica

CPU-RustT permette di esplorare le misure nel tempo e individuare segnali da
approfondire. I risultati descrivono il periodo selezionato; non attribuiscono
automaticamente cause e non certificano lo stato dei componenti.

## Leggere i grafici

Spostare il puntatore sul grafico: il cursore mostra l'ora, il valore delle serie
e la posizione del campione. Un valore non disponibile rimane una lacuna e viene
indicato come tale.

Per usare la tastiera:

1. Premere `Tab` fino a raggiungere il grafico.
2. Usare `←` e `→` per spostarsi di un campione.
3. Usare `Home` ed `End` per il primo e l'ultimo punto.

Nella vista **Processore**, il selettore **Serie CPU** permette di scegliere il
carico complessivo o un thread logico, confrontato con il totale. I thread sono i
processori logici esposti dal sistema operativo. Quando un campione archiviato
non contiene la topologia completa, l'app ne segnala il limite senza inventare
carichi per i core assenti.

In **Schede grafiche**, scegliere un adattatore oppure **Tutti gli adattatori**.
Ogni scheda dispone di grafici separati per utilizzo, memoria dedicata e
temperatura, quando il provider espone i dati. La memoria condivisa resta
distinta da quella dedicata. Anche questi grafici si leggono con puntatore e
tastiera.

## Scegliere i dati da analizzare

Aprire **Analisi dati**, scegliere **Origine dei dati** e **Finestra temporale**,
quindi premere **Analizza dati**. Sono disponibili gli ultimi 60 secondi,
180 secondi, 10 minuti oppure tutti i campioni disponibili nell'origine scelta.

| Origine | Dati utilizzati |
| --- | --- |
| Finestra live | Al massimo gli ultimi 180 campioni mantenuti in memoria. A 500 ms coprono circa 90 secondi, a 1000 ms circa tre minuti; la durata effettiva dipende dai campioni realmente acquisiti. |
| Sessione SQLite | Tutti i campioni salvati nella finestra richiesta, anche quando il replay ne mostra soltanto un'anteprima. |

Per una sessione, la finestra temporale è inclusiva ed è riferita al massimo
tempo trascorso registrato. Per esempio, una finestra di 60 secondi include i
campioni dal tempo finale meno 60 secondi fino al termine disponibile. Se la
raccolta è irregolare, il numero di punti può variare.

La voce **Tutti i campioni disponibili** del live rimane limitata ai 180 campioni
in memoria. Per conservare un lavoro più lungo occorre avviare una registrazione
e analizzare la sessione salvata.

## Interpretare le statistiche

Il selettore **Misura** mostra una serie; la tabella riporta tutte le risorse
disponibili: CPU totale e singoli core, RAM in percentuale e byte, ogni GPU con
utilizzo, memoria dedicata/condivisa, temperatura e potenza. Quando presenti,
sono incluse anche le velocità aggregate dei dischi e della rete.

| Campo | Significato |
| --- | --- |
| Presenti / assenti | Numero di misure valide e mancanti per quella risorsa. Un valore zero valido rimane presente. |
| Minimo / massimo | Estremi dei valori validi nella finestra. |
| Media | Media aritmetica dei campioni validi, senza pesatura per il tempo fra campioni. |
| Mediana | Valore centrale della serie ordinata; con un numero pari di valori, media dei due centrali. |
| P95 | Valore al rango `ceil(0,95 × N)`, contando da 1 nella serie ordinata dei valori validi. Non usa interpolazione fra ranghi. |
| Deviazione standard | Dispersione campionaria con denominatore `N − 1`; non disponibile con meno di due misure valide. |
| Delta ultimo − primo | Ultimo valore valido meno il primo, nell'ordine dei campioni. Non è il delta B − A della vista Confronto. |

I dati mancanti e i valori non finiti sono esclusi dalle statistiche, senza
trasformarli in zeri. Se non esistono valori validi, la statistica è non
disponibile. La durata è l'intervallo fra il minimo e il massimo tempo trascorso
validi; con un solo campione è zero.

I grafici dell'analisi mostrano al massimo **1000 punti distribuiti sull'intera
serie**, mantenendo primo e ultimo. Il conteggio dei punti del grafico può quindi
essere inferiore ai **campioni analizzati**: tutte le statistiche vengono
calcolate prima di questa riduzione. I valori estremi della serie completa
rimangono nella tabella anche se il relativo punto non compare nell'anteprima.

Per contenere l'uso di memoria, un'analisi di sessione con più di **100.000
campioni selezionati** restituisce un errore esplicito prima di caricarli.
Scegliere una finestra più breve; l'app non calcola statistiche su una porzione
troncata presentandola come sessione completa.

**Esporta analisi** crea il JSON del rapporto effettivamente visualizzato:
origine, conteggi, statistiche, punti e avvisi rimangono quelli dell'analisi
completata. Cambiare una selezione non modifica un report già calcolato:
premere **Analizza dati** per applicare la nuova origine o finestra. Il live
può essere aggiornato automaticamente soltanto attivando il relativo controllo.
Il JSON non sostituisce l'export completo della sessione o il backup SQLite.

**Esporta campione**, anche durante pausa o replay, salva il campione mostrato
con il relativo inventario. La presenza di un monitor live ancora attivo non
sostituisce la vista congelata con un campione successivo.

## Avvisi sulla qualità dei dati

Il rapporto segnala core parziali rispetto all'inventario, numero di core
variabile, cambi di adattatore/provider GPU e tempi trascorsi non monotoni.
Timestamp Unix uguali possono essere normali: la loro risoluzione è di un
secondo, mentre i campioni possono arrivare ogni 500 ms.

Se cambia il nome della GPU allo stesso indice, i valori del dispositivo diverso
non vengono mescolati nella stessa serie: diventano mancanti e viene mostrato
un avviso. Un cambio di provider richiede cautela nel confronto delle misure.
Percentuali finite fuori da 0–100% rimangono nei dati originali e nelle
statistiche, accompagnate da un avviso esplicito.

## Analizzare problemi e segnali

Aprire **Diagnostica**, scegliere origine e finestra e premere **Analizza
problemi**. Il risultato riporta livello, evidenza osservata e azione suggerita.
Le soglie CPU, RAM, VRAM e temperature sono configurabili nelle **Impostazioni**.

| Controllo | Misura esaminata |
| --- | --- |
| Carico CPU e RAM | Media dei campioni validi rispetto alla soglia configurata. |
| Temperatura GPU | Massimo disponibile nella finestra rispetto alla soglia. |
| VRAM e temperatura CPU | Ultimo campione disponibile, quando il provider espone la misura. |
| Spazio dei volumi | Ultimo campione: disponibilità pari o inferiore al 5% della capacità. |
| Ritardo di acquisizione | Età dell'ultimo campione live rispetto all'intervallo previsto. |
| Distribuzione fra thread | Differenza fra le medie dei thread; uno scarto di almeno 50 punti percentuali viene segnalato come informazione. |
| Fonti e dati | Misure mancanti, avvisi del collector, limiti dell'analisi ed errori del monitor o dell'archivio. |

Un carico elevato può corrispondere al lavoro richiesto. Una distribuzione
disuguale può essere normale per programmi poco paralleli. Una temperatura non
esposta non dimostra una temperatura anomala. Per i controlli sull'ultimo
campione, un valore precedente nella sessione può non essere rappresentato:
usare anche le statistiche e i grafici per esaminare il periodo.

## Eventi di sistema Windows facoltativi

**Leggi eventi Windows** avvia una consultazione del registro **System** delle
ultime **24 ore**, con un massimo di **100 eventi** critici, errori o avvisi.
I provider selezionati sono WHEA-Logger, Display, disk, stornvme, storahci e
Kernel-Power. Gli eventi sono una lettura del PC corrente, anche quando l'origine
dell'analisi è una sessione archiviata: non vengono attribuiti automaticamente
al periodo o alla causa del lavoro registrato.

L'operazione non modifica il registro e non richiede automaticamente
l'elevazione dei privilegi. Se Windows nega l'accesso o il provider non risponde,
l'app mostra un avviso. Nessun evento trovato significa soltanto nessun evento
corrispondente ai filtri: non certifica l'assenza di problemi. Anche la presenza
di un evento richiede interpretazione e non dimostra da sola un guasto hardware.

Per gli esiti delle prove sulla versione consegnata consultare
[Verifiche](VERIFICHE.md); per metodi e correzioni del motore,
[Audit del runtime](AUDIT-RUNTIME.md).
