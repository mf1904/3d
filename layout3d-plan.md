# layout3d — Perencanaan & Prompt untuk Claude Code

## Ringkasan proyek
Static-first web app untuk bikin layout 2D (denah/site plan) lalu di-extrude jadi model 3D, dan bisa diexport ke STL untuk 3D printer. Target awal: 2D layout + shapes umum (dinding, furniture, bangunan sederhana) + primitif 3D (termasuk bentuk atap/kubah) sehingga bisa dipakai bikin **miniatur bangunan** (rumah, pabrik, masjid, gudang, dll), bukan cuma flat floorplan.

Deploy target: ~~`layout3d.mfadhil.com`~~ → **`3d.dodaa.id`** (diubah 29 Agustus 2026), static frontend + backend kecil (Node/Express + PM2) buat auth & save/load project.

## Stack
- **2D canvas**: Konva.js atau Fabric.js (pilih salah satu — rekomendasi Konva.js karena lebih ringan untuk shape + transform + rotate)
- **3D**: Three.js (r128, sesuai constraint environment — hindari `CapsuleGeometry`, pakai `CylinderGeometry`/`SphereGeometry`/custom geometry)
- **Export**: `STLExporter` dari Three.js examples (client-side, tanpa backend)
- **Backend**: Express + PM2, database SQLite (project disimpan sebagai JSON, bukan render)
- **Reverse proxy**: reuse Caddy config yang sudah ada di VPS

## Data model (inti — desain ini dulu sebelum ngoding UI)
Setiap shape di layout adalah objek dengan struktur kira-kira:
```json
{
  "id": "shape_01",
  "type": "wall | box | cylinder | half-cylinder | dome | roof-gable | furniture:<name>",
  "x": 0, "y": 0,
  "width": 100, "depth": 100,
  "rotation": 0,
  "height": 250,
  "meta": { "material": "...", "label": "..." }
}
```
Project = `{ scale: {...}, unit: "cm", shapes: [...] }`. Ini yang disimpan ke backend sebagai JSON, dan yang di-render ulang di 2D canvas maupun 3D scene.

## Fitur yang perlu ditambahkan (revisi dari diskusi)

### 1. Sistem skala & koordinat
- User set skala project di awal (misal 1 unit canvas = 1 cm atau 1 m), disimpan di `project.scale`
- Tampilkan grid dengan label ukuran real (bukan cuma px) — grid line tiap 1m/1cm sesuai skala
- Panel properti tiap shape tampilkan ukuran dalam satuan real (cm/m), bukan pixel — konversi otomatis pakai `project.scale`
- Opsional: input field "ganti skala" yang recalculate semua shape secara proporsional

### 2. Zoom in/out (statis & ringan)
- **Jangan** pakai continuous pinch-zoom kompleks — cukup tombol +/- dengan step tetap (misal 50%, 75%, 100%, 150%, 200%) atau scroll wheel dengan step diskrit
- Implementasi: scale transform di container canvas (`stage.scale()` kalau Konva), bukan re-render ulang semua shape — supaya ringan
- Persist zoom level per sesi (tidak perlu disimpan ke backend)

### 3. Shape library 2D — diperbanyak
Kelompokkan by kategori supaya gampang nambah nanti:
- **Struktur**: dinding lurus, dinding sudut, pintu, jendela, kolom/tiang
- **Bangunan umum (shape dasar)**: persegi (ruangan), lingkaran (tandon/silo), poligon custom
- **Furniture umum**: meja, kursi, lemari, tempat tidur (untuk kasus denah interior)
- Sistem harus mudah ditambah shape baru — desain shape library sebagai array of config `{type, icon, defaultWidth, defaultDepth}`, bukan hardcode per komponen

### 4. Rotasi / sudut bebas (non-parallel)
- Setiap shape punya properti `rotation` (derajat, bebas 0-360, bukan cuma 90-an)
- Di 2D editor: rotate handle di corner shape (drag buat rotate manual) + input angka derajat di panel properti buat presisi
- Optional snap-to-angle (misal tiap 15°) yang bisa di-toggle on/off — biar tetap bisa freeform kalau 2 gedung memang tidak sejajar
- Rotation ini harus terbawa konsisten ke 3D extrude (shape yang miring di 2D, extrude-nya juga miring, bukan lurus ulang)

