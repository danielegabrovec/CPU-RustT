#requires -Version 7.0
param([string]$Installer)

$ErrorActionPreference = 'Stop'
$installerProjectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$installerRunRoot = $null
$installerTarget = $null
$installerWasStarted = $false
$installerTestFailure = $null
$installerCleanupFailure = $null
$installerTestPassed = $false
$installerTestReport = [ordered]@{
    started_utc = [DateTime]::UtcNow.ToString('o')
    passed = $false
    exit_code = 1
    version = $null
    installer = $null
    installation_directory = $null
    preflight = [ordered]@{ passed = $false; preexisting_installations = @() }
    install = [ordered]@{ started = $false; process_id = $null; exit_code = $null }
    validation = [ordered]@{ passed = $false; executable = $null; product_version = $null; hashes = @(); registry = @() }
    native = [ordered]@{ started = $false; exit_code = $null; passed = $false; report = $null; data_directory = $null }
    uninstall = [ordered]@{ attempted = $false; executable = $null; sha256 = $null; exit_code = $null; verified = $false; native_data_preserved = $null }
    errors = @()
}

function Assert-InstallerOwnedPath([string]$Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path) -or $Path.Contains('"')) {
        throw "Percorso di prova non assoluto o non valido: $Path"
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
    $prefix = $installerProjectRoot.TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Percorso esterno alla cartella del progetto: $full"
    }
    # Lexical containment alone is insufficient when a parent is a junction.
    $current = $full
    while ($current -and $current.StartsWith($installerProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Il percorso di prova attraversa un collegamento o junction: $current"
            }
        }
        if ($current.Equals($installerProjectRoot, [StringComparison]::OrdinalIgnoreCase)) { break }
        $current = Split-Path -Parent $current
    }
    return $full
}

