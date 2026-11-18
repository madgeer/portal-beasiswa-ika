/**
 * Cek webhook Apps Script dari terminal.
 *
 *   node cek-webhook.js            -> cek versi kode yang aktif di URL /exec
 *   node cek-webhook.js --email    -> kirim 1 notifikasi tes (menulis 1 baris
 *                                     sheet + mengirim 2 email)
 *   node cek-webhook.js --email --to=email@lain.com
 *
 * Kalau hasil cek pertama masih "versi LAMA", berarti deployment di Apps Script
 * belum diperbarui (Manage deployments -> Edit -> New version -> Deploy).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GAS_URL =
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbxCsCV46zYPEzuMJu8vIDzpEaLo4J1YBfKuVFr-MP1VthaiEnuFqzTux-sMVChbrpYDJQ/exec';

const VERSI_DIHARAPKAN = '2026-11-11';

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

async function cekVersi() {
  console.log('Cek: ' + GAS_URL + '\n');

  const res = await fetch(GAS_URL, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const teks = await res.text();

  let data = {};
  try {
    data = JSON.parse(teks);
  } catch {
    data = { raw: teks.slice(0, 300) };
  }

  console.log('Balasan:', JSON.stringify(data, null, 2));

  const versi = data.version || '(tidak ada)';
  const cocok = versi === VERSI_DIHARAPKAN;

  console.log('');
  if (cocok) {
    console.log(`OK   Versi ${versi} sudah aktif.`);
    if (data.email_ika_terisi === false) {
      console.log('PERINGATAN  EMAIL_IKA belum diisi di Script Properties.');
    }
  } else {
    console.log(`LAMA  Versi aktif: ${versi} | diharapkan: ${VERSI_DIHARAPKAN}`);
    console.log('      Deploy ulang: Manage deployments -> Edit -> New version -> Deploy.');
  }

  return cocok;
}

async function kirimTes(emailDonatur) {
  const env = bacaEnv();
  const secret = env.MIDTRANS_SIGNATURE_KEY;

  if (!secret) {
    console.log('\nMIDTRANS_SIGNATURE_KEY tidak ada di .env -> tes dilewati.');
    return;
  }

  const orderId = 'TES-EMAIL-' + Date.now();
  const payload = {
    order_id: orderId,
    transaction_status: 'settlement',
    status_code: '200',
    gross_amount: '50000.00',
    payment_type: 'bank_transfer',
    transaction_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    va_numbers: [{ bank: 'bni', va_number: '9887175790000003' }],
    custom_field1: 'tes email dari cek-webhook.js',
    custom_field2: 'Tes Email',
    custom_field3: emailDonatur,
  };

  payload.signature_key = crypto
    .createHash('sha512')
    .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${secret}`, 'utf8')
    .digest('hex');

  console.log('\nKirim tes: ' + orderId);
  console.log('Email donatur: ' + emailDonatur + '\n');

  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  });

  const teks = await res.text();
  console.log('HTTP ' + res.status);
  console.log(teks.slice(0, 700));

  try {
    const data = JSON.parse(teks);
    if (data.email) {
      console.log('\nEmail IKA    : ' + (data.email.ke_ika ? 'terkirim' : 'GAGAL'));
      console.log('Email donatur: ' + (data.email.ke_donatur ? 'terkirim' : 'GAGAL'));
    }
  } catch {
    // balasan bukan JSON, biarkan apa adanya
  }
}

(async () => {
  const args = process.argv.slice(2);
  const mauTes = args.includes('--email');
  const to = (args.find((a) => a.startsWith('--to=')) || '').slice(5);

  try {
    await cekVersi();
    if (mauTes) await kirimTes(to || 'mmrizkiana@gmail.com');
  } catch (err) {
    console.log('\nGAGAL: ' + err.message);
    process.exitCode = 1;
  }
})();