### 5. Primitif 3D diperluas (fokus: elemen atap & miniatur bangunan)
Selain box (extrude standar), tambahkan:
- **Half-cylinder** (untuk atap gudang/quonset hut) — `CylinderGeometry` dipotong setengah (thetaLength = Math.PI)
- **Gable roof** (atap pelana, segitiga standar rumah) — custom geometry dari 2 triangle + 2 trapezoid
- **Dome / half-sphere** (kubah masjid) — `SphereGeometry` dengan `phiLength`/setengah, di-scale sesuai lebar dasar
- **Cone** (menara/puncak) — `ConeGeometry`, berguna buat elemen menara masjid
- Semua primitif ini ditempatkan **di atas** hasil extrude dinding (bukan menggantikan), jadi alurnya: gambar denah dasar (dinding) → extrude jadi badan bangunan → tambahkan elemen atap dari primitive library di atasnya, posisi & ukuran menyesuaikan bounding box badan bangunan

### 6. Konsep "miniatur builder"
- Reframe UX: bukan cuma "floorplan editor" tapi "site + building miniature builder"
- Alur: layout site (posisi tiap bangunan + rotasi, karena antar-gedung bisa tidak sejajar) → tiap bangunan dikembangkan sendiri (badan + atap) → gabung jadi satu scene 3D → export STL (per-bangunan atau keseluruhan site)
- Untuk MVP, cukup sediakan preset kombinasi: "rumah" (box + gable roof), "gudang" (box + half-cylinder), "masjid" (box + dome + cone kecil di atasnya) — biar user tinggal pilih preset lalu adjust ukuran

### 7. Polygon land tool (bidang tanah tidak beraturan)
Kasus nyata: bidang tanah sering segi-4+ dengan sisi tidak sejajar/tidak siku, dan user biasanya punya data ukuran per sisi dari sertifikat/BPN (bukan cuma gambar visual).
- Tool freeform polygon — user klik titik-titik di canvas buat bikin outline tanah, tiap vertex bisa digeser individual setelah dibuat
- Tiap sisi tampilkan panjang & sudut real-time saat digambar, dan bisa diedit manual via input angka per sisi (bukan cuma drag) — supaya cocok dengan data ukur resmi
- Auto-hitung luas tanah dari polygon (shoelace formula)
- Bidang tanah adalah **layer terpisah** (`type: "land-boundary"`), beda dari layer shape bangunan — bangunan digambar di dalam boundary ini
- Opsional (v2): validasi visual kalau ada shape bangunan yang keluar dari boundary tanah

### 8. Mode "design challenge" / kompetisi desain
Konsep: admin bikin project template (polygon tanah + constraint), publish jadi challenge, peserta desain di dalamnya pakai layout3d, lalu submit.
- **Template project**: admin set polygon tanah (pakai tool di poin 7) + constraint tambahan — orientasi utara, KDB/luas bangunan maksimal, jumlah lantai maksimal, opsional budget cap
- **Submission**: peserta fork/duplicate template, desain site plan + denah tiap lantai di dalam boundary, lalu submit — format submission = project JSON yang sudah ada (tidak perlu format terpisah)
- **Gallery/listing**: halaman publik buat browse semua submission per challenge
- **Judging (v2, belum MVP)**: kombinasi kriteria (fungsi/tata ruang, efisiensi lahan, estetika, kepatuhan ke brief), opsional anonim saat judging (sembunyikan nama peserta), opsional fase voting publik terpisah dari juri profesional
- MVP scope: cukup "template + submission gallery" dulu, scoring/voting menyusul

## Yang perlu didefinisikan user sebelum coding (checklist buat Claude Code tanya balik kalau belum jelas)
- Satuan default: cm atau meter?
- Apakah snap-to-angle default on atau off?
- STL export per-shape/per-bangunan, atau selalu export keseluruhan scene jadi satu file?
- Auth dulu atau localStorage-only untuk MVP (sebelum backend save jalan)?
- Mode challenge/kompetisi ini prioritas MVP juga, atau fitur v2 setelah core editor stabil?

## Urutan build yang disarankan
1. 2D canvas dasar: shape dasar (box, circle) + drag/resize/rotate + panel properti (termasuk skala & zoom)
2. Extrude sederhana: box 2D → box 3D (dinding lurus dulu, belum ada atap)
3. Tambah primitif atap (half-cylinder, gable, dome, cone) sebagai layer terpisah di atas badan
4. STL export dari scene 3D
5. Shape library diperluas + preset miniatur (rumah/gudang/masjid)
6. Polygon land tool (boundary tanah tidak beraturan + input ukuran per sisi)
7. Backend save/load (auth + SQLite JSON storage)
8. Mode design challenge (template, submission, gallery) — setelah core editor + backend save stabil

