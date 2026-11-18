# Deploy FORM saja (salin index.html lalu deploy).
# Skrip asli ada di ..\deploy.ps1 — file ini hanya jalan pintas.
#
# Jalankan: powershell -ExecutionPolicy Bypass -File .\deploy.ps1

& (Join-Path $PSScriptRoot '..\deploy.ps1') -Target form
