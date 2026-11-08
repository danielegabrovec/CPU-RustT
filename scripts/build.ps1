#requires -Version 7.0
param([switch]$SkipChecks)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
    $package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
    $config = Get-Content -LiteralPath src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
    $version = $package.version
    if ($config.version -ne $version) { throw 'Versione package/Tauri incoerente' }
    if (-not (Test-Path -LiteralPath node_modules/@tauri-apps/cli)) {
        npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Installazione dipendenze fallita' }
    }
    if (-not $SkipChecks) { & ./scripts/verify.ps1 }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build Tauri fallita' }
    New-Item -ItemType Directory -Path artifacts -Force | Out-Null
    Copy-Item -LiteralPath src-tauri/target/release/cpu-rustt.exe -Destination artifacts/CPU-RustT.exe -Force
    $setupName = "CPU-RustT_${version}_x64-setup.exe"
    $setup = Join-Path 'src-tauri/target/release/bundle/nsis' $setupName
    if (-not (Test-Path -LiteralPath $setup)) { throw "Installer atteso non trovato: $setup" }
    Copy-Item -LiteralPath $setup -Destination (Join-Path artifacts $setupName) -Force
    $portableDir = Join-Path 'test-output' "portable-$version"
    New-Item -ItemType Directory -Path $portableDir -Force | Out-Null
    Copy-Item -LiteralPath artifacts/CPU-RustT.exe,LICENSE,THIRD-PARTY-NOTICES.txt -Destination $portableDir -Force
    @(
        "CPU-RustT $version - Windows x64",
        'Ideazione, struttura e sviluppo: Daniele Gabrovec.',
        'Copyright (c) 2026 Daniele Gabrovec. Licenza MIT (vedere LICENSE).',
        '',
        'Avvio: estrarre tutto lo ZIP e aprire CPU-RustT.exe.',
        'Richiede Microsoft Edge WebView2. Nessuna installazione Rust/Node/SQLite necessaria.',
        'Database: %LOCALAPPDATA%\it.gabrovec.cpu-rustt\workspace.sqlite3',
        'Letture locali; avviare Registra sessione per conservare un lavoro.',
        'CPU/GPU: grafici con hover e tastiera; Analisi dati per statistiche; Diagnostica per i problemi.',
        '',
        'Guida, codice sorgente e aggiornamenti: https://github.com/danielegabrovec/CPU-RustT',
        'I componenti terzi mantengono le rispettive licenze (THIRD-PARTY-NOTICES.txt).'
    ) | Set-Content -LiteralPath (Join-Path $portableDir 'LEGGIMI.txt') -Encoding utf8
    $zipName = "CPU-RustT_${version}_windows-x64.zip"
    $portableFiles = @('CPU-RustT.exe','LICENSE','THIRD-PARTY-NOTICES.txt','LEGGIMI.txt') | ForEach-Object { Join-Path $portableDir $_ }
    Compress-Archive -LiteralPath $portableFiles -DestinationPath (Join-Path artifacts $zipName) -Force
    $hashes = @('CPU-RustT.exe', $setupName, $zipName) | ForEach-Object { Get-FileHash -LiteralPath (Join-Path artifacts $_) -Algorithm SHA256 }
    $hashes | ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_.Path))" } | Set-Content -LiteralPath artifacts/SHA256SUMS.txt -Encoding utf8
    Write-Host 'Eseguibile, ZIP portabile e installer pronti nella cartella artifacts.'
} finally { Pop-Location }
