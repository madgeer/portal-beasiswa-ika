# Relay Midtrans → Apps Script (Netlify)

Kenapa perlu: web app Google Apps Script **selalu** membalas `HTTP 302`, sedangkan
Midtrans hanya menerima `HTTP 200`. Relay ini menerima notifikasi, meneruskannya ke
Apps Script, lalu membalas `200` ke Midtrans.

```
Midtrans ──POST──> https://<site>.netlify.app/api/notification ──> Apps Script /exec
                                                              └─> Sheet + Email
```

## Struktur

```
netlify-relay/
├─ netlify.toml                  # publish=public, functions=netlify/functions, redirect /api/notification
├─ package.json
├─ public/index.html             # halaman status
└─ netlify/functions/notification.js
```

## Deploy (Netlify CLI)

```powershell
cd "D:\Kuliah\semester 5\data management\Tugas\ASAH\ASAH_5\netlify-relay"

npx --yes netlify-cli@latest login
npx --yes netlify-cli@latest deploy --prod
#   -> pilih "Create & configure a new site" saat diminta
```

Lalu set URL Apps Script sebagai environment variable:

```powershell
npx --yes netlify-cli@latest env:set GAS_URL "https://script.google.com/macros/s/AKfy.../exec"
npx --yes netlify-cli@latest deploy --prod
```

Atau lewat dashboard: **Site configuration → Environment variables → Add**
`GAS_URL` = URL `/exec` Apps Script, lalu **Deploys → Trigger deploy**.

## Sudah ter-deploy

| Item | Nilai |
|---|---|
| Site | https://relay-donasi-ika-upi.netlify.app |
| Endpoint | https://relay-donasi-ika-upi.netlify.app/api/notification |
| Site ID | c4571894-b3b9-4e00-88d9-eecec50993b0 |

Pasang endpoint di atas sebagai **Payment Notification URL** di Dashboard Midtrans.

> Catatan: Netlify otomatis mengaktifkan proteksi akses (`sso_login`) untuk site ini,
> sehingga request Midtrans dibalas **401**. Sudah dimatikan lewat API
> (`sso_login=false`, `account_sso_login=false`). Kalau suatu saat relay membalas 401
> lagi, cek **Project configuration → Access & security**.

## Tes yang sudah lolos

```
GET  /api/notification -> 200 {"ok":true,"message":"Relay aktif..."}
POST /api/notification -> 200 {"ok":true,"upstream":200,
                              "response":"{\"status\":\"OK\",\"message\":\"Status \\\"pending\\\" belum lunas...\"}"}
```


## Pasang di Midtrans

Dashboard Midtrans → **Settings → Configuration → Payment Notification URL**:

```
https://relay-donasi-ika-upi.netlify.app/api/notification
```

## Tes

Buka di browser:

```
https://<nama-site>.netlify.app/api/notification
```

Harus muncul:

```json
{"ok":true,"message":"Relay aktif. Kirim POST ke /api/notification"}
```

Kirim notifikasi tiruan:

```powershell
curl.exe -i -X POST "https://<nama-site>.netlify.app/api/notification" `
  -H "Content-Type: application/json" `
  -d '{\"order_id\":\"TES-RELAY\",\"transaction_status\":\"settlement\",\"status_code\":\"200\",\"gross_amount\":\"1000.00\",\"signature_key\":\"palsu\"}'
```

Harus `HTTP 200` dengan `{"ok":true,"upstream":200,...}`.

Catatan: notifikasi tiruan dengan `signature_key` palsu akan **ditolak** oleh Apps Script
(jika `MIDTRANS_SIGNATURE_KEY` sudah di-set), jadi tidak menambah baris di spreadsheet.
