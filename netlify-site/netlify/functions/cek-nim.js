/**
 * GET /api/cek-nim?nim=... -> verifikasi NIM alumni ke Apps Script.
 *
 * Dipakai halaman form donasi untuk mencocokkan NIM donatur dengan
 * sheet "Master_Alumni" di Google Spreadsheet.
 */

const { GAS_URL } = require('./_config');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { status: 'error', message: 'Method not allowed' });
  }

  if (!GAS_URL) {
    return json(500, { status: 'error', message: 'GAS_URL belum di-set di _config.js' });
  }

  const nim = (event.queryStringParameters && event.queryStringParameters.nim) || '';
  const url = `${GAS_URL}?action=cek_nim&nim=${encodeURIComponent(nim)}`;

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...CORS,
      },
      body: text,
    };
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return json(502, {
      status: 'error',
      message: timeout ? 'Koneksi ke Apps Script timeout' : 'Tidak bisa menghubungi Apps Script',
      detail: err?.message || String(err),
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
