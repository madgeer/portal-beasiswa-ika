/**
 * WEBHOOK MIDTRANS -> GOOGLE SHEETS + EMAIL
 * Beasiswa Ikatan Alumni
 *
 * Cara pakai singkat:
 *   1. Ganti EMAIL_IKA di bagian KONFIGURASI (atau biarkan kosong -> otomatis ke email pemilik script).
 *   2. Deploy > Manage deployments > Edit > New version > Deploy (wajib, karena ada izin MailApp baru).
 *   3. Isi Script Properties "MIDTRANS_SIGNATURE_KEY" dengan Signature Secret Key dari dashboard.
 *   4. Panggil fungsi tesEmail() sekali untuk memberi izin kirim email.
 */

/* ============================== KONFIGURASI ============================== */

// Penanda versi. Naikkan angkanya tiap kali kode diubah, supaya bisa dicek
// dari browser: buka URL /exec -> harus muncul "version" yang sama.
const SCRIPT_VERSION = '2026-11-24';

const CONFIG = {
  // Nama sheet. Kosongkan ('') untuk memakai sheet yang sedang aktif.
  SHEET_NAME: '',

  // Target dana kampanye (rupiah). Dipakai bilah progres di halaman donasi.
  // Bisa ditimpa lewat Script Properties CAMPAIGN_TARGET.
  CAMPAIGN_TARGET: 50000000,

  // Email tujuan notifikasi "donasi masuk" untuk pihak IKA / pengelola beasiswa.
  // Boleh juga diisi lewat Script Properties EMAIL_IKA (menimpa nilai ini).
  EMAIL_IKA: 'muhammadrizkianapratama@gmail.com',

  SEND_DONOR_EMAIL: true, // kirim email terima kasih ke donatur
  SEND_IKA_EMAIL: true,   // kirim notifikasi donasi masuk ke IKA

  // Verifikasi signature_key dari Midtrans (disarankan AKTIF).
  // Secret-nya diambil dari Script Properties: MIDTRANS_SIGNATURE_KEY
  VERIFY_SIGNATURE: true,

  // true kalau baris 1 sheet berisi judul kolom (data ditulis mulai baris 2).
  HAS_HEADER_ROW: false,

  // Kunci akses dashboard. WAJIB diisi lewat Script Properties DASHBOARD_KEY.
  // Sengaja dikosongkan supaya tidak ikut terlihat di repositori publik.
  DASHBOARD_KEY: '',
};

