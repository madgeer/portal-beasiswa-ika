/**
 * RELAY MIDTRANS -> GOOGLE APPS SCRIPT  (Cloudflare Worker)
 *
 * Kenapa perlu: web app Apps Script SELALU membalas HTTP 302 (redirect ke
 * script.googleusercontent.com). Midtrans hanya menerima HTTP 200, jadi
 * notifikasi dianggap gagal walau script tetap jalan.
 *
 * Worker ini menerima notifikasi, meneruskannya ke Apps Script, lalu
 * membalas 200 ke Midtrans.
 *
 * Cara pasang (gratis, ±3 menit):
 *   1. https://dash.cloudflare.com -> Workers & Pages -> Create -> Worker
 *   2. Ganti isi editor dengan file ini -> Deploy
 *   3. Worker -> Settings -> Variables and Secrets -> Add:
 *        Name : GAS_URL
 *        Value: https://script.google.com/macros/s/AKfy.../exec
 *      (URL /exec milik Anda)
 *   4. Salin URL worker, mis. https://relay-donasi.username.workers.dev
 *   5. Midtrans -> Settings -> Configuration -> Payment Notification URL
 *      = URL worker tersebut.
 *
 * Tes: buka URL worker di browser -> harus muncul "Relay aktif" (HTTP 200).
 */

export default {
  async fetch(request, env) {
    if (request.method === 'GET') {
      return new Response('Relay aktif. Kirim POST ke URL ini.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    if (!env.GAS_URL) {
      return json(500, { ok: false, error: 'GAS_URL belum di-set di Worker Variables' });
    }

    const raw = await request.text();

    try {
      // redirect: 'follow' -> 302 Apps Script diikuti sampai dapat isi JSON-nya
      const upstream = await fetch(env.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
        redirect: 'follow',
      });

      const text = await upstream.text();
      console.log('Apps Script:', upstream.status, text.slice(0, 300));

      if (upstream.status >= 200 && upstream.status < 300) {
        // 200 ke Midtrans -> notifikasi dianggap sukses, tidak diulang terus.
        return json(200, { ok: true, upstream: upstream.status, response: text.slice(0, 500) });
      }

      return json(502, { ok: false, upstream: upstream.status, response: text.slice(0, 500) });
    } catch (err) {
      return json(502, { ok: false, error: String(err) });
    }
  },
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
