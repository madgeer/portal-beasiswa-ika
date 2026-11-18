/**
 * Cek status kanal pembayaran Midtrans (kenapa Snap error "system error").
 *
 *   node cek-kanal.js            -> cek BNI VA + beberapa kanal lain
 *   node cek-kanal.js bni_va     -> cek kanal tertentu
 *
 * "status": "up"   = kanal siap dipakai
 * "status": "down" = kanal tidak tersedia -> Snap menampilkan
 *                    "We're experiencing system error. Failed to process your transaction."
 */

const fs = require('node:fs');
const path = require('node:path');

function bacaEnv() {
  const file = path.join(__dirname, '.env');
  const hasil = {};
  if (!fs.existsSync(file)) return hasil;

  for (const baris of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(baris)) continue;
    const cocok = baris.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (cocok) hasil[cocok[1]] = cocok[2];
  }
  return hasil;
}

const env = bacaEnv();
const SERVER_KEY = (process.env.MIDTRANS_SERVER_KEY || env.MIDTRANS_SERVER_KEY || '').trim();
const PRODUCTION = String(process.env.MIDTRANS_IS_PRODUCTION || env.MIDTRANS_IS_PRODUCTION) === 'true';

const SNAP_BASE = PRODUCTION
  ? 'https://app.midtrans.com'
  : 'https://app.sandbox.midtrans.com';

const SEMUA_KANAL = [
  'bni_va', 'bri_va', 'permata_va', 'cimb_va', 'bca_va', 'echannel', 'other_va',
  'qris', 'gopay', 'shopeepay',
];

const diminta = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const kanal = diminta.length ? diminta : SEMUA_KANAL;

(async () => {
  if (!SERVER_KEY) {
    console.log('MIDTRANS_SERVER_KEY tidak ditemukan di .env');
    return;
  }

  console.log(`Lingkungan : ${PRODUCTION ? 'PRODUCTION' : 'SANDBOX'}`);
  console.log(`Kanal dicek: ${kanal.join(', ')}\n`);

  const res = await fetch(`${SNAP_BASE}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${SERVER_KEY}:`).toString('base64'),
    },
    body: JSON.stringify({
      transaction_details: { order_id: 'CEK-KANAL-' + Date.now(), gross_amount: 50000 },
      enabled_payments: kanal,
      customer_details: { first_name: 'Cek Kanal', email: 'cek@example.com' },
    }),
    signal: AbortSignal.timeout(20000),
  });

  const teks = await res.text();
  if (!res.ok) {
    console.log(`Gagal membuat token (HTTP ${res.status}):`);
    console.log(teks.slice(0, 400));
    return;
  }

  const { token } = JSON.parse(teks);

  const detailRes = await fetch(`${SNAP_BASE}/snap/v1/transactions/${token}`);
  const detail = await detailRes.json();

  const daftar = detail.enabled_payments || [];
  const lebar = Math.max(...daftar.map((p) => p.type.length), 10);

  console.log('Kanal'.padEnd(lebar) + '  Status   Tipe');
  console.log('-'.repeat(lebar + 20));
  for (const p of daftar) {
    const tanda = p.status === 'up' ? 'OK  ' : 'DOWN';
    console.log(`${p.type.padEnd(lebar)}  ${p.status.padEnd(7)}  ${tanda} ${p.va_type || p.category || ''}`);
  }

  const bni = daftar.find((p) => p.type === 'bni_va');
  console.log('');
  if (!bni) {
    console.log('bni_va tidak ada di daftar -> kanal ini tidak aktif untuk akun ini.');
  } else if (bni.status === 'up') {
    console.log('bni_va UP -> Snap seharusnya bisa menampilkan nomor VA.');
  } else {
    console.log('bni_va DOWN -> penyebab "We\'re experiencing system error" di halaman Snap.');
    console.log('Aktifkan di dashboard: Settings > Snap Preferences > Payment Channels');
    console.log('(pastikan sedang di environment Sandbox).');
  }
})().catch((err) => {
  console.log('Error: ' + err.message);
  process.exitCode = 1;
});
