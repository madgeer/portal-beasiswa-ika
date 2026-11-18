/**
 * GET /api/health -> dipakai halaman untuk memastikan backend siap.
 * Sengaja TIDAK mengirim potongan Server Key ke browser.
 */

const { SERVER_KEY, CLIENT_KEY, IS_PRODUCTION } = require('./_config');

const MIDTRANS_BASE = IS_PRODUCTION
  ? 'https://app.midtrans.com'
  : 'https://app.sandbox.midtrans.com';

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify({
    ok: true,
    mode: IS_PRODUCTION ? 'production' : 'sandbox',
    server_key_loaded: Boolean(SERVER_KEY),
    server_key_hint: null,
    client_key: CLIENT_KEY || null,
    format_masalah: [],
    snap_js_url: `${MIDTRANS_BASE}/snap/snap.js`,
  }),
});
