/**
 * CONTOH konfigurasi fungsi Netlify.
 *
 * Salin file ini menjadi `_config.js` (nama tanpa ".example") lalu isi key asli:
 *
 *   Copy-Item _config.example.js _config.js
 *
 * File `_config.js` sengaja di-.gitignore supaya Server Key tidak ikut ke GitHub.
 *
 * Prioritas: environment variable Netlify (kalau plan mendukung) -> nilai di file ini.
 * Akun Netlify free saat ini menolak environment variable lewat API/CLI
 * ("Upgrade your Netlify account..."), jadi nilai di bawah dipakai sebagai fallback.
 */

module.exports = {
  SERVER_KEY: (process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-xxxxxxxxxxxxxxxxxxxxxxxx').trim(),
  CLIENT_KEY: (process.env.MIDTRANS_CLIENT_KEY || 'Mid-client-xxxxxxxxxxxxxxxx').trim(),
  IS_PRODUCTION: (process.env.MIDTRANS_IS_PRODUCTION || 'false') === 'true',
  GAS_URL: (
    process.env.GAS_URL ||
    'https://script.google.com/macros/s/GANTI_DENGAN_ID_DEPLOYMENT_ANDA/exec'
  ).trim(),
};