---

## Status implementasi (28 Agustus 2026)

Tahap 1–5 dari "Urutan build yang disarankan" **sudah jalan**; tahap 6 (backend) belum.
Detail teknis ada di `README.md`.

Jawaban checklist dari user:

- Satuan default **meter**, dengan opsi ganti ke cm/mm (ukuran fisik dipertahankan)
- Snap-to-angle **default OFF**, bisa dinyalakan (5/15/30/45/90°)
- STL export **dua-duanya**: per-seleksi dan seluruh scene
- MVP pakai **localStorage + import/export JSON**, backend menyusul

Yang sudah selesai:

1. Kanvas 2D: 28 tipe shape, drag/resize/rotate bebas, multi-select + rubber band,
   grid adaptif berlabel ukuran nyata, zoom step diskrit, panel properti, undo/redo
2. Extrude 2D → 3D live, rotasi terbawa konsisten
3. Primitif atap: pelana, lengkung (quonset), miring, limas, piramida, kubah, kerucut —
   auto-pasang di atas shape terpilih dengan overstek 5%
4. Export STL biner (mm, Z-up, alas di Z=0) dengan skala cetak 1:1 s/d 1:500;
   semua 28 tipe shape sudah diverifikasi watertight
5. Preset miniatur: Rumah, Gudang, Masjid, Silo/Tandon, Ruko 2 Lantai

Yang belum (dan kenapa):

- **Tahap 6 — backend save/load** (Express + SQLite + auth). Format JSON-nya sudah
  final, backend nanti tinggal menyimpan blob yang sama
- **Pintu/jendela belum melubangi dinding** — masih panel tempel, bukan boolean
  subtract. Butuh library CSG; di luar cakupan "static-first tanpa dependensi berat"
- **Poligon belum bisa digambar titik-per-titik** — baru bentuk preset yang bisa diskalakan

### Tambahan setelah review user

**Rotasi 3 sumbu.** Sebelumnya cuma yaw (putar di denah), jadi silinder tidak
berubah apa pun saat diputar. Sekarang ada `tiltX` + `tiltZ`, sehingga silinder
bisa ditidurkan jadi rotary kiln/dryer pabrik. Urutan Euler `YXZ`
(`Ryaw · RtiltX · RtiltZ`) dipilih supaya "tidurkan dulu, lalu putar arahnya di
denah" bekerja intuitif. Denah 2D ikut menampilkan proyeksi objek miring — rotary
Ø2,4 m panjang 14 m tampil sebagai persegi 2,4 × 14 m, bukan lingkaran 2,4 m.
Konsekuensi yang disengaja: objek miring tidak bisa di-resize dari kanvas
(proyeksinya ambigu); ukurannya diedit lewat panel properti.

**Toggle visibilitas.** Ikon mata di tiap baris panel Objek (plus shortcut `H`).
Objek tersembunyi hilang dari 2D & 3D, tidak bisa dipilih, dan tidak ikut export
STL. Beda dengan centang "Sertakan di export STL" yang tetap menampilkan objek
tapi mengeluarkannya dari file cetak.

**Kategori "Mesin & Pabrik"** ditambahkan ke library (Mesin, Rotary, Konveyor,
Tangki, Hopper, Panel) — target pemakaian user memang layout pabrik.

### Putaran review kedua

**Geometri per objek, bukan kotak generik.** Sebelumnya hopper dan pohon sama-sama
kerucut polos, dan sebagian besar objek cuma balok beda dimensi. Sekarang 17 tipe
dirakit dari beberapa bagian (bagian OBJEK KOMPOSIT di `js/geometry.js`): pohon =
batang + tajuk; hopper = kerah + corong + pipa keluaran; rotary = cangkang +
riding ring + gigi penggerak; konveyor = rangka + sabuk + rol + kaki; tangki =
kaki + badan + tutup kubah; mobil = bodi + kabin + 4 roda; meja/kursi/sofa/lemari/
kasur dengan kaki, sandaran, gagang. Semua tetap watertight (34/34 tipe, 0 edge
terbuka) dan tiap bagian dijaga tidak keluar dari kotak nominal w×h×d supaya
footprint denah tetap jujur.

**Grup bisa dilepas & dibentuk.** Sebelumnya preset lahir sebagai grup tapi tidak
ada jalan untuk melepas atau menggabung manual. Sekarang: tombol Gabung/Lepas di
panel Properti, `Ctrl+G` / `Ctrl+Shift+G`, dan `Alt`+klik untuk memilih satu
anggota saja. Menggabung dua grup melebur keduanya (anggota lama ikut terbawa).

