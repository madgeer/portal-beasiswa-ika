/**
 * POST /api/snap -> membuat transaksi Snap (semua metode yang aktif di Midtrans).
 * Server Key diambil dari environment variable Netlify (tidak pernah dikirim ke browser).
 *
 * Env var wajib:
 *   MIDTRANS_SERVER_KEY  = SB-Mid-server-... (atau Mid-server-... untuk production)
 *   MIDTRANS_CLIENT_KEY  = client key
 *   MIDTRANS_IS_PRODUCTION = 'true' | 'false'
 */

const { SERVER_KEY, IS_PRODUCTION } = require('./_config');

const MIDTRANS_BASE = IS_PRODUCTION
  ? 'https://app.midtrans.com'
  : 'https://app.sandbox.midtrans.com';

const MIN_AMOUNT = 10000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  if (!SERVER_KEY) {
    return json(500, {
      error: 'MIDTRANS_SERVER_KEY belum di-set',
      detail: 'Netlify > Project configuration > Environment variables > MIDTRANS_SERVER_KEY',
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Body bukan JSON yang valid' });
  }

  const amount = Number(body.amount);
  const customerName = String(body.name || 'Hamba Allah').slice(0, 50);
  const customerEmail = body.email ? String(body.email).slice(0, 50) : '';
  const note = String(body.note || 'Donasi Beasiswa Alumni').slice(0, 50);
  const isAlumni = Boolean(body.isAlumni);
  const nim = String(body.nim || '').trim().slice(0, 30);
  const angkatan = isAlumni ? String(body.angkatan || '').trim().slice(0, 4) : '';
  const prodi = isAlumni ? String(body.prodi || '').trim().slice(0, 40) : '';

  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return json(400, { error: 'Nominal donasi tidak valid' });
  }
  if (amount < MIN_AMOUNT) {
    return json(400, { error: `Nominal minimal Rp${MIN_AMOUNT.toLocaleString('id-ID')}` });
  }

  const orderId = `DONASI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const payload = {
    transaction_details: { order_id: orderId, gross_amount: amount },
    customer_details: {
      first_name: customerName,
      ...(customerEmail ? { email: customerEmail } : {}),
    },
    // Tanpa enabled_payments, Snap menampilkan semua kanal yang aktif
    // di akun Midtrans (VA bank, e-wallet, QRIS, gerai retail, kartu kredit).
    // Untuk membatasi, isi array-nya, mis. ['bni_va', 'bca_va', 'gopay'].
    // custom_field selalu dikembalikan di notifikasi Midtrans
    custom_field1: note,
    custom_field2: customerName,
    custom_field3: customerEmail,
    // Format: ALUMNI|angkatan|prodi|nim  atau  UMUM
    custom_field4: isAlumni
      ? ['ALUMNI', angkatan, prodi.replace(/\|/g, '/'), nim.replace(/\|/g, '/')].join('|')
      : 'UMUM',
    // Jalur utama: metadata bebas format dan ikut dikembalikan di notifikasi.
    metadata: {
      nama: customerName,
      email: customerEmail,
      pesan: note,
      kategori: isAlumni ? 'ALUMNI' : 'UMUM',
      angkatan: angkatan || '-',
      prodi: prodi || '-',
      nim: nim || '-',
      hidden: Boolean(body.hidden),
    },
  };

  try {
    const res = await fetch(`${MIDTRANS_BASE}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${SERVER_KEY}:`).toString('base64'),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 300) };
    }

    if (!res.ok) {
      console.error('Midtrans gagal:', res.status, data);
      if (res.status === 401) {
        return json(401, {
          error: 'Server Key ditolak Midtrans (401 Unauthorized)',
          detail:
            'Pastikan MIDTRANS_SERVER_KEY di Netlify adalah key dari tabel "Server Keys", ' +
            'bukan Signature Secret Key.',
        });
      }
      return json(res.status, {
        error: 'Midtrans menolak transaksi',
        status_code: data.status_code,
        status_message:
          data.status_message || data.error_messages?.join(', ') || `HTTP ${res.status}`,
        order_id: orderId,
      });
    }

    console.log('Token dibuat:', orderId, amount, customerName);
    return json(200, {
      token: data.token,
      redirect_url: data.redirect_url,
      order_id: orderId,
    });
  } catch (err) {
    console.error('Midtrans error:', err);
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return json(502, {
      error: timeout ? 'Koneksi ke Midtrans timeout' : 'Tidak bisa menghubungi Midtrans',
      detail: err?.cause?.code || err?.message || String(err),
    });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
    body: JSON.stringify(obj),
  };
}
