/**
 * Backend kecil untuk aplikasi donasi IKA UPI.
 *
 * Tugasnya cuma dua:
 *   1. Menyajikan index.html
 *   2. Meneruskan permintaan pembuatan transaksi ke Midtrans Snap
 *      memakai SERVER KEY yang aman (tidak pernah dikirim ke browser).
 *
 * Jalankan:  node server.js   ->  http://localhost:3000
 * Tanpa dependency tambahan (hanya modul bawaan Node.js >= 20.12).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Muat variabel dari .env (kalau ada).
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // .env belum dibuat -> pakai environment variable sistem.
}

const PORT = Number(process.env.PORT || 3000);
const SERVER_KEY = (process.env.MIDTRANS_SERVER_KEY || '').trim();
const CLIENT_KEY = (process.env.MIDTRANS_CLIENT_KEY || '').trim();
const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const GAS_URL = (
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbxCsCV46zYPEzuMJu8vIDzpEaLo4J1YBfKuVFr-MP1VthaiEnuFqzTux-sMVChbrpYDJQ/exec'
).trim();

const MIDTRANS_BASE = IS_PRODUCTION
  ? 'https://app.midtrans.com'
  : 'https://app.sandbox.midtrans.com';

const MIN_AMOUNT = 10000;

/* ------------------------------------------------------------------ */
/* Cek format key: sandbox harus berawalan SB-Mid-server / SB-Mid-client */
/* ------------------------------------------------------------------ */

function cekFormatKey() {
  const masalah = [];

  if (SERVER_KEY) {
    if (SERVER_KEY.startsWith('Mid-client-') || SERVER_KEY.startsWith('SB-Mid-client-')) {
      masalah.push(
        'MIDTRANS_SERVER_KEY berisi CLIENT KEY. Ambil dari tabel "Server Keys" > Generate server key.'
      );
    }
    if (IS_PRODUCTION && SERVER_KEY.startsWith('SB-Mid-server-')) {
      masalah.push('Mode PRODUCTION tetapi Server Key masih key sandbox.');
    }
  }

  if (CLIENT_KEY && (CLIENT_KEY.startsWith('Mid-server-') || CLIENT_KEY.startsWith('SB-Mid-server-'))) {
    masalah.push('MIDTRANS_CLIENT_KEY berisi SERVER KEY. Jangan pakai server key di frontend.');
  }

  return masalah;
}


/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Endpoint: buat transaksi Snap                                       */
/* ------------------------------------------------------------------ */

