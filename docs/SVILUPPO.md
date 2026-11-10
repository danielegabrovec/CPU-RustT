# Sviluppo e release

Workspace: `src-tauri` e `crates/monitor-core`, lockfile Cargo unico e target in
`src-tauri/target`. L'interfaccia usa asset locali e non richiede CDN.

## Prerequisiti

Windows x64, Rust 1.95+ MSVC, compilatore C++/Windows SDK, Node.js 24+,
PowerShell 7 e WebView2. Edge serve ai test frontend. Python 3.11+ serve solo
a rigenerare le licenze; Pillow solo a rigenerare l'icona già inclusa.

```powershell
npm ci
npm run dev
```

Aprire solo `web/index.html` non abilita il backend Rust.

## Gate

```powershell
npm run check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
npm run test:frontend
```

`scripts/verify.ps1` esegue questi controlli e si ferma al primo errore.
`-LiveHardware` include anche la prova opzionale Rust con hardware reale e
breve microbenchmark CPU. I test LLM/observer usano server HTTP simulati.

Le fixture frontend comprendono molti thread, più GPU, dati mancanti, errori,
grafici, report congelati, moduli, temi e dimensioni ridotte. La galleria è
contrassegnata come dimostrativa e non mostra dati del computer reale.

## Prova nativa isolata

Chiudere altre istanze, compilare e avviare:

```powershell
npm run test:native
node tests/run-native.mjs --exe src-tauri/target/debug/cpu-rustt.exe
```

Il runner avvia un processo di prova, sceglie una porta loopback temporanea
per WebView2 e crea dati sotto `test-output/native-runs`. Verifica il percorso
prima di modificare l'archivio e chiude soltanto il proprio processo al termine.
I risultati e gli screenshot reali restano esclusi da Git. Il runner verifica anche
la chiusura normale durante una registrazione, l’integrità SQLite e la riapertura
dello stesso archivio con sessioni e preferenze conservate.

Il benchmark CPU è confermato nel dialogo; non viene avviato un benchmark LLM.
`npm run test:native:attach` è il livello inferiore per una WebView di prova
già aperta: richiede i percorsi e la porta CDP previsti dal relativo script.

## Pacchetti

```powershell
.\scripts\build.ps1
```

Lo script verifica, costruisce Tauri e prepara in `artifacts`: eseguibile,
installer NSIS della versione corrente, ZIP portabile e SHA-256. Lo ZIP contiene
soltanto eseguibile, guida, LICENSE e THIRD-PARTY-NOTICES. Un vecchio setup in
cache non viene rinominato come nuovo. La versione è controllata fra npm,
Cargo, configurazione Tauri e lockfile.

Usare `-SkipChecks` solo dopo i gate sulla stessa revisione. Il setup è per
l'utente corrente e non firmato. Le risorse installate comprendono le licenze;
l'app le rende leggibili anche offline.

La build disabilita il patching del tipo di bundle Tauri: non è usato un
updater multipacchetto e il binario installato deve avere lo stesso hash del
binario portabile. La prova dell'installer verifica questa corrispondenza.

## Licenze e autore

**Ideazione, struttura e sviluppo: Daniele Gabrovec.**
Le dipendenze mantengono autori e condizioni proprie. Dopo modifiche ai lockfile:

```powershell
npm ci
cargo fetch --locked --target x86_64-pc-windows-msvc
python scripts/generate-notices.py
```

Gli upstream dei testi aggiuntivi sono in `scripts/license-texts/SOURCES.json`.
Il generatore rifiuta dipendenze Cargo senza testi di licenza e non include
percorsi locali nel documento pubblico.

## Pubblicazione

1. Aggiornare versione, changelog, documentazione e immagini sintetiche.
2. Verificare, compilare, provare il file finale e l'installer.
3. Controllare l'esatto insieme tracciato con `npm run check:publication`.
4. Pubblicare il commit e attendere GitHub Actions.
5. Taggare la revisione verificata e creare una release con pacchetti, checksum
   e note. Scaricare nuovamente gli asset per verificarne gli hash.

Database, log, `.env`, report reali, cache, binari e `node_modules` sono esclusi
dalla storia Git. I binari sono allegati alle release. La CI genera artefatti
di build; la pubblicazione della release è un passaggio esplicito successivo.
