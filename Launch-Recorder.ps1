# RS3 OBS Casket Recorder - Launcher hotfix v0.6.4 (Windows PowerShell 5.1+)
# Starts a LOCAL Python HTTP server only if one is not already serving this app.
$ErrorActionPreference = 'Stop'
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8091
$url = "http://127.0.0.1:$port/recorder-v0.6.4.html"
$expectedMarker = 'launcher-build-v0.6.4'
$launcherLog = Join-Path $folder 'launcher.log'

function Write-LauncherLog([string]$message) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $message
  Add-Content -LiteralPath $launcherLog -Value $line -Encoding UTF8
  Write-Host $message
}

function Test-RecorderServer {
  # Bypass any Windows/system HTTP proxy for loopback connections.
  $response = $null
  $reader = $null
  try {
    $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($url)
    $request.Proxy = $null
    $request.Timeout = 2500
    $response = [System.Net.HttpWebResponse]$request.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $html = $reader.ReadToEnd()
    return (($response.StatusCode -eq [System.Net.HttpStatusCode]::OK) -and $html.Contains($expectedMarker))
  } catch {
    return $false
  } finally {
    if ($reader) { $reader.Dispose() }
    if ($response) { $response.Dispose() }
  }
}

try {
  Write-LauncherLog 'Starting RS3 Casket Recorder launcher v0.6.4...'
  if (-not (Test-RecorderServer)) {
    $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
      throw "Port $port is already occupied, but it is not serving v0.6.4 correctly. Close the old Python server, then launch again."
    }

    $pythonCmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $pythonCmd) {
      throw 'python.exe not found in PATH. Try running python --version from PowerShell.'
    }

    $pythonPath = $pythonCmd.Source
    $outLog = Join-Path $folder 'python-http.stdout.log'
    $errLog = Join-Path $folder 'python-http.stderr.log'
    $arguments = @('-m', 'http.server', "$port", '--bind', '127.0.0.1', '--directory', ('"' + $folder + '"'))

    Write-LauncherLog ("Launching Python HTTP server using " + $pythonPath)
    $process = Start-Process -FilePath $pythonPath -WorkingDirectory $folder -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 250
      if (Test-RecorderServer) { $ready = $true; break }
      $process.Refresh()
      if ($process.HasExited) { break }
    }
    if (-not $ready) {
      $detail = ''
      if (Test-Path -LiteralPath $errLog) {
        $detail = ((Get-Content -LiteralPath $errLog -Tail 5 -ErrorAction SilentlyContinue) -join ' | ')
      }
      throw ("Python server failed to serve v0.6.4 at $url. " + $detail)
    }
    Write-LauncherLog ("Python HTTP server ready; PID " + $process.Id)
  } else {
    Write-LauncherLog ("HTTP server already ready at $url; reusing it")
  }

  Write-LauncherLog 'Opening Alt1 application...'
  Start-Process 'alt1://browser/http://127.0.0.1:8091/recorder-v0.6.4.html'
  Write-LauncherLog 'Launcher completed. The HTTP server keeps running in the background.'
} catch {
  Write-Host ''
  Write-LauncherLog ('ERROR: ' + $_.Exception.Message)
  Write-Host 'See launcher.log and python-http.stderr.log in this folder.'
  exit 1
}
