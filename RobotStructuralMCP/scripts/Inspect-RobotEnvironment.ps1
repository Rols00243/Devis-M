<#
.SYNOPSIS
  Étape 1 du projet : inspecte l'environnement Windows pour RobotStructuralMCP.
.DESCRIPTION
  - version de Windows et architecture ;
  - SDK .NET installés ;
  - installations de Robot Structural Analysis Professional (robot.exe, version, architecture x64/x86) ;
  - enregistrement COM du ProgID « Robot.Application » (CLSID, LocalServer32) ;
  - bibliothèque de types RobotOM enregistrée (TypeLib) et fichiers robotom.tlb / Interop.RobotOM.dll ;
  - processus Robot en cours.
  Produit un résumé JSON (robot-environment.json) et la valeur recommandée de Robot:TypeLibraryPath.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\Inspect-RobotEnvironment.ps1
#>
[CmdletBinding()]
param([string]$OutFile = "robot-environment.json")

$ErrorActionPreference = "Continue"

function Get-PeMachine([string]$path) {
    # Lit le champ Machine de l'en-tête PE : 0x8664 = x64, 0x014c = x86.
    try {
        $fs = [System.IO.File]::OpenRead($path)
        $br = New-Object System.IO.BinaryReader($fs)
        $fs.Seek(0x3C, 'Begin') | Out-Null
        $peOffset = $br.ReadInt32()
        $fs.Seek($peOffset + 4, 'Begin') | Out-Null
        $machine = $br.ReadUInt16()
        $fs.Close()
        switch ($machine) { 0x8664 { "x64" } 0x014c { "x86" } 0xAA64 { "arm64" } default { "inconnu (0x{0:X4})" -f $machine } }
    } catch { "illisible" }
}

$report = [ordered]@{}
$report.os = [ordered]@{
    caption = (Get-CimInstance Win32_OperatingSystem).Caption
    version = [Environment]::OSVersion.VersionString
    is64BitOS = [Environment]::Is64BitOperatingSystem
}
try { $report.dotnet_sdks = @(& dotnet --list-sdks 2>$null) } catch { $report.dotnet_sdks = @() }
if (-not $report.dotnet_sdks) { Write-Warning "Aucun SDK .NET trouvé : installez le SDK .NET 8 (https://dotnet.microsoft.com/download/dotnet/8.0)." }

# Installations de Robot.
$roots = @("$env:ProgramFiles\Autodesk", "${env:ProgramFiles(x86)}\Autodesk") | Where-Object { $_ -and (Test-Path $_) }
$installs = @()
foreach ($root in $roots) {
    Get-ChildItem $root -Directory -Filter "Robot Structural Analysis Professional*" -ErrorAction SilentlyContinue | ForEach-Object {
        $dir = $_.FullName
        $exe = Get-ChildItem $dir -Recurse -Filter robot.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        $tlb = Get-ChildItem $dir -Recurse -Include robotom.tlb, robotom.dll -ErrorAction SilentlyContinue | Select-Object -First 3
        $interop = Get-ChildItem $dir -Recurse -Filter Interop.RobotOM.dll -ErrorAction SilentlyContinue | Select-Object -First 3
        $installs += [ordered]@{
            folder = $dir
            robot_exe = $exe.FullName
            version = if ($exe) { $exe.VersionInfo.ProductVersion } else { $null }
            architecture = if ($exe) { Get-PeMachine $exe.FullName } else { $null }
            robotom_typelib_files = @($tlb | ForEach-Object FullName)
            interop_robotom = @($interop | ForEach-Object FullName)
        }
    }
}
$report.robot_installations = $installs
if (-not $installs) { Write-Warning "Aucune installation de Robot Structural Analysis Professional trouvée sous Program Files\Autodesk." }

# Enregistrement COM.
$progId = "Robot.Application"
$clsid = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$progId\CLSID" -ErrorAction SilentlyContinue).'(default)'
$report.com = [ordered]@{
    progid = $progId
    clsid = $clsid
    local_server = if ($clsid) { (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid\LocalServer32" -ErrorAction SilentlyContinue).'(default)' } else { $null }
}
if (-not $clsid) { Write-Warning "ProgID $progId non enregistré : RobotOM ne sera pas accessible (réparer l'installation de Robot)." }

# Bibliothèques de types RobotOM enregistrées.
$typelibs = @()
Get-ChildItem "Registry::HKEY_CLASSES_ROOT\TypeLib" -ErrorAction SilentlyContinue | ForEach-Object {
    $guid = $_.PSChildName
    Get-ChildItem $_.PSPath -ErrorAction SilentlyContinue | ForEach-Object {
        $name = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).'(default)'
        if ($name -and $name -match "Robot") {
            $win64 = (Get-ItemProperty "$($_.PSPath)\0\win64" -ErrorAction SilentlyContinue).'(default)'
            $win32 = (Get-ItemProperty "$($_.PSPath)\0\win32" -ErrorAction SilentlyContinue).'(default)'
            $typelibs += [ordered]@{ guid = $guid; version = $_.PSChildName; name = $name; win64 = $win64; win32 = $win32 }
        }
    }
}
$report.registered_typelibs = $typelibs

$proc = Get-Process -Name robot -ErrorAction SilentlyContinue | Select-Object -First 1
$report.robot_process = if ($proc) { [ordered]@{ id = $proc.Id; path = $proc.Path; version = $proc.MainModule.FileVersionInfo.ProductVersion } } else { $null }

$recommendedTlb = ($typelibs | Where-Object { $_.name -match "RobotOM" } | Select-Object -First 1).win64
if (-not $recommendedTlb -and $installs) { $recommendedTlb = ($installs[0].robotom_typelib_files | Select-Object -First 1) }
$report.recommended_settings = [ordered]@{
    "Robot:Mode" = "Com"
    "Robot:TypeLibraryPath" = $recommendedTlb
    note = "TypeLibraryPath n'est utilisé qu'en secours : le serveur lit d'abord la bibliothèque de types de l'instance Robot connectée."
}

$json = $report | ConvertTo-Json -Depth 6
$json | Set-Content -Encoding UTF8 $OutFile
$json
Write-Host "`nRésumé enregistré dans $OutFile" -ForegroundColor Green