function Get-InstallerAppRegistrations {
    # The extra machine-wide guard avoids an NSIS/MSI upgrade path touching an
    # existing installation belonging to another scope. These are read-only.
    foreach ($scope in @('HKCU', 'HKLM')) {
        foreach ($branch in @('Software\Microsoft\Windows\CurrentVersion\Uninstall', 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
            $base = "${scope}:\$branch"
            if (-not (Test-Path -LiteralPath $base)) { continue }
            foreach ($key in Get-ChildItem -LiteralPath $base) {
                $values = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
                if ($null -eq $values) { continue }
                $displayName = $values.PSObject.Properties['DisplayName']
                if ($null -ne $displayName -and [string]$displayName.Value -eq 'CPU-RustT') {
                    [pscustomobject]@{
                        scope = $scope
                        key = $key.PSPath
                        display_name = [string]$displayName.Value
                        display_version = [string]$values.PSObject.Properties['DisplayVersion'].Value
                        install_location = [string]$values.PSObject.Properties['InstallLocation'].Value
                        uninstall_string = [string]$values.PSObject.Properties['UninstallString'].Value
                    }
                }
            }
        }
    }
}

function Get-InstallerUninstaller {
    $candidate = Assert-InstallerOwnedPath (Join-Path $installerTarget 'uninstall.exe')
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    if (-not ([IO.Path]::GetDirectoryName($candidate)).Equals($installerTarget, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Il programma di disinstallazione non appartiene alla directory di prova'
    }
    return $candidate
}

function Invoke-InstallerOwnedUninstall {
    if (-not $installerWasStarted) { return }
    $uninstaller = Get-InstallerUninstaller
    if (-not $uninstaller) {
        # A launch failure before NSIS created any files has nothing to undo.
        if (@(Get-InstallerAppRegistrations).Count -eq 0 -and -not (Test-Path -LiteralPath $installerTarget)) {
            $installerTestReport.uninstall.verified = $true
            return
        }
        throw 'Uninstaller della sola installazione di prova non disponibile; nessun altro percorso è stato eseguito'
    }
    $registrations = @(Get-InstallerAppRegistrations)
    foreach ($registration in $registrations) {
        $location = [string]$registration.install_location
        $location = Assert-InstallerOwnedPath $location.Trim('"')
        if (-not $location.Equals($installerTarget, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Registrazione di installazione esterna alla prova: disinstallazione automatica interrotta'
        }
    }
    $installerTestReport.uninstall.attempted = $true
    $installerTestReport.uninstall.executable = $uninstaller
    $installerTestReport.uninstall.sha256 = (Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    # Official NSIS command-line contract:
    # https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage
    # _?= must be last and unquoted, like /D=. It keeps ExecWait/Wait attached to
    # the actual uninstaller instead of a temporary launcher. Its own EXE may
    # remain as evidence; this script never removes a directory recursively.
    $process = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$installerTarget" -WindowStyle Hidden -Wait -PassThru
    $installerTestReport.uninstall.exit_code = $process.ExitCode
    if ($process.ExitCode -ne 0) { throw "Disinstallazione terminata con codice $($process.ExitCode)" }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $remainingBinary = @('cpu-rustt.exe', 'CPU-RustT.exe') | Where-Object { Test-Path -LiteralPath (Join-Path $installerTarget $_) -PathType Leaf }
        $remainingRegistry = @(Get-InstallerAppRegistrations)
        if ($remainingBinary.Count -eq 0 -and $remainingRegistry.Count -eq 0) { break }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Rimozione del binario o della registrazione non confermata entro 30 secondi' }
        Start-Sleep -Milliseconds 200
    } while ($true)
    $installerTestReport.uninstall.verified = $true
    if ($installerTestReport.native.data_directory) {
        $dataDirectory = Assert-InstallerOwnedPath $installerTestReport.native.data_directory
        $installerTestReport.uninstall.native_data_preserved = Test-Path -LiteralPath (Join-Path $dataDirectory 'workspace.sqlite3') -PathType Leaf
        if (-not $installerTestReport.uninstall.native_data_preserved) {
            throw 'Il database isolato della prova nativa non è stato conservato'
        }
    }
}

Push-Location -LiteralPath $installerProjectRoot
try {
    if (-not $IsWindows) { throw 'La prova NSIS richiede Windows e PowerShell 7' }
    $package = Get-Content -LiteralPath (Join-Path $installerProjectRoot 'package.json') -Raw | ConvertFrom-Json
    $version = [string]$package.version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { throw 'Versione package.json non valida' }
    $installerTestReport.version = $version
    if (-not $Installer) { $Installer = Join-Path $installerProjectRoot "artifacts\CPU-RustT_${version}_x64-setup.exe" }
    $installerPath = (Resolve-Path -LiteralPath $Installer).ProviderPath
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw 'Installer non trovato' }
    $portablePath = (Resolve-Path -LiteralPath (Join-Path $installerProjectRoot 'artifacts\CPU-RustT.exe')).ProviderPath
    foreach ($binary in @($installerPath, $portablePath)) {
        $metadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($binary)
        if ($metadata.ProductName -ne 'CPU-RustT' -or $metadata.ProductVersion -notin @($version, "$version.0")) {
            throw "Artefatto con prodotto/versione inattesi: $binary ($($metadata.ProductName) $($metadata.ProductVersion))"
        }
    }
    foreach ($name in @('LICENSE', 'THIRD-PARTY-NOTICES.txt')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installerProjectRoot $name) -PathType Leaf)) { throw "Risorsa sorgente mancante: $name" }
    }
    $runnerPath = (Resolve-Path -LiteralPath (Join-Path $installerProjectRoot 'tests\run-native.mjs')).ProviderPath
    $node = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $preexisting = @(Get-InstallerAppRegistrations)
    $installerTestReport.preflight.preexisting_installations = $preexisting
    if ($preexisting.Count -gt 0) { throw 'CPU-RustT risulta già installato. Prova interrotta senza avviare installer o uninstaller.' }
    if (@(Get-Process -Name 'cpu-rustt', 'CPU-RustT' -ErrorAction SilentlyContinue).Count -gt 0) {
        throw 'Un processo CPU-RustT è già attivo. La prova non chiude né modifica istanze esistenti.'
    }
    $installerTestReport.preflight.passed = $true
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
    $installerRunRoot = Assert-InstallerOwnedPath (Join-Path $installerProjectRoot "test-output\install-runs\$stamp")
    $installerTarget = Assert-InstallerOwnedPath (Join-Path $installerRunRoot 'app')
    if (Test-Path -LiteralPath $installerRunRoot) { throw 'Directory di prova già presente; nessun contenuto verrà riutilizzato' }
    New-Item -ItemType Directory -Path $installerRunRoot | Out-Null
    $installerTestReport.installation_directory = $installerTarget
    $installerTestReport.installer = [ordered]@{ path = $installerPath; sha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant() }
    $portableHash = (Get-FileHash -LiteralPath $portablePath -Algorithm SHA256).Hash.ToLowerInvariant()

    # /D= must remain the final argument without quotes, including paths with spaces.
    $installerWasStarted = $true
    $installerTestReport.install.started = $true
    $installed = Start-Process -FilePath $installerPath -ArgumentList "/S /D=$installerTarget" -WindowStyle Hidden -Wait -PassThru
    $installerTestReport.install.process_id = $installed.Id
    $installerTestReport.install.exit_code = $installed.ExitCode
    if ($installed.ExitCode -ne 0) { throw "Installer terminato con codice $($installed.ExitCode)" }
    $executables = @('cpu-rustt.exe', 'CPU-RustT.exe') | ForEach-Object { Join-Path $installerTarget $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    if (-not $executables) { throw 'Eseguibile installato non trovato nella directory di prova' }
    $executable = Assert-InstallerOwnedPath (@($executables)[0])
    $installerTestReport.validation.executable = $executable
    $productVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable).ProductVersion
    $installerTestReport.validation.product_version = $productVersion
    if ($productVersion -notin @($version, "$version.0")) { throw "Versione installata '$productVersion' diversa da '$version'" }
    $installedHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    $installerTestReport.validation.hashes += [ordered]@{ file = [IO.Path]::GetFileName($executable); expected_sha256 = $portableHash; installed_sha256 = $installedHash }
    if ($installedHash -ne $portableHash) { throw "Il binario installato è diverso dall'eseguibile artifacts/CPU-RustT.exe" }
    foreach ($name in @('LICENSE', 'THIRD-PARTY-NOTICES.txt')) {
        $resource = Assert-InstallerOwnedPath (Join-Path $installerTarget $name)
        if (-not (Test-Path -LiteralPath $resource -PathType Leaf)) { throw "Risorsa installata mancante: $name" }
        $expected = (Get-FileHash -LiteralPath (Join-Path $installerProjectRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath $resource -Algorithm SHA256).Hash.ToLowerInvariant()
        $installerTestReport.validation.hashes += [ordered]@{ file = $name; expected_sha256 = $expected; installed_sha256 = $actual }
        if ($expected -ne $actual) { throw "La risorsa installata $name differisce dal progetto" }
    }
    $registrations = @(Get-InstallerAppRegistrations)
    $installerTestReport.validation.registry = $registrations
    if ($registrations.Count -ne 1 -or $registrations[0].scope -ne 'HKCU') { throw "Attesa una sola registrazione per l'utente corrente" }
    $registeredLocation = Assert-InstallerOwnedPath (([string]$registrations[0].install_location).Trim('"'))
    if (-not $registeredLocation.Equals($installerTarget, [StringComparison]::OrdinalIgnoreCase)) { throw 'InstallLocation non corrisponde alla directory isolata' }
    if ($registrations[0].display_version -ne $version) { throw 'DisplayVersion della registrazione non corrisponde alla versione del progetto' }
    if (-not (Get-InstallerUninstaller)) { throw 'Uninstaller della prova non trovato' }
    $installerTestReport.validation.passed = $true

    $installerTestReport.native.started = $true
    & $node.Source $runnerPath '--exe' $executable 2>&1 | Tee-Object -FilePath (Join-Path $installerRunRoot 'native-run.log')
    $installerTestReport.native.exit_code = $LASTEXITCODE
    if ($LASTEXITCODE -ne 0) { throw "Prova nativa dell'eseguibile installato fallita: exit code $LASTEXITCODE" }
    $latest = Get-Content -LiteralPath (Join-Path $installerProjectRoot 'test-output\latest-native-run.json') -Raw | ConvertFrom-Json
    $nativeBinary = [IO.Path]::GetFullPath((Join-Path $installerProjectRoot ([string]$latest.binary)))
    if (-not $nativeBinary.Equals($executable, [StringComparison]::OrdinalIgnoreCase) -or -not $latest.passed) { throw 'Il report nativo non appartiene al binario installato o non è passato' }
    $nativeRun = Assert-InstallerOwnedPath (Join-Path $installerProjectRoot ([string]$latest.output))
    $installerTestReport.native.report = Join-Path $nativeRun 'native-smoke-report.json'
    $installerTestReport.native.data_directory = Assert-InstallerOwnedPath (Join-Path $nativeRun 'data')
    $installerTestReport.native.passed = $true
    $installerTestPassed = $true
} catch {
    $installerTestFailure = $_.Exception.Message
    $installerTestReport.errors += $installerTestFailure
} finally {
    if ($installerWasStarted) {
        try { Invoke-InstallerOwnedUninstall } catch {
            $installerCleanupFailure = $_.Exception.Message
            $installerTestReport.errors += "Disinstallazione della prova: $installerCleanupFailure"
        }
    }
    $installerTestReport.passed = $installerTestPassed -and $installerTestReport.uninstall.verified -and -not $installerCleanupFailure
    $installerTestReport.exit_code = if ($installerTestReport.passed) { 0 } else { 1 }
    $installerTestReport['finished_utc'] = [DateTime]::UtcNow.ToString('o')
    if ($installerRunRoot -and (Test-Path -LiteralPath $installerRunRoot)) {
        $json = $installerTestReport | ConvertTo-Json -Depth 12
        $json | Set-Content -LiteralPath (Join-Path $installerRunRoot 'install-report.json') -Encoding utf8
        $json | Set-Content -LiteralPath (Join-Path $installerProjectRoot 'test-output\install-report.json') -Encoding utf8
    }
    Pop-Location
}
if (-not $installerTestReport.passed) {
    Write-Error ($installerTestReport.errors -join [Environment]::NewLine) -ErrorAction Continue
    exit 1
}
Write-Host 'Installer verificato: file e licenze identici, versione corretta, GUI nativa funzionante, disinstallazione confermata e dati isolati conservati.'
exit 0
