<#
  capture-wifi.ps1 — Live WiFi site-survey capture for Echo Vue.

  Triggers a fresh 802.11 scan, parses every visible BSSID, and writes a
  snapshot JSON that the WiFi Site Survey page loads as live data.

  Usage:   powershell -ExecutionPolicy Bypass -File scripts\capture-wifi.ps1
  Output:  frontend/public/live-survey.json

  Re-run it anywhere on the property (ideally while walking room to room) to
  refresh what the dashboard shows. It reads network INFRASTRUCTURE only —
  access points and their signal — never any client device or person.
#>

$ErrorActionPreference = "Stop"
$outPath = Join-Path $PSScriptRoot "..\frontend\public\live-survey.json"

# ── Connected interface (gives us the associated AP + adapter name) ──
$ifaceRaw = netsh wlan show interfaces
function Field($name) {
  $line = $ifaceRaw | Where-Object { $_ -match "^\s*$name\s*:" } | Select-Object -First 1
  if ($line) { return ($line -split ":", 2)[1].Trim() }
  return ""
}
$adapter       = Field "Description"
$connectedSsid = Field "SSID"
$connectedBss  = (Field "AP BSSID").ToLower()
$guid          = Field "GUID"

# ── Force a fresh scan via the native WLAN API ──
$src = @'
using System;
using System.Runtime.InteropServices;
public class WlanScanner {
  [DllImport("wlanapi.dll")] public static extern int WlanOpenHandle(uint c, IntPtr r, out uint v, out IntPtr h);
  [DllImport("wlanapi.dll")] public static extern int WlanScan(IntPtr h, ref Guid i, IntPtr s, IntPtr b, IntPtr r);
}
'@
try {
  Add-Type -TypeDefinition $src -ErrorAction Stop
  $g = [Guid]$guid
  $v = 0; $h = [IntPtr]::Zero
  [void][WlanScanner]::WlanOpenHandle(2, [IntPtr]::Zero, [ref]$v, [ref]$h)
  [void][WlanScanner]::WlanScan($h, [ref]$g, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
  Start-Sleep -Seconds 5
} catch {
  Write-Warning "Could not force a scan ($($_.Exception.Message)); using cached results."
}

# ── Parse `netsh wlan show networks mode=bssid` ──
$raw = netsh wlan show networks mode=bssid
$radios = New-Object System.Collections.ArrayList
$currentSsid = $null
$pending = $null

function Flush() {
  if ($script:pending -ne $null) { [void]$script:radios.Add($script:pending); $script:pending = $null }
}

foreach ($line in $raw) {
  if ($line -match "^SSID\s+\d+\s*:\s*(.*)$") {
    $currentSsid = $Matches[1].Trim()
    continue
  }
  if ($line -match "^\s*BSSID\s+\d+\s*:\s*(.+)$") {
    Flush
    $pending = [ordered]@{
      ssid    = $currentSsid
      bssid   = $Matches[1].Trim().ToLower()
      signal  = 0
      band    = ""
      channel = 0
      radio   = ""
    }
    continue
  }
  if ($pending -ne $null) {
    if ($line -match "^\s*Signal\s*:\s*(\d+)%")   { $pending.signal  = [int]$Matches[1] }
    elseif ($line -match "^\s*Band\s*:\s*(.+)$")   { $pending.band    = $Matches[1].Trim() }
    elseif ($line -match "^\s*Channel\s*:\s*(\d+)"){ $pending.channel = [int]$Matches[1] }
    elseif ($line -match "^\s*Radio type\s*:\s*(.+)$") { $pending.radio = $Matches[1].Trim() }
  }
}
Flush

# ── Tag ownership against the connected network ──
$ownOui = if ($connectedBss) { ($connectedBss -split ":")[0..2] -join ":" } else { "" }
foreach ($r in $radios) {
  $r | Add-Member -NotePropertyName own -NotePropertyValue ($r.ssid -eq $connectedSsid) -Force
}

$snapshot = [ordered]@{
  capturedAt     = (Get-Date).ToString("o")
  essid          = $connectedSsid
  adapter        = $adapter
  connectedBssid = $connectedBss
  ownOui         = $ownOui
  radioCount     = $radios.Count
  radios         = $radios
}

$dir = Split-Path $outPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$snapshot | ConvertTo-Json -Depth 6 | Out-File -FilePath $outPath -Encoding utf8

Write-Output "Captured $($radios.Count) radio(s) for ESSID '$connectedSsid' -> $outPath"