/* ============================== ENTRY POINT ============================== */

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    // Cegah dua notifikasi bersamaan menulis baris ganda.
    lock.waitLock(30000);
  } catch (err) {
    return json({ status: 'error', message: 'Server sibuk, notifikasi ditolak sementara' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ status: 'error', message: 'Body kosong' });
    }

    const data = JSON.parse(e.postData.contents);

    // 1) Verifikasi keaslian notifikasi
    if (!verifySignature(data)) {
      return json({ status: 'error', message: 'Signature tidak valid' });
    }

    const orderId = data.order_id || data.transaction_id || '-';
    const status = String(data.transaction_status || data.status || '').toLowerCase();
    const fraud = String(data.fraud_status || '').toLowerCase();

    // 2) Hanya proses transaksi yang benar-benar lunas
    const lunas =
      status === 'settlement' ||
      (status === 'capture' && (fraud === 'accept' || fraud === '')) ||
      status === 'success';

    if (!lunas) {
      return json({ status: 'OK', message: `Status "${status}" belum lunas, tidak dicatat` });
    }

    const sheet = getSheet();

    // 3) Anti-duplikat: notifikasi Midtrans bisa dikirim lebih dari sekali
    if (sudahTercatat(sheet, orderId)) {
      return json({ status: 'OK', message: 'Order sudah tercatat, dilewati', order_id: orderId });
    }

    // 4) Ambil data donatur
    const donor = ambilDataDonatur(data);

    // 5) Tulis ke spreadsheet (13 kolom)
    sheet.appendRow([
      new Date(),
      orderId,
      donor.bank,
      donor.vaNumber,
      donor.name,
      donor.amount,
      donor.note,
      'LUNAS / SUCCESS',
      donor.email || '-',
      donor.statusDonatur,
      donor.nim,
      donor.angkatan,
      donor.prodi,
    ]);

    // 6) Kirim email
    const emailTerkirim = kirimNotifikasi(donor, orderId);

    return json({
      status: 'OK',
      version: SCRIPT_VERSION,
      order_id: orderId,
      nama: donor.name,
      email_donatur: donor.email || null,
      email: emailTerkirim,
    });
  } catch (error) {
    console.error(error);
    return json({ status: 'error', message: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

// Untuk cek cepat bahwa web app hidup + versi kode yang aktif.
// Buka URL /exec di browser: kalau "version" belum muncul, deployment masih lama.
//
// Dua mode:
//   /exec                      -> info versi
//   /exec?action=data&key=...  -> data donasi (JSON) untuk dashboard
function doGet(e) {
  const aksi = e && e.parameter ? String(e.parameter.action || '') : '';

  if (aksi === 'data') {
    return ambilDataDashboard(e.parameter);
  }

  // Ringkasan publik untuk bilah progres (tanpa kunci akses).
  if (aksi === 'summary') {
    return ringkasanDonasi();
  }

  // Lookup data alumni berdasarkan NIM
  if (aksi === 'cek_nim') {
    return cekNimAlumni(e && e.parameter ? e.parameter.nim : '');
  }

  return json({
    status: 'OK',
    version: SCRIPT_VERSION,
    email_ika_terisi: Boolean(ambilEmailIka()),
    kirim_email_donatur: CONFIG.SEND_DONOR_EMAIL,
    kirim_email_ika: CONFIG.SEND_IKA_EMAIL,
    verifikasi_signature: CONFIG.VERIFY_SIGNATURE,
    message: 'Webhook donasi Beasiswa Ikatan Alumni aktif',
  });
}

/**
 * Data untuk dashboard.
 * Diproteksi kunci sederhana (Script Properties DASHBOARD_KEY / CONFIG.DASHBOARD_KEY).
 */
function ambilDataDashboard(param) {
  const kunciBenar = String(getProperty('DASHBOARD_KEY') || CONFIG.DASHBOARD_KEY || '').trim();
  const kunci = String((param && param.key) || '').trim();

  if (!kunciBenar) {
    return json({ status: 'error', message: 'DASHBOARD_KEY belum di-set di Script Properties' });
  }
  if (kunci !== kunciBenar) {
    return json({ status: 'error', message: 'Kunci akses salah' });
  }

  const sheet = getSheet();
  const mulai = CONFIG.HAS_HEADER_ROW ? 2 : 1;
  const terakhir = sheet.getLastRow();

  if (terakhir < mulai) {
    return json({ status: 'OK', jumlah: 0, data: [] });
  }

  const jmlKolom = Math.max(13, sheet.getLastColumn());
  const values = sheet.getRange(mulai, 1, terakhir - mulai + 1, jmlKolom).getValues();
  const data = values.map(function (r) {
    const waktu = r[0] instanceof Date ? r[0] : new Date(r[0]);
    return {
      waktu: isNaN(waktu.getTime())
        ? String(r[0])
        : Utilities.formatDate(waktu, 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'),
      order_id: String(r[1] || ''),
      bank: String(r[2] || ''),
      va: String(r[3] || ''),
      nama: String(r[4] || ''),
      nominal: Number(r[5]) || 0,
      pesan: String(r[6] || ''),
      status: String(r[7] || ''),
      email: String(r[8] || ''),
      status_donatur: String(r[9] || 'Umum'),
      nim: String(r[10] || '-'),
      angkatan: String(r[11] || '-'),
      prodi: String(r[12] || '-'),
    };
  });

  // Terbaru di atas.
  data.reverse();

  return json({ status: 'OK', jumlah: data.length, data: data });
}

/**
 * Ringkasan publik untuk bilah progres di halaman donasi.
 * Tidak memuat data pribadi; hanya total, target, dan jumlah donatur.
 */
function ringkasanDonasi() {
  const sheet = getSheet();
  const mulai = CONFIG.HAS_HEADER_ROW ? 2 : 1;
  const terakhir = sheet.getLastRow();

  const target =
    Number(getProperty('CAMPAIGN_TARGET') || CONFIG.CAMPAIGN_TARGET) || 0;

  if (terakhir < mulai) {
    return json({ status: 'OK', total: 0, target: target, donatur: 0, updated: '' });
  }

  const values = sheet.getRange(mulai, 1, terakhir - mulai + 1, 6).getValues();

  let total = 0;
  let donatur = 0;
  let terakhirWaktu = '';

  for (let i = 0; i < values.length; i++) {
    const nominal = Number(values[i][5]) || 0;
    if (nominal <= 0) continue;

    total += nominal;
    donatur += 1;

    const waktu = values[i][0];
    const tanggal = waktu instanceof Date ? waktu : new Date(waktu);
    if (!isNaN(tanggal.getTime())) {
      terakhirWaktu = Utilities.formatDate(tanggal, 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
    }
  }

  return json({
    status: 'OK',
    total: total,
    target: target,
    donatur: donatur,
    updated: terakhirWaktu,
  });
}

/* ============================== DATA DONATUR ============================== */

/**
 * PENTING: notifikasi Midtrans TIDAK mengirim customer_details.
 * Data donatur dikirim lewat dua jalur:
 *
 *   metadata (jalur utama, bebas format):
 *     nama, email, pesan, kategori, angkatan, prodi, nim, hidden
 *
 *   custom_field1..4 (cadangan):
 *     1 = pesan/catatan
 *     2 = nama donatur (atau "Hamba Allah" bila disembunyikan)
 *     3 = email donatur
 *     4 = "ALUMNI|angkatan|prodi|nim" atau "UMUM"
 */
function ambilDataDonatur(data) {
  // Metadata bisa berupa objek atau string JSON, tergantung kanal.
  let meta = data.metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch (err) {
      meta = null;
    }
  }
  if (!meta || typeof meta !== 'object') meta = {};

  let name =
    data.custom_field2 ||
    meta.nama ||
    data.donor_name ||
    (data.customer_details &&
      (data.customer_details.full_name ||
        [data.customer_details.first_name, data.customer_details.last_name]
          .filter(Boolean)
          .join(' '))) ||
    '';

  name = String(name).trim();
  if (!name) name = 'Hamba Allah';

  let email =
    data.custom_field3 ||
    meta.email ||
    (data.customer_details && data.customer_details.email) ||
    '';
  email = String(email).trim();

  let note = data.custom_field1 || meta.pesan || data.donor_note || '';
  note = String(note).trim() || 'Donasi Beasiswa Alumni';

  // Status alumni, NIM, angkatan, dan program studi
  const statusField = String(data.custom_field4 || '').trim();

  let nim = '';
  let angkatan = '';
  let prodi = '';

  if (statusField.includes('|')) {
    // Format: ALUMNI|2021|PGSD|2101234
    const bagian = statusField.split('|').map(function (s) { return String(s).trim(); });
    angkatan = bagian[1] || '';
    prodi = bagian[2] || '';
    nim = bagian[3] || '';
  } else if (statusField.includes(':')) {
    // Format lama: ALUMNI:2101234
    nim = statusField.split(':')[1] || '';
  }

  nim = String(meta.nim || nim || '-').trim() || '-';
  angkatan = String(meta.angkatan || angkatan || '-').trim() || '-';
  prodi = String(meta.prodi || prodi || '-').trim() || '-';

  const isAlumni = meta.kategori
    ? String(meta.kategori).toUpperCase() === 'ALUMNI'
    : statusField.toUpperCase().startsWith('ALUMNI');

  if (!isAlumni) {
    nim = '-';
    angkatan = '-';
    prodi = '-';
  }

  const statusDonatur = isAlumni ? 'Alumni' : 'Umum';

  // Metode pembayaran bisa apa saja yang aktif di akun Midtrans.
  const tipe = String(data.payment_type || '').toLowerCase();

  let bank = 'MIDTRANS';
  let vaNumber = '-';
  let metode = 'Midtrans';

  if (Array.isArray(data.va_numbers) && data.va_numbers.length > 0) {
    bank = String(data.va_numbers[0].bank || 'VA').toUpperCase();
    vaNumber = String(data.va_numbers[0].va_number || '-');
    metode = bank + ' Virtual Account';
  } else if (data.permata_va_number) {
    bank = 'PERMATA';
    vaNumber = String(data.permata_va_number);
    metode = 'Permata Virtual Account';
  } else if (data.bca_va_number) {
    bank = 'BCA';
    vaNumber = String(data.bca_va_number);
    metode = 'BCA Virtual Account';
  } else if (data.bill_key && data.biller_code) {
    bank = 'MANDIRI';
    vaNumber = `${data.biller_code}${data.bill_key}`;
    metode = 'Mandiri Bill Payment';
  } else if (data.payment_code) {
    bank = String(data.store || 'GERAI').toUpperCase();
    vaNumber = String(data.payment_code);
    metode = 'Gerai ' + (data.store ? String(data.store) : 'ritel');
  } else if (tipe === 'gopay') {
    bank = 'GOPAY';
    metode = 'GoPay';
  } else if (tipe === 'shopeepay') {
    bank = 'SHOPEEPAY';
    metode = 'ShopeePay';
  } else if (tipe === 'qris') {
    bank = 'QRIS';
    metode = 'QRIS';
  } else if (tipe === 'credit_card') {
    bank = 'KARTU KREDIT';
    metode = 'Kartu kredit';
  } else if (tipe) {
    bank = tipe.toUpperCase();
    metode = 'Midtrans (' + tipe + ')';
  }

  return {
    name,
    email,
    note,
    bank,
    vaNumber,
    metode,
    amount: Number(data.gross_amount || data.amount || 0),
    paymentType: data.payment_type || 'bank_transfer',
    transactionTime: data.transaction_time || '',
    statusDonatur,
    nim,
    angkatan,
    prodi,
  };
}

/* ============================== EMAIL ============================== */

function kirimNotifikasi(donor, orderId) {
  const hasil = { ke_ika: false, ke_donatur: false };
  const emailIka = ambilEmailIka();

  if (CONFIG.SEND_IKA_EMAIL) {
    if (!emailIka) {
      console.warn(
        'EMAIL_IKA belum di-set. Isi Script Properties EMAIL_IKA = email@anda.com ' +
        'supaya notifikasi lembaga bisa dikirim.'
      );
    } else {
      try {
        MailApp.sendEmail({
          to: emailIka,
          subject: `[Donasi Masuk] ${donor.name} - ${rupiah(donor.amount)}`,
          htmlBody: templateIka(donor, orderId),
          name: 'Beasiswa Ikatan Alumni',
        });
        hasil.ke_ika = true;
      } catch (err) {
        console.error('Gagal kirim email IKA: ' + err);
      }
    }
  }

  if (CONFIG.SEND_DONOR_EMAIL && donor.email && isValidEmail(donor.email)) {
    try {
      MailApp.sendEmail({
        to: donor.email,
        subject: `Terima kasih, ${donor.name}! Donasi Anda sudah kami terima`,
        htmlBody: templateDonatur(donor, orderId),
        name: 'Beasiswa Ikatan Alumni',
        replyTo: emailIka || undefined,
      });
      hasil.ke_donatur = true;
    } catch (err) {
      console.error('Gagal kirim email donatur: ' + err);
    }
  }

  return hasil;
}

/**
 * Email tujuan notifikasi IKA.
 * Sengaja TIDAK memakai Session.getEffectiveUser() karena butuh scope
 * userinfo.email tambahan dan sering gagal di web app ("tidak memiliki izin").
 */
function ambilEmailIka() {
  return String(getProperty('EMAIL_IKA') || CONFIG.EMAIL_IKA || '').trim();
}

function templateIka(d, orderId) {
  return `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden">
    <div style="background:#0F172A;color:#fff;padding:20px 24px">
      <h2 style="margin:0;font-size:18px">Donasi Baru Diterima</h2>
      <p style="margin:6px 0 0;font-size:13px;opacity:.8">Beasiswa Ikatan Alumni</p>
    </div>
    <div style="padding:24px">
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        ${baris('Nama Donatur', d.name)}
        ${baris('Status Donatur', d.statusDonatur + (d.nim && d.nim !== '-' ? ` (NIM: ${d.nim})` : ''))}
        ${d.statusDonatur === 'Alumni' ? baris('Program Studi', d.prodi || '-') : ''}
        ${d.statusDonatur === 'Alumni' ? baris('Angkatan', d.angkatan || '-') : ''}
        ${baris('Nominal', `<b>${rupiah(d.amount)}</b>`)}
        ${baris('Metode', d.metode || `${d.bank} Virtual Account`)}
        ${baris('Nomor VA / Kode Bayar', d.vaNumber)}
        ${baris('Order ID', orderId)}
        ${baris('Email Donatur', d.email || '-')}
        ${baris('Pesan', d.note)}
        ${baris('Waktu', Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd MMM yyyy HH:mm') + ' WIB')}
      </table>
      <p style="margin-top:20px;font-size:12px;color:#6B7280">
        Data ini juga sudah tercatat otomatis di spreadsheet donasi.
      </p>
    </div>
  </div>`;
}

function templateDonatur(d, orderId) {
  return `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden">
    <div style="background:#0F172A;color:#fff;padding:24px">
      <h2 style="margin:0;font-size:20px">Terima kasih, ${escapeHtml(d.name)}!</h2>
      <p style="margin:8px 0 0;font-size:13px;opacity:.8">Donasi Anda untuk Beasiswa Ikatan Alumni sudah kami terima.</p>
    </div>
    <div style="padding:24px">
      <p style="font-size:14px;color:#374151;margin-top:0">
        Berikut rincian donasi Anda. Semoga menjadi amal jariyah yang bermanfaat.
      </p>
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        ${baris('Nominal', `<b>${rupiah(d.amount)}</b>`)}
        ${baris('Metode', d.metode || `${d.bank} Virtual Account`)}
        ${baris('Nomor VA / Kode Bayar', d.vaNumber)}
        ${baris('Order ID', orderId)}
        ${baris('Pesan Anda', d.note)}
        ${baris('Status', 'LUNAS / SUCCESS')}
      </table>
      <p style="margin-top:20px;font-size:12px;color:#6B7280">
        Email ini adalah bukti penerimaan donasi. Simpan untuk keperluan Anda.
      </p>
    </div>
    <div style="background:#F8F9FA;padding:14px 24px;font-size:11px;color:#9CA3AF">
      Beasiswa Ikatan Alumni
    </div>
  </div>`;
}

function baris(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#6B7280;width:130px;vertical-align:top">${label}</td>
    <td style="padding:8px 0;color:#111827">${value}</td>
  </tr>`;
}

/* ============================== UTILITAS ============================== */

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (CONFIG.SHEET_NAME) {
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (sheet) return sheet;
  }
  return ss.getActiveSheet();
}

function sudahTercatat(sheet, orderId) {
  const start = CONFIG.HAS_HEADER_ROW ? 2 : 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < start) return false;

  const ids = sheet.getRange(start, 2, lastRow - start + 1, 1).getValues();
  return ids.some((row) => String(row[0]).trim() === String(orderId).trim());
}

function verifySignature(data) {
  if (!CONFIG.VERIFY_SIGNATURE) return true;

  const secret = getProperty('MIDTRANS_SIGNATURE_KEY');
  if (!secret) {
    // Belum di-set -> jangan blokir notifikasi, tapi beri peringatan di log.
    console.warn('MIDTRANS_SIGNATURE_KEY belum di-set di Script Properties. Verifikasi dilewati.');
    return true;
  }
  if (!data.signature_key) return false;

  const raw = `${data.order_id}${data.status_code}${data.gross_amount}${secret}`;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_512, raw, Utilities.Charset.UTF_8)
    .map((b) => ('0' + (b & 0xff).toString(16)).slice(-2))
    .join('');

  const cocok = hash === String(data.signature_key).toLowerCase();
  if (!cocok) {
    console.warn(
      `Signature tidak cocok untuk ${data.order_id}. ` +
      `Cek Script Properties MIDTRANS_SIGNATURE_KEY (harus Signature Secret Key, bukan Server Key).`
    );
  }
  return cocok;
}

function getProperty(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function rupiah(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================== TES MANUAL ============================== */

/** Jalankan sekali dari editor untuk memberi izin kirim email + cek tampilan. */
function tesEmail() {
  const emailIka = ambilEmailIka();

  if (!emailIka) {
    console.warn('EMAIL_IKA kosong. Set dulu: Project Settings > Script Properties > EMAIL_IKA');
  }

  const contoh = {
    name: 'Rizkiana Pratama',
    email: emailIka || 'donatur@example.com',
    note: 'Semoga bermanfaat untuk adik-adik',
    bank: 'BNI',
    vaNumber: '9887175738226565',
    amount: 50000,
    statusDonatur: 'Alumni',
    nim: '2101234567',
    angkatan: '2021',
    prodi: 'PGSD',
  };

  const hasil = kirimNotifikasi(contoh, 'TES-' + Date.now());
  console.log('Hasil tes: ' + JSON.stringify(hasil));
  console.log('Email IKA tujuan: ' + (emailIka || '(belum di-set)'));
}

/** Jalankan untuk mengecek isi sheet & kolom yang dibaca script. */
function tesBacaSheet() {
  const sheet = getSheet();
  console.log('Sheet: ' + sheet.getName());
  console.log('Baris terakhir: ' + sheet.getLastRow());
  console.log('Kolom B (Order ID) terakhir: ' + sheet.getRange(Math.max(1, sheet.getLastRow()), 2).getValue());
}

/* ============================== VERIFIKASI ALUMNI ============================== */

/**
 * Mencari data alumni berdasarkan NIM di sheet "Master_Alumni".
 */
function cekNimAlumni(nimInput) {
  const nimTarget = String(nimInput || '').trim();
  if (!nimTarget) {
    return json({ status: 'error', message: 'NIM wajib diisi' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let masterSheet = ss.getSheetByName('Master_Alumni');

  // Fallback jika tab belum dibuat, kembalikan respon informatif
  if (!masterSheet) {
    return json({
      status: 'error',
      message: 'Sheet "Master_Alumni" belum dibuat di spreadsheet. Buat tab Master_Alumni dengan kolom: NIM, Nama, Prodi, Angkatan.',
    });
  }

  const values = masterSheet.getDataRange().getValues();
  // Baris 1: header (NIM, Nama, Prodi, Angkatan)
  for (let i = 1; i < values.length; i++) {
    const rowNim = String(values[i][0] || '').trim();
    if (rowNim === nimTarget) {
      return json({
        status: 'OK',
        found: true,
        data: {
          nim: rowNim,
          nama: String(values[i][1] || '').trim(),
          prodi: String(values[i][2] || '').trim(),
          angkatan: String(values[i][3] || '').trim(),
        },
      });
    }
  }

  return json({
    status: 'OK',
    found: false,
    message: 'NIM tidak ditemukan dalam data alumni.',
  });
}
