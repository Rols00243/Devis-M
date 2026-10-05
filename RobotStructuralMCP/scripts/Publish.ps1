<#
.SYNOPSIS
  Compile et publie le serveur (Release, win-x64) dans .\publish.
#>
param([string]$Output = "publish")
$ErrorActionPreference = "Stop"
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    dotnet test -c Release
    dotnet publish src/RobotStructuralMCP.Server -c Release -r win-x64 --self-contained false -o $Output
    Write-Host "Serveur publié dans $Output\RobotStructuralMCP.Server.exe" -ForegroundColor Green
} finally { Pop-Location }
