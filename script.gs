/**
 * WEBHOOK MIDTRANS -> GOOGLE SHEETS + EMAIL
 * Donasi Beasiswa IKA UPI
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
const SCRIPT_VERSION = '2026-11-11';

const CONFIG = {
  // Nama sheet. Kosongkan ('') untuk memakai sheet yang sedang aktif.
  SHEET_NAME: '',

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

    // 5) Tulis ke spreadsheet
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

  return json({
    status: 'OK',
    version: SCRIPT_VERSION,
    email_ika_terisi: Boolean(ambilEmailIka()),
    kirim_email_donatur: CONFIG.SEND_DONOR_EMAIL,
    kirim_email_ika: CONFIG.SEND_IKA_EMAIL,
    verifikasi_signature: CONFIG.VERIFY_SIGNATURE,
    message: 'Webhook donasi IKA UPI aktif',
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

  const values = sheet.getRange(mulai, 1, terakhir - mulai + 1, 9).getValues();
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
    };
  });

  // Terbaru di atas.
  data.reverse();

  return json({ status: 'OK', jumlah: data.length, data: data });
}

/* ============================== DATA DONATUR ============================== */

/**
 * PENTING: notifikasi Midtrans TIDAK mengirim customer_details.
 * Karena itu nama, email, dan pesan dikirim lewat custom_field1..3 dari server.js:
 *   custom_field1 = pesan/catatan
 *   custom_field2 = nama donatur
 *   custom_field3 = email donatur
 */
function ambilDataDonatur(data) {
  let name =
    data.custom_field2 ||
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
    (data.customer_details && data.customer_details.email) ||
    '';
  email = String(email).trim();

  let note = data.custom_field1 || data.donor_note || '';
  note = String(note).trim() || 'Donasi Beasiswa Alumni';

  let bank = 'BNI';
  let vaNumber = '-';

  if (Array.isArray(data.va_numbers) && data.va_numbers.length > 0) {
    bank = String(data.va_numbers[0].bank || 'BNI').toUpperCase();
    vaNumber = String(data.va_numbers[0].va_number || '-');
  } else if (data.permata_va_number) {
    bank = 'PERMATA';
    vaNumber = String(data.permata_va_number);
  } else if (data.bca_va_number) {
    bank = 'BCA';
    vaNumber = String(data.bca_va_number);
  } else if (data.bill_key && data.biller_code) {
    bank = 'MANDIRI';
    vaNumber = `${data.biller_code}${data.bill_key}`;
  }

  return {
    name,
    email,
    note,
    bank,
    vaNumber,
    amount: Number(data.gross_amount || data.amount || 0),
    paymentType: data.payment_type || 'bank_transfer',
    transactionTime: data.transaction_time || '',
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
          name: 'Donasi Beasiswa IKA UPI',
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
        name: 'Beasiswa IKA UPI',
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
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:#1d4ed8;color:#fff;padding:20px 24px">
      <h2 style="margin:0;font-size:18px">Donasi Baru Diterima</h2>
      <p style="margin:6px 0 0;font-size:13px;opacity:.9">Beasiswa IKA UPI</p>
    </div>
    <div style="padding:24px">
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        ${baris('Nama Donatur', d.name)}
        ${baris('Nominal', `<b>${rupiah(d.amount)}</b>`)}
        ${baris('Metode', `${d.bank} Virtual Account`)}
        ${baris('Nomor VA', d.vaNumber)}
        ${baris('Order ID', orderId)}
        ${baris('Email Donatur', d.email || '-')}
        ${baris('Pesan', d.note)}
        ${baris('Waktu', Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd MMM yyyy HH:mm') + ' WIB')}
      </table>
      <p style="margin-top:20px;font-size:12px;color:#64748b">
        Data ini juga sudah tercatat otomatis di spreadsheet donasi.
      </p>
    </div>
  </div>`;
}

function templateDonatur(d, orderId) {
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:#1d4ed8;color:#fff;padding:24px">
      <h2 style="margin:0;font-size:20px">Terima kasih, ${escapeHtml(d.name)}!</h2>
      <p style="margin:8px 0 0;font-size:13px;opacity:.9">Donasi Anda untuk Beasiswa IKA UPI sudah kami terima.</p>
    </div>
    <div style="padding:24px">
      <p style="font-size:14px;color:#334155;margin-top:0">
        Berikut rincian donasi Anda. Semoga menjadi amal jariyah yang bermanfaat.
      </p>
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        ${baris('Nominal', `<b>${rupiah(d.amount)}</b>`)}
        ${baris('Metode', `${d.bank} Virtual Account`)}
        ${baris('Nomor VA', d.vaNumber)}
        ${baris('Order ID', orderId)}
        ${baris('Pesan Anda', d.note)}
        ${baris('Status', 'LUNAS / SUCCESS')}
      </table>
      <p style="margin-top:20px;font-size:12px;color:#64748b">
        Email ini adalah bukti penerimaan donasi. Simpan untuk keperluan Anda.
      </p>
    </div>
    <div style="background:#f8fafc;padding:14px 24px;font-size:11px;color:#94a3b8">
      Beasiswa IKA UPI &middot; Universitas Pendidikan Indonesia
    </div>
  </div>`;
}

function baris(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#64748b;width:130px;vertical-align:top">${label}</td>
    <td style="padding:8px 0;color:#0f172a">${value}</td>
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