**Pembatas panel bisa digeser** (klik ganda = sama rata, lebarnya diingat), dan
panel 3D bisa disembunyikan lewat tombol di pembatas atau tombol `1`/`2`/`3` —
kontrol 2D/Split/3D di toolbar ternyata kurang kelihatan.

### Pintu & jendela melubangi dinding

Dulu dicatat "butuh library CSG". Ternyata tidak: dinding dipotong jadi kolom
pada setiap tepi lubang, lalu tiap kolom diisi balok di atas & bawah lubangnya —
dekomposisi persegi yang eksak, tanpa dependensi baru, dan tiap potongan tetap
solid tertutup sehingga STL aman. Volume yang hilang persis lebar × tinggi ×
tebal dinding (diverifikasi lewat perhitungan volume mesh).

Ruangan diuraikan jadi 4 segmen dinding lewat `Shapes.wallSegments()`, yang juga
dipakai builder 3D-nya — jadi penghitung lubang dan pembangun geometri tidak
mungkin beda tafsir. Bukaan bisa ditaruh di sisi mana pun, tetap benar walau
ruangannya diputar.

Checkbox baru "Lubangi dinding" (`meta.cut`) untuk mematikannya per objek.
Kombinasi cut ✓ + "Sertakan di export STL" ✗ menghasilkan doorway (lubang kosong
di model cetak).

Batasan yang disengaja: bukaan/dinding yang dimiringkan dilewati, dan `Massa Box`
tidak bisa dilubangi (massa padat — lubangnya akan jadi terowongan).

Sisa yang belum: tahap 6 backend.

### Poligon gambar bebas

Mode gambar titik-per-titik (item **Poligon ✎** di Library atau tombol `P`):
klik menambah titik, `Shift` mengunci arah kelipatan 45°, `Backspace` membatalkan
satu titik, selesai lewat klik titik awal / klik-ganda / `Enter`, `Esc` batal.
Ditambah mode **Edit Titik** untuk poligon yang sudah jadi — geser titik, klik
tengah sisi untuk menyisipkan, Alt+klik untuk menghapus.

Detail yang perlu diingat: menggeser titik menghitung ulang kotak pembatas, lalu
pergeseran pusatnya dikembalikan ke x/y dunia supaya rotasi shape tidak hilang
(`Shapes.polygonPatchFromLocal`).

Bug yang ketemu saat pengujian: Konva memicu `dblclick` murni berdasarkan jeda
waktu, jadi mengklik dua titik dengan cepat tanpa sengaja menutup poligon.
Diperbaiki dengan hanya mengakhiri lewat klik-ganda kalau klik keduanya memang
menimpa titik terakhir (klik di tempat yang sama ditolak sebagai titik baru dan
menandai `dupClick`).

Poligon yang sisinya saling menyilang dideteksi dan diperingatkan — bentuk
seperti itu tidak bisa diekstrusi jadi mesh tertutup.

Dengan ini semua item di "Urutan build yang disarankan" tahap 1–5 tuntas.
Sisa: tahap 6 (backend Express + SQLite + auth).

### Persiapan deploy ke 3d.dodaa.id

Target deploy diubah dari `layout3d.mfadhil.com` ke **`3d.dodaa.id`**.

Audit path: tidak ada satu pun path absolut di seluruh sumber — semua `href`/`src`
relatif. Diuji dengan menyajikan aplikasi dari `/3D/sub/` dan hasilnya identik
dengan di root, jadi aplikasi ini portabel ke root domain maupun sub-folder.

Konva & Three.js sekarang **di-vendor lokal** di `vendor/`, tidak lagi dari CDN.
Alasannya bukan sekadar kecepatan: aplikasi ini dipakai untuk layout pabrik, dan
jaringan pabrik sering dibatasi atau tanpa internet. Setelah diubah, halaman
tercatat nol permintaan ke luar origin.

Paket siap unggah dibuat & diverifikasi dengan cara diekstrak ke folder kosong
lalu disajikan seperti server produksi (bukan sekadar di-zip): index.html + css/
+ js/ + vendor/, 256 KB.

### Tahap 6 — backend save/load (SELESAI)

Express + penyimpanan file JSON + password tunggal, sesuai jawaban user: VPS
Node, dipakai sendiri. Ada di `server/`, dokumentasi lengkap di
`server/README.md`.