async function handleSnap(req, res) {
  if (!SERVER_KEY) {
    return sendJSON(res, 500, {
      error: 'MIDTRANS_SERVER_KEY belum di-set',
      detail: 'Buat file .env berisi MIDTRANS_SERVER_KEY=Mid-server-... lalu jalankan ulang node server.js',
    });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJSON(res, 400, { error: 'Body bukan JSON yang valid' });
  }

  const amount = Number(body?.amount);
  const customerName = String(body?.name || 'Hamba Allah').slice(0, 50);
  const customerEmail = body?.email ? String(body.email).slice(0, 50) : null;
  const note = String(body?.note || 'Donasi Beasiswa Alumni').slice(0, 50);
  const isAlumni = Boolean(body?.isAlumni);
  const nim = String(body?.nim || '').trim().slice(0, 30);
  const angkatan = isAlumni ? String(body?.angkatan || '').trim().slice(0, 4) : '';
  const prodi = isAlumni ? String(body?.prodi || '').trim().slice(0, 40) : '';

  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return sendJSON(res, 400, { error: 'Nominal donasi tidak valid' });
  }
  if (amount < MIN_AMOUNT) {
    return sendJSON(res, 400, { error: `Nominal minimal Rp${MIN_AMOUNT.toLocaleString('id-ID')}` });
  }

  const orderId = `BNI-IKA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount,
    },
    customer_details: {
      first_name: customerName,
      ...(customerEmail ? { email: customerEmail } : {}),
    },
    enabled_payments: ['bni_va'],
    // Notifikasi Midtrans tidak mengirim customer_details, jadi data penting
    // dititipkan ke custom_field yang SELALU dikembalikan di webhook:
    custom_field1: note,          // pesan donatur
    custom_field2: customerName,  // nama donatur -> dipakai script.gs
    custom_field3: customerEmail || '', // email donatur -> untuk notifikasi
    // Format: ALUMNI|angkatan|prodi|nim  atau  UMUM
    custom_field4: isAlumni
      ? ['ALUMNI', angkatan, prodi.replace(/\|/g, '/'), nim.replace(/\|/g, '/')].join('|')
      : 'UMUM',
    // Jalur utama: metadata bebas format dan ikut dikembalikan di notifikasi.
    metadata: {
      nama: customerName,
      email: customerEmail || '',
      pesan: note,
      kategori: isAlumni ? 'ALUMNI' : 'UMUM',
      angkatan: angkatan || '-',
      prodi: prodi || '-',
      nim: nim || '-',
      hidden: Boolean(body?.hidden),
    },
  };

  try {
    const midtransRes = await fetch(`${MIDTRANS_BASE}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization:
          'Basic ' + Buffer.from(`${SERVER_KEY}:`).toString('base64'),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });

    const text = await midtransRes.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 500) };
    }

    if (!midtransRes.ok) {
      // Teruskan pesan asli Midtrans supaya gampang didiagnosis.
      console.error('[Midtrans] gagal:', midtransRes.status, data);

      if (midtransRes.status === 401) {
        return sendJSON(res, 401, {
          error: 'Server Key ditolak Midtrans (401 Unauthorized)',
          detail:
            'Key yang dipakai: ' + (SERVER_KEY.slice(0, 14) || '(kosong)') + '…\n' +
            'Pastikan Anda memakai key dari tabel "Server Keys" (tombol Generate server key), ' +
            'BUKAN "Signature Secret Key" — key itu hanya untuk verifikasi signature webhook.\n' +
            'Setelah dapat key baru: perbarui MIDTRANS_SERVER_KEY di .env, lalu jalankan ' +
            '"node cek-key.js" untuk memastikan key diterima Midtrans.',
          format_masalah: cekFormatKey(),
          order_id: orderId,
        });
      }

      return sendJSON(res, midtransRes.status, {
        error: 'Midtrans menolak transaksi',
        status_code: data.status_code,
        status_message:
          data.status_message || data.error_messages?.join(', ') || `HTTP ${midtransRes.status}`,
        order_id: orderId,
      });
    }

    console.log(
      `[Midtrans] token dibuat untuk ${orderId} (Rp${amount}) ` +
      `nama="${customerName}" email="${customerEmail || '-'}"`
    );
    return sendJSON(res, 200, {
      token: data.token,
      redirect_url: data.redirect_url,
      order_id: orderId,
    });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.error('[Midtrans] error koneksi:', err);
    return sendJSON(res, 502, {
      error: isTimeout
        ? 'Koneksi ke Midtrans timeout (20 detik)'
        : 'Tidak bisa menghubungi Midtrans',
      detail: err?.cause?.code || err?.message || String(err),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Endpoint: cek status alumni (Google Apps Script)                   */
/* ------------------------------------------------------------------ */

async function handleCekNim(url, res) {
  const nim = (url.searchParams.get('nim') || '').trim();
  if (!nim) {
    return sendJSON(res, 400, { status: 'error', message: 'Parameter nim diperlukan' });
  }

  try {
    const fetchRes = await fetch(`${GAS_URL}?action=cek_nim&nim=${encodeURIComponent(nim)}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const text = await fetchRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { status: 'error', message: 'Balasan Apps Script bukan JSON: ' + text.slice(0, 200) };
    }
    return sendJSON(res, 200, data);
  } catch (err) {
    console.error('[Cek NIM] error:', err);
    return sendJSON(res, 502, {
      status: 'error',
      message: 'Gagal menghubungi server verifikasi alumni: ' + (err.message || String(err)),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Endpoint: ringkasan dana kampanye (publik)                         */
/* ------------------------------------------------------------------ */

async function handleSummary(res) {
  try {
    const fetchRes = await fetch(`${GAS_URL}?action=summary`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const text = await fetchRes.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!data || data.status !== 'OK' || typeof data.total !== 'number') {
      return sendJSON(res, 503, {
        status: 'error',
        message: 'Ringkasan dana belum tersedia.',
      });
    }

    return sendJSON(res, 200, data);
  } catch (err) {
    console.error('[Ringkasan] error:', err);
    return sendJSON(res, 502, {
      status: 'error',
      message: 'Tidak dapat menghubungi server ringkasan dana.',
    });
  }
}

/* ------------------------------------------------------------------ */
/* Static: hanya index.html                                            */
/* ------------------------------------------------------------------ */

function serveIndex(res) {
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('index.html tidak ditemukan');
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Izinkan halaman dibuka dari port lain (mis. Live Server) atau file://.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (url.pathname === '/api/snap' && req.method === 'POST') {
    return handleSnap(req, res);
  }
  if (url.pathname === '/api/cek-nim' && req.method === 'GET') {
    return handleCekNim(url, res);
  }
  if (url.pathname === '/api/summary' && req.method === 'GET') {
    return handleSummary(res);
  }
  if (url.pathname === '/api/health') {
    return sendJSON(res, 200, {
      ok: true,
      mode: IS_PRODUCTION ? 'production' : 'sandbox',
      server_key_loaded: Boolean(SERVER_KEY),
      server_key_hint: SERVER_KEY
        ? `${SERVER_KEY.slice(0, 14)}…${SERVER_KEY.slice(-4)} (${SERVER_KEY.length} karakter)`
        : null,
      client_key: CLIENT_KEY || null,
      format_masalah: cekFormatKey(),
      snap_js_url: `${MIDTRANS_BASE}/snap/snap.js`,
    });
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return serveIndex(res);
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log(`  Donasi IKA UPI  ->  http://localhost:${PORT}`);
  console.log(`  Mode Midtrans   :  ${IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX'}`);
  console.log(`  Server key      :  ${SERVER_KEY ? 'terbaca [OK]' : 'BELUM DI-SET [X]'}`);
  console.log(`  Client key      :  ${CLIENT_KEY ? 'terbaca [OK]' : 'BELUM DI-SET [X]'}`);

  const masalah = cekFormatKey();
  if (masalah.length) {
    console.log('──────────────────────────────────────────────');
    for (const m of masalah) console.log('  [X] ' + m);
    console.log('  [X] Transaksi akan gagal (401) sampai key diperbaiki.');
  }
  console.log('──────────────────────────────────────────────');
});
