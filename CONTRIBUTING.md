# Contribuire a CPU-RustT

Il progetto è ideato, strutturato e sviluppato da **Daniele Gabrovec**.
Contributi e segnalazioni sono benvenuti tramite issue o pull request.

Usare Windows x64 per le modifiche all'app desktop. Leggere
[SVILUPPO.md](docs/SVILUPPO.md), mantenere il lockfile e aggiungere test
per i bug risolti. Eseguire `scripts/verify.ps1`; per modifiche alla finestra
eseguire anche `npm run test:native` su un binario appena compilato.

Includere descrizione del problema, comportamento corretto e verifiche.
Per la UI controllare tastiera, temi, dati mancanti e dimensioni ridotte.
Le medie e le statistiche devono dichiarare il metodo; non trasformare
misure assenti in zero né presentare una stima come misura fisica.

Non aggiungere credenziali, database, eventi di sistema reali, report hardware,
nomi di processi personali o screenshot del computer nelle PR. Usare fixture
sintetiche dichiarate. Le dipendenze modificate richiedono il controllo delle
rispettive licenze e l'aggiornamento degli avvisi di terze parti.

I contributi sono distribuiti secondo la licenza MIT del progetto,
preservando attribuzioni e licenze dei componenti di terze parti.
