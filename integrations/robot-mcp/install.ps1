# install.ps1 — installe le serveur MCP Robot et le déclare dans Claude Desktop.
# Lancer via install.bat (double-clic), ou : powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
# PowerShell 5.1 : évite que ConvertTo-Json transforme les listes en {value, Count}.
Remove-TypeData System.Array -ErrorAction SilentlyContinue
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "== Installation du serveur MCP Robot ==" -ForegroundColor Cyan

# 1. Python
$py = $null
foreach ($cmd in @("py", "python")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { $py = $cmd; break }
}
if (-not $py) {
    throw "Python introuvable. Installez Python 3.10+ depuis https://www.python.org (cochez 'Add python.exe to PATH') puis relancez."
}

# 2. Environnement virtuel + dépendances
$venv = Join-Path $here ".venv"
$venvPy = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "Création de l'environnement Python..."
    & $py -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Échec de la création du venv" }
}
Write-Host "Installation des dépendances (mcp, pywin32)..."
& $venvPy -m pip install --upgrade pip --quiet
& $venvPy -m pip install -r (Join-Path $here "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) { throw "Échec de l'installation des dépendances" }

# 3. Déclaration dans Claude Desktop (installation classique et version Microsoft Store)
$configDirs = @(Join-Path $env:APPDATA "Claude")
Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue |
    ForEach-Object { $configDirs += Join-Path $_.FullName "LocalCache\Roaming\Claude" }

$server = [pscustomobject]@{
    command = $venvPy
    args    = @(Join-Path $here "robot_mcp.py")
}
$utf8 = New-Object System.Text.UTF8Encoding($false)  # sans BOM, sinon Claude ne lit pas le fichier

foreach ($dir in $configDirs) {
    if (-not (Test-Path (Split-Path $dir -Parent))) { continue }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir "claude_desktop_config.json"

    if (Test-Path $file) {
        Copy-Item $file "$file.bak" -Force
        $raw = [IO.File]::ReadAllText($file).Trim()
        $config = if ($raw) { $raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    } else {
        $config = [pscustomobject]@{}
    }
    if (-not $config.PSObject.Properties["mcpServers"]) {
        $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{})
    }
    $config.mcpServers | Add-Member -NotePropertyName robot -NotePropertyValue $server -Force

    [IO.File]::WriteAllText($file, ($config | ConvertTo-Json -Depth 20), $utf8)
    Write-Host "Serveur 'robot' déclaré dans $file" -ForegroundColor Green
}

Write-Host ""
Write-Host "Terminé. Quittez complètement Claude Desktop (icône de la barre des tâches > Quitter)," -ForegroundColor Cyan
Write-Host "rouvrez-le, ouvrez un projet dans Robot, puis demandez à Claude : 'donne-moi les infos de la structure Robot'." -ForegroundColor Cyan