Keputusan desain yang perlu dicatat:

- **Satu proses menyajikan aplikasi + API.** Frontend dan API jadi satu origin,
  jadi tidak perlu CORS dan cookie sesi jalan apa adanya. Caddy tinggal
  mem-proxy ke `127.0.0.1:8130`.
- **Hanya `/`, `/css`, `/js`, `/vendor` yang disajikan**, bukan seluruh folder
  project — kalau tidak, `server/data/layout3d.db` ikut terekspos. Sudah diuji:
  akses langsung ke `server/*` dan percobaan path traversal semuanya 404.
- **Backend bersifat opsional.** Frontend probe `GET api/me` saat mulai; kalau
  gagal, semua tombol server disembunyikan dan aplikasi tetap penuh fungsi
  dengan localStorage. Deploy statis murni tetap sah — sudah diuji terpisah.
- **Nama project unik**, menyimpan dengan nama sama = menimpa. Ini mencerminkan
  arti tombol Simpan bagi user, bukan bikin duplikat diam-diam.
- Password disimpan sebagai hash scrypt bersalt; token sesi disimpan dalam
  bentuk hash juga; login dibatasi 10 percobaan / 15 menit per IP.

**Menyimpang dari rencana: bukan SQLite.** `better-sqlite3` butuh modul native.
Saat diuji instalasi dari paket bersih, `npm install` gagal karena tidak ada
prebuild untuk versi Node yang dipakai lalu jatuh ke kompilasi C++ — artinya VPS
wajib punya toolchain build. Itu jadi satu-satunya titik rapuh di proyek yang
selebihnya tanpa build step. Diganti penyimpanan file JSON: nol dependensi
native, tulis atomik (file sementara + rename), data terbaca mata telanjang, dan
isi tiap project identik dengan file Export JSON sehingga bisa langsung
di-Import lewat browser.

Bug yang ketemu setelah penggantian: hash password sempat di-cache di memori,
padahal `set-password` jalan di proses terpisah — server di bawah PM2 tidak akan
pernah melihat password baru sampai di-restart. Sekarang meta dibaca dari disk
tiap kali dipakai.

Dengan ini **seluruh tahap 1–6 di rencana awal tuntas.**

### Putaran ketiga: dua dari tiga batasan diperbaiki

**Massa Box sekarang bisa dilubangi (ceruk, bukan terowongan).** Dulu pintu/
jendela pada Massa Box dilewati total — melubangi penuh ketebalan (bisa 6 m+)
berarti menerowong seluruh bangunan. Perbaikannya: dispatch geometri diubah
dari cek string `geo` ke flag `host`/`shallowHost` di SHAPE_DEFS (menghindari
tabrakan dengan tipe lain yang kebetulan berbagi `geo:'box'`, mis. column-sq,
slab). Host bertanda `shallowHost` memotong ceruk setebal bukaannya sendiri,
tepat di posisi bukaan ditaruh (`acrossOffset`), bukan menembus penuh; sisi
lain massa tetap solid. Diverifikasi lewat perhitungan volume: box 8×6×3=144 m³
dikurangi pintu 1×2.2×0.14 m persis 0,308 m³ hilang — bukan menerowong 6 m.
Dinding/Ruangan TIDAK berubah sama sekali (regresi 0,378 m³ tetap persis sama).

**Poligon menyilang: tombol Perbaiki Otomatis.** Mengurutkan ulang titik yang
sama berdasarkan sudut terhadap pusat (asumsi star-shaped). Sengaja opt-in
(tombol), bukan otomatis saat menggambar, karena hasilnya bisa jadi bentuk
yang cukup berbeda dari sketsa awal — mengubah bentuk tanpa sepengetahuan user
terasa salah. Kalau gagal (poligon punya lekukan tersembunyi dari pusat),
`autoFixPolygon` kembalikan `null`, bukan memaksakan hasil yang masih menyilang.

**Bukaan pada dinding miring TETAP jadi batasan** — bukan belum sempat, tapi
keterbatasan model yang disengaja: sistem dinding di sini murni 2D-footprint-
diekstrusi-vertikal, dan begitu dinding miring, konsep "atas" baginya bukan
lagi sumbu Y dunia — seluruh model 2D-nya tidak berlaku lagi. Mendukungnya
butuh solid modeling 3D penuh (CSG), yang sengaja dihindari di seluruh proyek
supaya tetap tanpa build step. Pertimbangan: dinding memang jarang dimiringkan
dalam praktik nyata.

