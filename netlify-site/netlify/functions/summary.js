/**
 * GET /api/summary -> ringkasan dana kampanye (publik).
 *
 * Dipakai bilah progres di halaman donasi. Hanya mengembalikan angka agregat:
 * total terkumpul, target, dan jumlah donatur. Tidak ada data pribadi.
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

  try {
    const res = await fetch(`${GAS_URL}?action=summary`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!data || data.status !== 'OK' || typeof data.total !== 'number') {
      return json(503, {
        status: 'error',
        message:
          'Ringkasan dana belum tersedia. Apps Script perlu di-deploy ulang ' +
          '(Deploy > Manage deployments > Edit > New version).',
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=30',
        ...CORS,
      },
      body: JSON.stringify({
        status: 'OK',
        total: data.total,
        target: data.target,
        donatur: data.donatur,
        updated: data.updated || '',
      }),
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
