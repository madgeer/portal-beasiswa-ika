# =====================================================================
#  Deploy ulang ASAH_5 (form donasi + relay notifikasi)
#
#  Cara pakai (dari folder ini):
#     .\deploy.ps1            -> deploy FORM saja (paling sering)
#     .\deploy.ps1 form       -> deploy FORM saja
#     .\deploy.ps1 relay      -> deploy RELAY saja
#     .\deploy.ps1 all        -> deploy keduanya
#
#  Catatan: kode Apps Script (script.gs) TIDAK bisa dideploy dari sini.
#  Lihat bagian "Deploy Apps Script" di README.md.
# =====================================================================

param(
  [ValidateSet('form', 'relay', 'all')]
  [string]$Target = 'form'
)

$ErrorActionPreference = 'Stop'
$env:NO_COLOR = '1'
$root = $PSScriptRoot

$SITE_FORM  = 'ae4c7334-535f-4dd4-8d1c-91997ef4aeba'
$SITE_RELAY = 'c4571894-b3b9-4e00-88d9-eecec50993b0'

# Tulis .netlify\state.json dengan UTF-8 TANPA BOM.
# Kalau file ini hilang/rusak, Netlify CLI akan membuat situs BARU (bukan update).
function Set-NetlifyState {
  param([string]$Dir, [string]$SiteId)

  $stateDir = Join-Path $Dir '.netlify'
  if (-not (Test-Path $stateDir)) {
    New-Item -ItemType Directory -Path $stateDir | Out-Null
  }

  $file = Join-Path $stateDir 'state.json'
  $json = '{"siteId":"' + $SiteId + '"}'
  if (Test-Path $file) {
    try {
      $current = [System.IO.File]::ReadAllText($file)
      if ($current.Trim() -eq $json.Trim()) { return }
    } catch {}
  }
  try {
    [System.IO.File]::WriteAllText($file, $json, [System.Text.UTF8Encoding]::new($false))
  } catch {}
}

# Cek sintaks JS sebelum deploy, supaya tidak men-deploy file yang error.
function Test-Js {
  param([string[]]$Files)

  foreach ($f in $Files) {
    if (-not (Test-Path $f)) { continue }
    node --check $f
    if ($LASTEXITCODE -ne 0) { throw "Sintaks JS error: $f" }
    Write-Host "  ok  $(Split-Path $f -Leaf)" -ForegroundColor DarkGray
  }
}

function Invoke-NetlifyDeploy {
  param([string]$Dir, [string]$SiteId, [string]$Label)

  Set-NetlifyState -Dir $Dir -SiteId $SiteId

  Push-Location $Dir
  try {
    $pesan = "$Label $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    npx --yes netlify-cli@latest deploy --prod --dir=public --message $pesan
    if ($LASTEXITCODE -ne 0) { throw "Deploy gagal ($Label)." }
  }
  finally {
    Pop-Location
  }
}

function Deploy-Form {
  Write-Host "`n=== FORM DONASI ===" -ForegroundColor Cyan

  # _config.js tidak ikut ke Git (berisi key). Kalau hilang, buat dari contoh.
  $configFile = Join-Path $root 'netlify-site\netlify\functions\_config.js'
  if (-not (Test-Path $configFile)) {
    Copy-Item (Join-Path $root 'netlify-site\_config.example.js') $configFile
    throw "_config.js belum ada. File contoh sudah dibuat - isi MIDTRANS_SERVER_KEY lalu jalankan lagi."
  }

  try {
    Copy-Item (Join-Path $root 'index.html') (Join-Path $root 'netlify-site\public\index.html') -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $root 'dashboard.html') (Join-Path $root 'netlify-site\public\dashboard.html') -Force -ErrorAction SilentlyContinue
  } catch {}
  Write-Host "  ok  index.html + dashboard.html -> netlify-site/public/" -ForegroundColor DarkGray

  Test-Js @(
    (Join-Path $root 'server.js'),
    (Join-Path $root 'netlify-site\netlify\functions\snap.js'),
    (Join-Path $root 'netlify-site\netlify\functions\health.js'),
    (Join-Path $root 'netlify-site\netlify\functions\data.js'),
    (Join-Path $root 'netlify-site\netlify\functions\cek-nim.js'),
    (Join-Path $root 'netlify-site\netlify\functions\summary.js'),
    (Join-Path $root 'netlify-site\netlify\functions\_config.js')
  )

  Invoke-NetlifyDeploy -Dir (Join-Path $root 'netlify-site') -SiteId $SITE_FORM -Label 'form donasi'
  Write-Host "  https://donasi-beasiswa-ika-upi.netlify.app" -ForegroundColor Green
}

function Deploy-Relay {
  Write-Host "`n=== RELAY NOTIFIKASI ===" -ForegroundColor Cyan

  Test-Js @(
    (Join-Path $root 'netlify-relay\netlify\functions\notification.js')
  )

  Invoke-NetlifyDeploy -Dir (Join-Path $root 'netlify-relay') -SiteId $SITE_RELAY -Label 'relay notifikasi'
  Write-Host "  https://relay-donasi-ika-upi.netlify.app/api/notification" -ForegroundColor Green
}

switch ($Target) {
  'form'  { Deploy-Form }
  'relay' { Deploy-Relay }
  'all'   { Deploy-Form; Deploy-Relay }
}

Write-Host "`nSelesai. Jangan lupa hard refresh (Ctrl+Shift+R) di browser." -ForegroundColor Green
if (Test-Path (Join-Path $root 'script.gs')) {
  Write-Host "Kalau yang diubah script.gs, deploy manual di editor Apps Script (Manage deployments -> New version)." -ForegroundColor Yellow
}
