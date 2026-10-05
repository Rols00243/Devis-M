<#
.SYNOPSIS
  Test de fumée contre un serveur RobotStructuralMCP en cours d'exécution (Robot ouvert avec un projet).
.DESCRIPTION
  initialize → robot_get_status → robot_connect → robot_get_project_info → robot_verify_api → get_model_summary.
  Avec -WriteTest : begin_transaction → create_nodes/create_bar → get_bars → rollback_transaction (avec confirmation),
  ce qui laisse le modèle inchangé.
.EXAMPLE
  .\scripts\Smoke-Test.ps1 -Url http://127.0.0.1:3001/mcp -WriteTest
#>
param(
    [string]$Url = "http://127.0.0.1:3001/mcp",
    [string]$ApiKey = "",
    [switch]$WriteTest
)
$ErrorActionPreference = "Stop"
$script:session = $null
$script:id = 0

function Invoke-Mcp([string]$method, $params) {
    $script:id++
    $headers = @{ Accept = "application/json, text/event-stream" }
    if ($ApiKey) { $headers.Authorization = "Bearer $ApiKey" }
    if ($script:session) { $headers["Mcp-Session-Id"] = $script:session }
    $body = @{ jsonrpc = "2.0"; id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 20 -Compress
    $resp = Invoke-WebRequest -Uri $Url -Method Post -Headers $headers -ContentType "application/json" -Body $body -UseBasicParsing
    if ($resp.Headers["Mcp-Session-Id"]) { $script:session = $resp.Headers["Mcp-Session-Id"] }
    $text = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
    $data = ($text -split "`n" | Where-Object { $_ -like "data:*" } | Select-Object -Last 1)
    if ($data) { $text = $data.Substring(5).Trim() }
    return $text | ConvertFrom-Json
}

function Invoke-Tool([string]$name, $arguments = @{}) {
    $r = Invoke-Mcp "tools/call" @{ name = $name; arguments = $arguments }
    $env = $r.result.structuredContent
    $color = if ($env.success) { "Green" } else { "Yellow" }
    Write-Host ("[{0}] {1}" -f ($(if ($env.success) { "OK" } else { "KO" })), $name) -ForegroundColor $color
    $env | ConvertTo-Json -Depth 8 | Write-Host
    return $env
}

$init = Invoke-Mcp "initialize" @{ protocolVersion = "2025-06-18"; capabilities = @{}; clientInfo = @{ name = "smoke-test"; version = "1" } }
Write-Host "Serveur : $($init.result.serverInfo.name) $($init.result.serverInfo.version)" -ForegroundColor Cyan

Invoke-Tool "robot_get_status" | Out-Null
$c = Invoke-Tool "robot_connect"
if (-not $c.success) { throw "Connexion à Robot impossible : ouvrez Robot et un projet, puis relancez." }
Invoke-Tool "robot_get_project_info" | Out-Null
$v = Invoke-Tool "robot_verify_api"
if ($v.success -and $v.data.missing_count -gt 0) {
    Write-Warning "$($v.data.missing_count) membre(s) RobotOM absents de la version installée : voir docs/ROBOTOM_API.md."
}
Invoke-Tool "get_model_summary" | Out-Null

if ($WriteTest) {
    Invoke-Tool "begin_transaction" @{ label = "smoke-test" } | Out-Null
    $n = Invoke-Tool "create_nodes" @{ length_unit = "m"; nodes = @(@{ x = 1000; y = 1000; z = 0 }, @{ x = 1003; y = 1000; z = 0 }) }
    $ids = @($n.data.nodes | ForEach-Object { $_.id })
    Invoke-Tool "create_bar" @{ start_node = $ids[0]; end_node = $ids[1] } | Out-Null
    $ask = Invoke-Tool "rollback_transaction"
    $token = $ask.data.confirmation_token
    Invoke-Tool "rollback_transaction" @{ confirmation_token = $token } | Out-Null
    Write-Host "Test d'écriture terminé ; le modèle a été restauré depuis le checkpoint de transaction." -ForegroundColor Cyan
}