Dengan ini 2 dari 3 batasan minor sudah selesai; sisanya didokumentasikan
sebagai batasan model, bukan bug.

### Rotasi grup: dari 1 sumbu jadi rigid-body 3D penuh

User menyadari: objek yang sudah digabung (grup) cuma bisa diputar 1 arah
(yaw, lewat handle di kanvas) — tiltX/tiltZ hanya ada di panel properti yang
cuma muncul untuk seleksi tunggal.

Ditambahkan panel "Rotasi & Kemiringan (grup)" untuk multi-select, dengan
tombol Tidurkan Grup / Berdiri Tegak / Ke Lantai. Implementasinya rotasi rigid
3×3 penuh (`Shapes.composeRotation`/`decomposeRotation`/`applyRigidDelta`,
matriks manual tanpa dependensi Three.js — konsisten dengan gaya `planExtents`
yang sudah ada) — posisi tiap anggota ikut berputar terhadap pivot bersama,
bukan cuma orientasinya di tempat.

Bug yang ketemu lewat verifikasi visual (bukan tes otomatis): rancangan awal
"Berdiri Tegak" cuma me-reset tiltX/tiltZ tiap anggota ke 0 DI TEMPATNYA
masing-masing. Setelah Tidurkan Grup memindahkan posisi tiap anggota, reset
begitu saja meninggalkan mereka di posisi barunya yang sudah tidak selaras —
rumah yang ditidurkan lalu "ditegakkan" hasilnya atap dan badan terpisah,
bukan berdiri rapi lagi. Screenshot menunjukkan ini jelas padahal test numerik
individual (tiltX kembali 0) tetap lolos — kasus di mana verifikasi visual
menangkap yang tes numerik lewatkan.

Diperbaiki: Berdiri Tegak sekarang juga rotasi rigid (kebalikan dari
kemiringan sekarang, dihitung dari anggota pertama sebagai acuan), bukan reset
per-objek. Diverifikasi: siklus Tidurkan→Berdiri Tegak mengembalikan posisi
relatif antar anggota persis sama (delta <1e-3), dan grup yang sudah tegak
diberi "Berdiri Tegak" hasilnya idempoten (tidak berubah sama sekali).

---

## Status poin 7 & 8 (ditambahkan 2 September 2026)

### Poin 7 — Polygon land tool: SEBAGIAN sudah ada

Yang **sudah jalan** (dibangun waktu mengerjakan "poligon gambar bebas"):

- Tool freeform: klik titik-per-titik di kanvas, Shift mengunci arah kelipatan
  45°, Backspace batal satu titik, Enter/klik titik awal untuk menutup
- Edit vertex setelah jadi: geser titik, sisip titik di tengah sisi, Alt+klik
  untuk hapus
- Shoelace sudah ada di `Shapes.signedArea()` — tapi baru dipakai internal
  untuk menolak poligon tanpa luas, **belum ditampilkan ke user**
- Deteksi sisi saling menyilang + tombol perbaiki otomatis

Yang **belum**:

- Panjang & sudut tiap sisi tampil real-time saat menggambar
- Edit ukuran per sisi lewat input angka (ini yang bikin cocok dengan data
  sertifikat/BPN — sekarang cuma bisa geser titik, tidak bisa ketik "sisi ini
  12,4 m")
- Luas tanah ditampilkan di panel
- Tipe `land-boundary` sebagai layer tersendiri — sekarang poligon masih shape
  biasa yang ikut ter-extrude jadi massa 3D, bukan bidang tanah datar
- Validasi bangunan keluar boundary (memang ditandai v2 di rencana)

### Poin 8 — Design challenge: BELUM dimulai

Satu hal yang perlu diputuskan sebelum ini dikerjakan: **arsitektur auth-nya
bertabrakan dengan keputusan yang sudah diambil.** Backend sekarang sengaja
dibuat satu-password-untuk-satu-orang (jawaban "dipakai sendiri saja"), tanpa
tabel user, tanpa registrasi.

Mode challenge butuh yang sebaliknya: banyak peserta, masing-masing punya akun
dan hanya boleh menyunting submission miliknya sendiri, plus peran admin dan
(nanti) juri. Itu bukan penambahan kecil di atas yang ada — itu mengganti
fondasi autentikasinya, dan menyeret konsekuensi lain: registrasi, reset
password, moderasi, dan gallery publik yang bisa diakses tanpa login.

Jadi poin 8 realistis dikerjakan sebagai fase tersendiri, bukan tempelan.
