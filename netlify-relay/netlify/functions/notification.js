/**
 * Relay Midtrans -> Google Apps Script.
 *
 * Midtrans mensyaratkan balasan HTTP 200, sedangkan web app Apps Script selalu
 * membalas 302. Fungsi ini menerima notifikasi, meneruskannya ke Apps Script,
 * lalu membalas 200.
 *
 * Env var wajib: GAS_URL
 *   (Settings > Environment variables > GAS_URL = URL /exec Apps Script)
 */

// URL web app Apps Script (boleh juga ditimpa lewat env var GAS_URL).
const GAS_URL =
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbxCsCV46zYPEzuMJu8vIDzpEaLo4J1YBfKuVFr-MP1VthaiEnuFqzTux-sMVChbrpYDJQ/exec';

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return json(200, { ok: true, message: 'Relay aktif. Kirim POST ke /api/notification' });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  if (!GAS_URL) {
    return json(500, { ok: false, error: 'GAS_URL belum di-set di Environment variables' });
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '{}';

  try {
    // fetch mengikuti 302 Apps Script (POST -> GET ke googleusercontent) dan
    // mengembalikan isi JSON dari doPost.
    const upstream = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      redirect: 'follow',
    });

    const text = await upstream.text();
    console.log('Apps Script:', upstream.status, text.slice(0, 300));

    if (upstream.status >= 200 && upstream.status < 300) {
      // Apps Script bisa membalas HTTP 200 tapi isinya {"status":"error"}
      // (misalnya izin email belum disetujui). Jangan bilang "sukses" ke
      // Midtrans supaya notifikasi dicoba ulang, bukan hilang diam-diam.
      let hasil = null;
      try {
        hasil = JSON.parse(text);
      } catch {
        hasil = null;
      }

      if (hasil && hasil.status === 'error') {
        console.error('Apps Script error:', hasil.message);
        return json(502, { ok: false, status: 'error', response: text.slice(0, 500) });
      }

      return json(200, { ok: true, upstream: upstream.status, response: text.slice(0, 500) });
    }

    // Gagal di sisi Google -> minta Midtrans mengulang nanti.
    return json(502, { ok: false, upstream: upstream.status, response: text.slice(0, 500) });
  } catch (err) {
    console.error('Relay error:', err);
    return json(502, { ok: false, error: String(err) });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj),
  };
}
