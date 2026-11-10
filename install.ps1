# Hermes One installer for Windows. In PowerShell:
#   irm https://raw.githubusercontent.com/charuldalvi/hermes-one/main/install.ps1 | iex
#
# Downloads the latest Hermes One for Windows and runs its installer, which copies the app to
# %LOCALAPPDATA%\Programs\Hermes One, puts the Hermes One plugin into every profile of your Hermes and turns it
# on, then opens the app. Afterwards Hermes is restarted so it loads the plugin, but only when no agent is working.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'charuldalvi/hermes-one'
$url = "https://github.com/$repo/releases/latest/download/Hermes-One-win-x64.zip"  # x64 runs on Windows on Arm too
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('hermes-one-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host 'Downloading Hermes One...'
  $zip = Join-Path $tmp 'hermes-one.zip'
  try { Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing }
  catch { throw "Couldn't download $url. Check your connection, or build it yourself: https://github.com/$repo" }
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $installer = Get-ChildItem -LiteralPath $tmp -Recurse -Filter 'install.ps1' | Select-Object -First 1
  if (-not $installer) { throw 'The download has no installer in it.' }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $installer.FullName
  if ($LASTEXITCODE -ne 0) { throw 'The Hermes One installer stopped with an error (see above).' }

  # Restart Hermes so it loads the plugin, unless an agent is working.
  $hermes = Get-Command hermes -ErrorAction SilentlyContinue
  if (-not $hermes) {
    $home2 = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
    $hermes = @('hermes.exe', 'hermes.cmd') | ForEach-Object { Join-Path $home2 "bin\$_" } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  } else { $hermes = $hermes.Source }
  if ($hermes) {
    $status = & $hermes gateway status 2>&1 | Out-String
    if ($status -match 'is running') {
      Write-Host 'Restarting Hermes so it loads the plugin...'
      $out = & $hermes gateway stop 2>&1 | Out-String
      if ($out -match 'Let them finish') {
        Write-Host 'An agent is working right now, so Hermes was not restarted. When your agents are done, run: hermes gateway restart' -ForegroundColor Yellow
      } else {
        & $hermes gateway ensure 2>&1 | Out-Null
        Write-Host 'Hermes is back.'
      }
    }
  }
  Write-Host 'Done.'
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
