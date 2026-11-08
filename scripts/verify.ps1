#requires -Version 7.0
param([switch]$LiveHardware)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
function Invoke-Checked([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Verifica fallita: $Command" }
}
try {
    Invoke-Checked { npm.cmd run check }
    Invoke-Checked { cargo fmt --all -- --check }
    Invoke-Checked { cargo clippy --workspace --all-targets --locked -- -D warnings }
    if ($LiveHardware) {
        Invoke-Checked { cargo test --workspace --all-targets --locked -- --include-ignored }
    } else {
        Invoke-Checked { cargo test --workspace --all-targets --locked }
    }
    Invoke-Checked { npm.cmd run test:frontend }
    Write-Host 'Verifiche completate. Per la GUI nativa: npm run test:native (vedere docs/SVILUPPO.md).'
} finally { Pop-Location }
