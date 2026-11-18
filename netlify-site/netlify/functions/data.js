/**
 * GET /api/data?key=... -> meneruskan permintaan data dashboard ke Apps Script.
 *
 * Dipakai halaman /dashboard.html. Keberadaannya membuat dashboard dan sumber
 * data berada di origin yang sama (tidak kena aturan CORS peramban).
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

  const key = (event.queryStringParameters && event.queryStringParameters.key) || '';
  const url = `${GAS_URL}?action=data&key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    const text = await res.text();

    // Apps Script versi lama mengabaikan ?action=data dan hanya membalas
    // info versi. Deteksi itu supaya dashboard tidak menampilkan "0 donasi".
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (parsed && parsed.status === 'OK' && !Array.isArray(parsed.data)) {
      return json(503, {
        status: 'error',
        message:
          'Apps Script masih versi lama (belum mendukung ?action=data). ' +
          'Tempel script.gs terbaru lalu Deploy → Manage deployments → Edit → New version.',
      });
    }

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
