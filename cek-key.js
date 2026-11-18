/**
 * Cek apakah Server Key & Client Key Midtrans valid, tanpa perlu buka browser.
 *
 *   node cek-key.js                 -> cek key dari .env
 *   node cek-key.js SB-Mid-server-...  -> cek key lain
 *
 * Yang dicek:
 *   1. Format prefix (sandbox harus SB-Mid-...)
 *   2. Apakah Midtrans menerima key itu (POST transaksi percobaan)
 */

const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // abaikan: mungkin key dikirim lewat argumen
}

const key = (process.argv[2] || process.env.MIDTRANS_SERVER_KEY || '').trim();
const clientKey = (process.env.MIDTRANS_CLIENT_KEY || '').trim();

if (!key) {
  console.error('Tidak ada key. Isi MIDTRANS_SERVER_KEY di .env atau kirim sebagai argumen.');
  process.exit(1);
}

function analisaFormat(k, label, jenis = 'server') {
  const hasil = [];
  if (!k) return hasil;

  const isClientKey = k.startsWith('Mid-client-') || k.startsWith('SB-Mid-client-');
  const isServerKey = k.startsWith('Mid-server-') || k.startsWith('SB-Mid-server-');

  if (jenis === 'server') {
    if (isClientKey) hasil.push(`${label}: ini CLIENT KEY, bukan Server Key [SALAH]`);
    else if (isServerKey) hasil.push(`${label}: format Server Key dikenali`);
    else hasil.push(`${label}: format tidak umum, tetap diuji (bisa jadi key baru dashboard)`);
  } else {
    if (isServerKey) hasil.push(`${label}: ini SERVER KEY, jangan dipakai di frontend [SALAH]`);
    else if (isClientKey) hasil.push(`${label}: format Client Key dikenali`);
    else hasil.push(`${label}: format tidak umum, tetap diuji`);
  }

  return hasil;
}

async function coba(base, label) {
  const body = JSON.stringify({
    transaction_details: { order_id: `CEKKEY-${Date.now()}`, gross_amount: 10000 },
    enabled_payments: ['bni_va'],
  });

  try {
    const res = await fetch(`${base}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    return { label, status: res.status, text: text.slice(0, 300) };
  } catch (err) {
    return { label, status: 0, text: `tidak bisa konek: ${err.message}` };
  }
}

(async () => {
  console.log('Key yang dicek :', key.slice(0, 16) + '…', `(${key.length} karakter)`);
  console.log('Client key     :', clientKey ? clientKey.slice(0, 15) + '…' : '(tidak ada)');
  console.log('');

  for (const baris of [
    ...analisaFormat(key, 'Server Key', 'server'),
    ...analisaFormat(clientKey, 'Client Key', 'client'),
  ]) {
    console.log(' -', baris);
  }

  console.log('\nMenghubungi Midtrans...\n');
  const hasil = await Promise.all([
    coba('https://app.sandbox.midtrans.com', 'SANDBOX'),
    coba('https://app.midtrans.com', 'PRODUCTION'),
  ]);

  for (const h of hasil) {
    const tanda = h.status === 200 || h.status === 201 ? '✓ DITERIMA' : '✗ ditolak';
    console.log(`[${h.label}] HTTP ${h.status} ${tanda}`);
    console.log('  ', h.text.replace(/\s+/g, ' ').slice(0, 200));
  }

  const ada200 = hasil.some((h) => h.status === 200 || h.status === 201);
  console.log('');
  if (ada200) {
    console.log('Kesimpulan: key VALID. Salin ke MIDTRANS_SERVER_KEY di .env, lalu restart node server.js.');
    console.log('Set MIDTRANS_IS_PRODUCTION sesuai environment yang menerima key.');
  } else {
    console.log('Kesimpulan: key TIDAK VALID sebagai Server Key API.');
    console.log('Di dashboard: Settings > Access Keys.');
    console.log('  - "Signature Secret Key"  -> HANYA untuk verifikasi webhook, TIDAK bisa dipakai API (selalu 401).');
    console.log('  - Tabel "Server Keys"     -> klik "Generate server key", lalu COPY key yang muncul.');
    console.log('Uji lagi: node cek-key.js <key-baru>');
  }
})();
