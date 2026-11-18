# Deploy RELAY saja.
# Skrip asli ada di ..\deploy.ps1 — file ini hanya jalan pintas.
#
# Setup pertama kali (login, buat site, set GAS_URL) sudah selesai.
# Kalau perlu mengulang setup, lihat README.md bagian "Cara Deploy Ulang".
#
# Jalankan: powershell -ExecutionPolicy Bypass -File .\deploy.ps1

& (Join-Path $PSScriptRoot '..\deploy.ps1') -Target relay
