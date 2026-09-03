# layout3d

Editor denah 2D → model 3D → export STL untuk 3D printer.
**Live di https://3d.dodaa.id.**

Static-first: aplikasinya tetap berfungsi penuh tanpa backend sama sekali
(cukup buka `index.html` lewat web server statis). Backend save/load bersifat
opsional — kalau ada, tombol server muncul sendiri; kalau tidak, disembunyikan.

Diarahkan sebagai **site & building miniature builder**, bukan sekadar floorplan editor:
gambar denah/site di 2D → tiap massa bangunan langsung ter-extrude jadi badan 3D →
tumpuk elemen atap (pelana, lengkung, limas, kubah, kerucut) di atasnya → export STL.

---

## Jalankan

Butuh web server statis (jangan `file://` — path relatif dan CDN bisa bermasalah):

```bash
python -m http.server 5173
```

Lalu buka `http://localhost:5173`.

Dependensi hanya dua, dan keduanya **di-vendor lokal** di folder `vendor/`:

- **Konva.js 9** (`vendor/konva.min.js`) — kanvas 2D (drag / resize / rotate)
- **Three.js r128** (`vendor/three.min.js`) — scene 3D

Aplikasi tidak menembak CDN sama sekali saat dijalankan — nol permintaan ke
luar, jadi tetap jalan di jaringan pabrik yang dibatasi atau sepenuhnya offline.

Tidak ada build step, tidak ada bundler, tidak ada `node_modules`.

---

## Keputusan yang sudah dikunci

| Hal | Keputusan |
|---|---|
| Satuan default | **meter**, bisa diganti ke cm / mm lewat dropdown (ukuran fisik dipertahankan) |
| Snap sudut | **default OFF**, bisa dinyalakan + pilih kelipatan 5/15/30/45/90° |
| Export STL | **dua-duanya** — `STL Terpilih` (per bangunan) dan `STL Semua` (seluruh scene) |
| Penyimpanan | **localStorage** (selalu) + **server opsional** (Express + file JSON, satu password) + import/export `.json` |

---

## Struktur

```
index.html            shell UI (toolbar, panel, dua pane kanvas)
css/style.css
js/units.js           konversi satuan, langkah grid adaptif, step zoom
js/shapes.js          SHAPE_DEFS + LIBRARY + PRESETS  ← tempat nambah shape baru
js/project.js         state, undo/redo, seleksi, serialisasi, localStorage
js/geometry.js        builder geometri 3D per tipe shape
js/stl.js             encoder STL biner/ASCII + konversi sumbu & skala cetak
js/editor2d.js        kanvas denah (Konva)
js/viewer3d.js        scene 3D (Three.js) + orbit control buatan sendiri
js/ui.js              panel properti, library, layer, toolbar, shortcut
js/api.js             klien penyimpanan server (opsional)
js/app.js             bootstrap
vendor/               konva.min.js + three.min.js (di-vendor, bukan CDN)
server/               backend save/load — lihat server/README.md
```

---

## Model data

Satu shape:

```json
{
  "id": "sn33sn4qw0m",
  "type": "m-rotary",
  "x": -6, "y": -5,
  "width": 2.4, "depth": 2.4,
  "rotation": 0,
  "tiltX": 90,
  "tiltZ": 0,
  "height": 14,
  "elevation": 1.2,
  "meta": {
    "label": "Rotary Kiln",
    "color": "#7f8b98",
    "solid": true,
    "locked": false,
    "visible": true,
    "group": "sn33snanb8z",
    "thickness": 0.15
  }
}
```

Project = isi file `.json` yang bisa di-export/import:

```json
{
  "version": 1,
  "name": "Untitled",
  "scale": { "unit": "m", "pxPerMeter": 40 },
  "grid": { "show": true, "snap": false },
  "snapAngle": { "on": false, "step": 15 },
  "shapes": []
}
```

Catatan penting:

- Angka shape disimpan dalam **satuan project**, bukan pixel. Ganti satuan =
  angka dikonversi (8 m → 800 cm), ukuran fisik tetap. Menu **Skala…** beda:
  itu mengubah ukuran fisik secara proporsional.
- `elevation` = ketinggian alas. Semua geometri dibangun dengan alas di y=0,
  jadi menumpuk atap di atas badan cukup `elevation = badan.elevation + badan.height`.
- `points` (khusus tipe berdenah poligon) ternormalisasi −0.5..0.5, diskalakan
  oleh `width`/`depth` — jadi poligon ikut ter-resize.

### Pemetaan 2D → 3D

| 2D | 3D |
|---|---|
| `x` | `three.x` |
| `y` | `three.z` |
| `elevation` | `three.y` |
| `rotation` (yaw, derajat, searah jarum jam) | `mesh.rotation.y = -rad` |
| `tiltX` | `mesh.rotation.x` |
| `tiltZ` | `mesh.rotation.z` |

Rotasi bebas 0–360° dan konsisten terbawa ke 3D — dua gedung yang tidak sejajar
di denah tetap tidak sejajar di model.

---

## Rotasi 3 sumbu & objek rebah

Tiga sudut, semuanya bebas (bukan kelipatan 90°):

- **`rotation` (yaw)** — putar di denah, sumbu vertikal. Ini yang dipakai untuk
  gedung/mesin yang tidak sejajar sumbu.
- **`tiltX`** — rebahkan depan–belakang. `tiltX = 90` membuat silinder tegak jadi
  **tidur** → itulah cara bikin rotary kiln / rotary dryer.
- **`tiltZ`** — rebahkan kiri–kanan.

Urutannya `Euler 'YXZ'` = `Ryaw · RtiltX · RtiltZ`: kemiringan bekerja di frame
lokal objek, yaw diterapkan terakhir di frame dunia. Jadi "tidurkan dulu, baru
putar arahnya di denah" berperilaku persis seperti yang diharapkan.

**Titik jangkar** (`x`, `y`, `elevation`) = tengah alas objek *sebelum*
dimiringkan. Karena itu tersedia tiga tombol di panel properti:

| Tombol | Yang dilakukan |
|---|---|
| **Tidurkan** | `tiltX = 90`, elevasi ikut disesuaikan supaya titik terendah objek tidak berubah |
| **Tegakkan** | reset `tiltX`/`tiltZ` ke 0, elevasi disesuaikan dengan cara yang sama |
| **Ke Lantai** | setel elevasi supaya dasar objek persis menyentuh lantai (y = 0) |

### Menidurkan sekelompok objek (grup / multi-select)

Rotasi `tiltX`/`tiltZ` di panel properti hanya muncul untuk **satu** objek
terpilih. Pilih ≥2 objek (atau satu grup) dan panel Properti menampilkan bagian
terpisah **"Rotasi & Kemiringan (grup)"** dengan tiga tombol:

| Tombol | Yang terjadi |
|---|---|
| **Tidurkan Grup** | seluruh seleksi diputar 90° **sebagai satu benda kaku** terhadap titik pusatnya — posisi tiap anggota ikut berubah, bukan cuma orientasinya, sehingga susunan relatif antar bagian (mis. atap tetap menempel di ujung badan) terjaga persis |
| **Berdiri Tegak** | kebalikan rigid dari kemiringan sekarang — mengembalikan grup ke susunan semula, bukan mereset tiap anggota di tempatnya (itu justru akan mencerai-beraikan susunan yang sudah digeser Tidurkan Grup) |
| **Ke Lantai** | menggeser seluruh grup naik/turun **bersama** (jarak vertikal antar anggota tidak berubah) supaya titik terendahnya menyentuh lantai |

Bedanya dengan tombol serupa di panel objek tunggal: yang di sana cuma mengubah
`tiltX`/`tiltZ` objek itu sendiri di tempatnya. Untuk grup, "tempat" tiap
anggota justru yang harus ikut berubah — kalau tidak, badan rumah dan atapnya
akan terpisah begitu ditidurkan.

Secara matematis, ini rotasi rigid penuh 3×3 (bukan cuma `tiltX`/`tiltZ` per
objek): posisi tiap anggota diputar terhadap pivot bersama, lalu orientasinya
sendiri (yaw + tiltX + tiltZ, yang sudah ada sebelumnya) digabung dengan rotasi
tambahan itu. Diverifikasi: jarak antar pusat dua objek yang digrup tetap
persis sama sebelum/sesudah Tidurkan Grup, dan siklus Tidurkan → Berdiri Tegak
mengembalikan susunan ke posisi semula sampai presisi milimeter.

### Bagaimana objek miring digambar di denah

Denah 2D menampilkan **proyeksi** kotak pembatas objek yang sudah dimiringkan,
bukan `width × depth` mentahnya. Silinder Ø2,4 m tinggi 14 m yang ditidurkan
tampil di denah sebagai persegi panjang **2,4 × 14 m** — luasan lantai yang
benar-benar dipakai. Matematikanya ada di `Shapes.planExtents()`, dan sengaja
memisahkan bagian tilt dari yaw supaya denahnya tetap persegi ber-rotasi
(bukan AABB kasar yang membengkak saat objek diputar).

Konsekuensinya: **objek yang miring tidak bisa di-resize dari kanvas** —
menskalakan proyeksi tidak menentukan `width`/`depth`/`height` secara unik.
Geser dan putar tetap bisa; ukuran diedit lewat panel properti. Objek tegak
(`tiltX = tiltZ = 0`) tidak terpengaruh sama sekali.

---

## Bidang tanah & ukuran per sisi

Tipe **Bidang Tanah** (kategori *Tanah*) adalah poligon untuk batas lahan.
Bedanya dari poligon biasa: datar (tebal 5 cm, sekadar supaya mesh-nya tetap
tertutup), otomatis ditaruh paling belakang, dan **default tidak ikut export
STL** — ini layer referensi, bukan massa yang dicetak.

### Menggambar sesuai angka, bukan kira-kira

Data tanah biasanya datang sebagai angka per sisi dari sertifikat/BPN, bukan
gambar. Karena itu ada dua jalur:

- **Saat menggambar**: panjang tiap sisi dan sudut di tiap titik tampil
  langsung di kanvas, termasuk sisi yang sedang ditarik kursor — jadi
  panjangnya kelihatan *sebelum* titiknya ditaruh.
- **Setelah jadi**: panel Properti punya tabel **Ukuran per sisi**. Ketik
  panjang atau sudutnya, bentuknya menyesuaikan.

Panel juga menampilkan **luas** (shoelace) dan **keliling**, ikut satuan project.

### Aturan saat sebuah sisi diubah

Poligon harus tetap tertutup, jadi mengubah satu sisi pasti menggeser sesuatu.
Aturannya model rantai: **titik sebelum sisi itu terkunci, titik sesudahnya
bergeser**, dan sisi penutup yang menyerap perubahannya.

Konsekuensinya sisi yang sudah diisi sebelumnya tidak pernah terganggu — cocok
dengan cara orang memasukkan data ukur: sisi 1, sisi 2, sisi 3…, dan sisi
terakhir yang menutup bidang.

Karena itu pula **sisi terakhir dan sudut di kedua ujung rantai terkunci** di
tabel (ditampilkan, tapi tidak bisa diketik): nilainya ditentukan oleh sisi-sisi
lain. Memaksa mengubahnya akan merusak angka yang sudah benar — pada sudut
ujung, memutar rantai justru menggerakkan kedua sisinya bersamaan sehingga
sudutnya tidak berubah sama sekali.

### Validasi batas

Objek yang keluar dari bidang tanah ditandai otomatis: garis putus-putus
**oranye** kalau menumpang batas, **merah** kalau seluruhnya di luar. Status bar
menampilkan jumlahnya — klik untuk langsung memilih objek yang bermasalah.

Sekadar ditandai, **tidak diblokir**. Bidang tanah sering dipakai sebagai acuan
sementara, dan menolak penempatan justru menghalangi saat orang memang sedang
menata kasar dulu.

Cek sudut saja tidak cukup: pada tanah cekung, keempat sudut sebuah bangunan
bisa berada di dalam sementara sisinya tetap memotong batas. Jadi perpotongan
sisi ikut diperiksa.

---

## Membaca koordinat

Dua tempat sekaligus:

- **Menempel di kursor** — kotak kecil mengikuti pointer, menampilkan X dan Y.
  Kalau sedang menunjuk sebuah objek, barisnya bertambah: nama objek dan
  **titik jangkarnya**. Bisa dimatikan lewat centang **Koordinat** di toolbar.
- **Status bar** kiri bawah — sama isinya, untuk yang tidak suka ada kotak
  mengikuti kursor.

Penunjuk di kursor sengaja ikut menampilkan jangkar objek: jangkar ada di
*tengah* denah (dan untuk objek miring, di tengah alas **sebelum** dimiringkan),
yang gampang keliru kalau tidak ditunjukkan berdampingan dengan posisi kursor.

---

## Navigasi kanvas 2D

Mengikuti kebiasaan Photoshop/Figma:

| Aksi | Hasil |
|---|---|
| roda mouse | geser atas–bawah |
| `Shift` + roda | geser kiri–kanan |
| `Ctrl` + roda | zoom (juga cocok dengan pinch trackpad) |
| Spasi + drag, drag kanan/tengah | geser bebas |
| tombol `+` / `−` / `Fit` di toolbar | zoom bertahap |

Roda polos sengaja **bukan** zoom: di kanvas besar itu bikin susah menjelajah —
tiap mau melihat bagian lain harus zoom keluar dulu lalu masuk lagi.

### Panel 3D

Kendali roda sama persis dengan 2D:

| Aksi | Hasil |
|---|---|
| roda mouse | geser atas–bawah |
| `Shift` + roda | geser kiri–kanan |
| `Ctrl` + roda | zoom **ke titik yang ditunjuk kursor** |
| drag | putar (orbit) |
| `Shift`/kanan/tengah + drag | geser |

Zoom-nya menuju titik di bawah kursor, bukan ke pusat orbit. Ini yang bikin
memperbesar sudut tertentu jadi mungkin: sebelumnya makin dekat, bagian yang
mau dilihat justru makin keluar layar dan harus dikejar dengan geser manual.

Caranya: posisi kamera **dan** titik orbit diskalakan terhadap titik di bawah
kursor. Karena keduanya diskalakan dengan faktor sama, arah pandang tidak
berubah — hanya jaraknya — sehingga titik acuan tetap terproyeksi di piksel
yang sama. Kalau kursor di ruang kosong, acuannya jatuh ke bidang mendatar
setinggi titik orbit.

Catatan arah: menggulir roda dan menyeret dengan tombol tengah bergerak
berlawanan — menggulir itu menggeser *pandangan*, menyeret itu menggenggam
*pemandangannya*. Sama seperti kebanyakan aplikasi.

---

## Nama & label

Nama objek tampil di **denah 2D** dan di **panel 3D**. Label 3D berupa billboard
yang selalu menghadap kamera dan dijaga **tetap 15 piksel** di layar, persis
seperti label 2D: mendekat atau menjauh, tingginya tidak berubah — jadi label
tidak pernah membesar menutupi model. Posisinya menempel tepat di atas puncak
objeknya. Ukuran fisik tidak ditampilkan, hanya nama.

Supaya tampilan tidak penuh saat melihat keseluruhan site, label **hilang
sendiri** ketika objeknya tampak lebih kecil dari 46 piksel di layar, dan
**muncul lagi** begitu di-zoom mendekat. Jadi zoom-out = bersih, zoom-in =
detail namanya terbaca. Semuanya bisa dimatikan lewat centang **Nama 3D** di
toolbar.

### Nama grup

Anggota grup sering bertumpuk persis di titik yang sama — badan, atap, dan
isinya — sehingga labelnya saling menimpa. Beri **Nama grup** di panel Properti
(muncul saat 2+ objek terpilih) dan seluruh anggota diganti **satu label**
berwarna kuning di tengah grup, di denah maupun 3D. Kosongkan untuk kembali
menampilkan nama tiap objek.

---

## Anti-tabrakan

Centang **Tidak boleh bertumpuk objek lain** di panel Properti. Saat objek itu
diseret di denah, gerakannya berhenti di batas objek lain alih-alih menembus.

| Perilaku | Alasan |
|---|---|
| Kalau arah diagonal tertahan, objek **meluncur** menyusuri sisi yang ditabrak | membekukannya total bikin menempatkan mesin rapat ke tetangga jadi menyiksa |
| Cukup **salah satu** objek dicentang | menandai sebuah mesin melindunginya dari ditumpuki objek mana pun |
| Harus bertindih di denah **dan** rentang tingginya beririsan | tanpa syarat tinggi, atap di atas badan atau lantai 2 di atas lantai 1 ikut dianggap tabrakan |
| Bersentuhan tepat di tepi bukan tabrakan | supaya bisa menempel rapat |
| Bidang tanah, alas lantai, pintu & jendela tidak pernah ikut dihitung | memang untuk ditempati/ditempeli |
| Objek yang **sudah** bertumpuk sejak awal tetap bebas digeser | kalau diblokir, objeknya malah terkurung dan tidak bisa dirapikan |

Pengecekan memakai kotak berputar (OBB) lewat teorema sumbu pemisah, jadi objek
yang diputar miring diukur pada bentuk aslinya — bukan kotak sejajar sumbu yang
melar. Nilai X/Y yang **diketik** di panel tidak diblokir: itu masukan yang
disengaja dan presisi.

---

## Urutan objek

Daftar **Objek** bisa disusun ulang dengan **menyeret barisnya**. Urutannya =
urutan gambar di denah: baris teratas digambar paling depan. Objek terbaru
otomatis masuk paling atas.

---

## Sembunyikan objek

Tiap baris di panel **Objek** punya ikon mata. Klik untuk menyembunyikan /
menampilkan; `H` melakukan hal yang sama untuk seluruh seleksi. Berguna untuk
mengintip isi gedung: sembunyikan dinding, mesin-mesin di dalamnya langsung terlihat.

Ada dua flag yang mirip tapi beda peran:

| Flag | Efek |
|---|---|
| **mata** (`meta.visible`) | hilang dari 2D **dan** 3D, tidak bisa dipilih, **tidak ikut export STL** |
| **"Sertakan di export STL"** (`meta.solid`) | tetap terlihat (semi-transparan di 3D), tapi tidak ikut diexport — untuk garis bantu / konteks |

---

## Pintu & jendela melubangi dinding

Taruh **Pintu** atau **Jendela** menempel pada **Dinding** atau **Ruangan**, dan
dindingnya otomatis dibangun ulang dengan lubang di posisi itu — bukan panel yang
sekadar ditempel.

Caranya tanpa CSG/boolean: dinding dipotong jadi kolom-kolom pada setiap tepi
lubang, lalu tiap kolom diisi balok di atas dan di bawah lubangnya. Hasilnya
dekomposisi persegi yang eksak; tiap potongan tetap solid tertutup sehingga
STL-nya aman. Volume yang hilang persis `lebar × tinggi × tebal dinding`.

Berlaku untuk tipe yang ditandai `host: true` (Dinding, Ruangan). Ruangan
diuraikan jadi 4 segmen dinding, jadi bukaan bisa ditaruh di sisi mana pun,
termasuk saat ruangannya diputar.

| Kombinasi | Hasil |
|---|---|
| **Lubangi dinding** ✓ + **Sertakan di export STL** ✓ | lubang + daun pintu/jendela terpasang (default) |
| **Lubangi dinding** ✓ + STL ✗ | lubang kosong di model cetak — ini yang dipakai untuk *doorway* |
| **Lubangi dinding** ✗ | perilaku lama: panel ditempel, dinding utuh |
| disembunyikan (ikon mata) | tidak melubangi sama sekali — objeknya dianggap tidak ada |

Batasannya: bukaan atau dinding yang **dimiringkan** (`tiltX`/`tiltZ` ≠ 0)
dilewati — lubangnya tidak dihitung. Tipe `Massa Box` juga tidak bisa dilubangi
karena ia massa padat; melubanginya akan membuat terowongan menembus seluruh
bangunan. Pakai `Ruangan` untuk cangkang bangunan.

---

## Poligon bebas

Untuk bangunan / zona yang bentuknya tidak persegi. Klik item **Poligon ✎** di
panel Library (atau tekan `P`), lalu klik titik demi titik di kanvas.

| Aksi | Tombol |
|---|---|
| tambah titik | klik |
| kunci arah ke kelipatan 45° | tahan `Shift` sambil menggerakkan kursor |
| batalkan 1 titik terakhir | `Backspace` |
| selesai | klik titik awal, klik-ganda di titik terakhir, atau `Enter` |
| batal semuanya | `Esc` |

Kalau snap grid aktif, titik menempel ke grid. `Shift` (kunci sudut) dan snap
grid tidak bisa berlaku bersamaan — `Shift` menang.

### Edit titik

Pilih poligonnya → tombol **Edit Titik** di panel Properti:

- **geser** titik biru untuk memindahkannya
- **klik** lingkaran kecil di tengah sisi untuk menyisipkan titik baru
- **Alt+klik** sebuah titik untuk menghapusnya (minimal 3 titik)
- `Esc` selesai

Menggeser titik menghitung ulang kotak pembatas — `width`/`depth` ikut
menyesuaikan dan pergeseran pusatnya dikembalikan ke `x`/`y` dunia, sehingga
**rotasi shape tidak hilang**. Edit titik dimatikan untuk poligon yang
dimiringkan atau dikunci.

Poligon yang sisinya **saling menyilang** tidak bisa diekstrusi jadi mesh
tertutup; kalau terdeteksi, status bar memperingatkan supaya bisa dirapikan
lewat Edit Titik.

---

## Grup objek

Preset (Rumah, Masjid, dst.) datang sebagai satu grup: klik salah satu bagian,
semuanya ikut terpilih dan bergerak bersama.

| Aksi | Cara |
|---|---|
| **Gabung** | pilih ≥2 objek → tombol **Gabung Grup** di panel Properti, atau `Ctrl+G` |
| **Lepas** | pilih grupnya → tombol **Lepas Grup**, atau `Ctrl+Shift+G` |
| **Pilih satu anggota saja** | `Alt`+klik objeknya di kanvas, atau klik namanya di daftar **Pilih satu untuk diedit** di panel Properti |

### Mengedit grup sebagai satu benda

Saat 2+ objek terpilih, panel Properti menampilkan form untuk **grupnya**:
X, Y, rotasi/yaw, miring X & Z, ukuran (lebar/dalam/tinggi), dan elevasi dasar.

| Yang diubah | Efeknya |
|---|---|
| X / Y / elevasi dasar | seluruh grup bergeser bersama, jarak antar anggota tetap |
| rotasi / miring X / miring Z | grup diputar **rigid** terhadap pusatnya — posisi tiap anggota ikut berubah, bukan cuma orientasinya |
| lebar / dalam / tinggi | grup diskalakan **proporsional**: posisi dan dimensi tiap anggota ikut faktor yang sama |

Skala sengaja uniform (ketiga sumbu sekaligus), bukan per-sumbu. Menskalakan
satu sumbu saja akan menggepengkan anggota yang diputar miring — bentuknya
tidak lagi bisa diwakili oleh width/depth/height. Uniform selalu eksak, berapa
pun rotasi tiap anggotanya.

Hasil rotasi & penskalaan disimpan dengan pembulatan lebih halus daripada
presisi tampilan (0,1 mm untuk meter). Kalau dibulatkan ke presisi tampilan,
tiap putaran menggeser tiap titik sampai setengah satuan terakhir dan
kesalahannya menumpuk saat grup diputar berulang.

Untuk mengedit **satu anggota** saja: `Alt`+klik di kanvas, atau klik namanya
di daftar **Pilih satu untuk diedit** di panel yang sama.

Baris di panel Objek yang tergabung ditandai ikon rantai. Menggabung dua grup
yang sudah ada akan melebur keduanya jadi satu grup baru — anggota lama ikut
terbawa, bukan cuma objek yang kebetulan terpilih.

---

## Tata letak panel

Pembatas antara panel 2D dan 3D bisa **digeser** untuk mengatur lebar
(klik ganda = bagi sama rata). Lebarnya diingat per browser.

Panel kanan juga punya pembatas geser antara **Properti** dan **Objek**: saat
objek makin banyak, daftar Objek memanjang dan Properti tergencet — user yang
paling tahu mana yang sedang dibutuhkan. Klik ganda mengembalikan ke seimbang;
posisinya diingat per browser.

Untuk fokus mengerjakan denah, panel 3D bisa disembunyikan sepenuhnya:
tombol `»` di pembatas, tombol **2D** di toolbar, atau tekan `1`.
`2` kembali ke split, `3` untuk 3D saja.

---

## Nambah shape baru

Cukup satu entry di `js/shapes.js`, tidak ada komponen yang perlu disentuh:

```js
'roof-mansard': {
  name: 'Atap Mansard',
  foot: 'rect',        // bentuk denah: 'rect' | 'ellipse' | 'poly'
  geo:  'prismGable',  // builder 3D di js/geometry.js
  w: 8, d: 6, h: 2.5,  // default dalam METER
  color: '#d1685b',
  roof: true           // masuk kategori atap → auto-pasang di atas seleksi
}
```

Kemiringan bawaan juga bisa ditulis di sini — `'m-rotary'` misalnya lahir
langsung dalam posisi rebah:

```js
'm-rotary': {
  name: 'Rotary', foot: 'ellipse', geo: 'cylinder',
  w: 2.4, d: 2.4, h: 14, color: '#7f8b98',
  tiltX: 90,   // langsung tidur
  elev: 1.2    // setinggi jari-jari, jadi pas menempel lantai
}
```

lalu daftarkan tipenya di array `LIBRARY`, dan (opsional) tambahkan ikon SVG di `ICONS`.

Kalau butuh bentuk 3D yang belum ada, tambah builder di `js/geometry.js`.
Untuk atap berpenampang seragam, cukup tambah profil baru di `PROFILES` —
`prism()` akan mengekstrusinya jadi mesh tertutup.

### Objek komposit

Objek yang bukan primitif murni (mesin, furniture, pohon, hopper, konveyor…)
dirakit dari beberapa bagian di bagian **OBJEK KOMPOSIT** `js/geometry.js`,
lalu didaftarkan di map `REAL`. Tersedia helper `boxP` / `cylP` / `frustP` /
`ellipP` / `axleX` / `axleZ` / `domeP` / `legs`, semuanya menerima titik tengah
alas bagian dalam meter:

```js
function tankGeo(w, h, d) {
  var legH = h * 0.13, shellH = h * 0.6, domeH = h - legH - shellH;
  return oval(mergeGeos([
    cylP(w * 0.94, shellH, 0, legH, 0, S_FINE),
    domeP(w * 0.94, domeH, 0, legH + shellH, 0)
    // + kaki-kaki
  ]), w, d);
}
```

Dua aturan yang harus dipatuhi builder komposit:

1. **Dibangun dalam meter, bukan unit.** Proporsi antar bagian tidak boleh ikut
   ter-scale — roda mobil harus tetap bundar walau bodinya 1,8 × 4,5 m.
2. **Semua bagian wajib muat di dalam kotak nominal w×h×d**, supaya footprint
   denah 2D dan bounding box tetap jujur.

Tiap bagian adalah solid tertutup tersendiri, jadi hasil `mergeGeos()` tetap
aman untuk STL walaupun bagian-bagiannya saling menembus.

---

## Export STL

- Output selalu **milimeter** (konvensi slicer), sumbu dikonversi Y-up (Three) → Z-up (STL).
- Alas model persis di Z = 0, jadi langsung menempel di build plate.
- Dropdown **Cetak** = skala cetak. `1:100` artinya bangunan 10 m jadi 100 mm.
- Shape dengan centang *"Sertakan di export STL"* dimatikan akan dilewati
  (berguna untuk garis bantu / slab konteks). Objek yang disembunyikan lewat
  ikon mata juga tidak ikut diexport.
- Semua 34 tipe shape sudah diverifikasi **watertight** (0 edge terbuka), jadi
  slicer tidak perlu perbaikan mesh. Kemiringan tidak mengubah hal ini —
  rotasi hanya transformasi matriks, topologi mesh tetap.

---

## Shortcut

| Tombol | Fungsi |
|---|---|
| klik / Shift+klik | pilih / tambah ke seleksi |
| drag di area kosong | seleksi kotak (rubber band) |
| Spasi + drag, atau drag kanan/tengah | geser kanvas |
| scroll | zoom (step diskrit) |
| `F` | fit ke seleksi (2D + 3D) |
| `Del` | hapus |
| `Ctrl+D` | duplikat |
| `Ctrl+G` / `Ctrl+Shift+G` | gabung grup / lepas grup |
| `Alt`+klik | pilih satu anggota grup saja |
| `H` | sembunyikan / tampilkan seleksi |
| `1` / `2` / `3` | mode tampilan 2D / Split / 3D |
| `Ctrl+A` | pilih semua |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Ctrl+S` | simpan |
| panah (+Shift) | geser halus / 10× |

Di pane 3D: drag = orbit, Shift-drag atau drag kanan = pan, scroll = zoom.

---

## Penyimpanan

Tiga lokasi, dan aplikasi selalu jalan walau cuma punya yang pertama:

| Lokasi | Kapan dipakai |
|---|---|
| **Browser ini** (localStorage) | selalu aktif; autosave otomatis (lihat di bawah) |
| **Server** | kalau backend dipasang & sudah login — bisa dibuka dari komputer mana pun |
| **File `.json`** | Export/Import, untuk backup dan pindah komputer tanpa server |

Ketiganya memakai format yang sama persis (keluaran `Project.serialize()`),
jadi project bisa dipindah bolak-balik tanpa konversi.

Tombol **Simpan** dan **Buka** menampilkan pilihan lokasi *hanya* kalau backend
terdeteksi. Deteksinya otomatis lewat `GET api/me` saat aplikasi mulai — kalau
gagal, seluruh tombol server disembunyikan dan aplikasi tetap berfungsi penuh.
Artinya kode yang sama bisa di-deploy sebagai file statis murni.

### Autosave

Setiap perubahan ditulis otomatis ke localStorage, ditunda 600 ms supaya
mengetik atau menyeret tidak memicu ratusan penulisan. Saat halaman ditutup,
di-refresh, atau tabnya disembunyikan, tunggakan itu **ditulis paksa** lewat
`pagehide`/`visibilitychange` — tanpa itu, perubahan dalam 600 ms terakhir
hilang persis saat paling baru dan paling mudah terlupa.

Status di kanan bawah menunjukkan keadaannya. Kalau penyimpanan browser penuh
atau diblokir, indikatornya berubah merah **⚠ GAGAL disimpan** dan bisa diklik
untuk langsung Export JSON. Ini penting: tanpa peringatan itu, kegagalan
autosave hanya jadi baris di console dan user mengira kerjaannya aman padahal
sejak tadi tidak ada yang tersimpan.

Yang perlu diingat: autosave hanya menyimpan **satu** project terakhir, di
**browser itu saja**. Untuk menyimpan banyak project atau membukanya dari
komputer lain, pakai **Simpan** (browser/server) atau **Export JSON**.

---

Backend-nya Express + penyimpanan file JSON, **tanpa dependensi native** —
`npm install` tidak perlu toolchain build di VPS.

Cara pasang, API, dan catatan keamanannya ada di
**[server/README.md](server/README.md)**.

### Pintu/jendela pada Massa Box: ceruk, bukan lubang tembus

`Massa Box` adalah balok padat — dulu bukaan padanya dilewati sama sekali,
karena melubangi penuh seluruh ketebalannya (bisa 6 m+) berarti membuat
terowongan menembus bangunan. Sekarang bukaan tetap dipotong, tapi kedalaman
potongannya dibatasi setebal bukaan itu sendiri (mis. pintu depth 0,14 m),
persis di posisi bukaan ditaruh — sisi lain massa tetap solid utuh. Hasilnya
ceruk/reveal yang realistis kalau bukaan ditaruh di tepi massa (posisi wajar
saat menempatkan pintu di kanvas); kalau ditaruh persis di tengah massa yang
sangat tebal, ceruknya jadi rongga tersembunyi yang tidak tembus ke permukaan
mana pun — pindahkan bukaannya ke tepi kalau itu yang dimaksud. `Dinding` dan
`Ruangan` tidak berubah — keduanya tetap melubangi penuh seperti sebelumnya.

### Poligon menyilang: bisa diperbaiki dengan satu klik

Kalau sisi poligon terdeteksi saling menyilang, panel Properti menampilkan
peringatan plus tombol **Perbaiki Otomatis** — mengurutkan ulang titik yang
sama berdasarkan sudut terhadap pusatnya (asumsi bentuknya "star-shaped").
Titiknya tetap sama persis, cuma urutannya berubah, sehingga hasilnya bisa jadi
bentuk yang cukup berbeda dari sketsa awal — makanya perbaikan ini opt-in
(tombol), bukan otomatis saat menggambar. Tidak semua kasus bisa diperbaiki
cara ini (poligon dengan lekukan yang "tersembunyi" dari titik pusat tidak akan
terurut benar); kalau gagal, status bar bilang perlu dirapikan manual lewat
Edit Titik.

### Yang belum dikerjakan

- **Bukaan pada dinding yang dimiringkan** (`tiltX`/`tiltZ` ≠ 0) dilewati —
  ini bukan sekadar belum sempat, tapi keterbatasan model: sistem dinding di
  sini murni 2D-footprint-diekstrusi-vertikal (lihat "Rotasi 3 sumbu" di atas),
  dan begitu dinding miring, konsep "atas" bagi dinding itu bukan lagi sumbu Y
  dunia — seluruh model 2D-nya tidak lagi berlaku. Mendukungnya dengan benar
  butuh solid modeling 3D penuh (CSG), yang sengaja dihindari di seluruh
  proyek ini supaya tetap tanpa build step & ringan. Dinding memang jarang
  dimiringkan dalam praktik nyata, jadi batasan ini dianggap wajar.

---

## Deploy — 3d.dodaa.id

**Sudah live di https://3d.dodaa.id.**

Yang terpasang di produksi: satu proses Node (Express) menyajikan aplikasi
**dan** API-nya sekaligus, dijalankan PM2 di VPS, diproksi oleh container Caddy
yang mengurus HTTPS.

| Hal | Nilai |
|---|---|
| Folder | `/root/apps/layout3d` |
| Proses | PM2 `layout3d`, port `8130`, bind `0.0.0.0` |
| Proxy | `/root/mfadhil-api/Caddyfile` → `3d.dodaa.id` → `172.18.0.1:8130` |
| Firewall | UFW: `8130/tcp` hanya dari jaringan Docker `172.18.0.0/16` |
| Data | `/root/apps/layout3d/server/data/` |

Langkah lengkap (pasang ulang, set password, backup, arsitektur proxy-nya)
ada di **[server/README.md](server/README.md)**.

### Alternatif: statis tanpa backend

Aplikasi ini tetap berfungsi penuh sebagai file statis (tanpa Node sama
sekali) — cuma kehilangan fitur simpan ke server; localStorage dan
Export/Import JSON tetap jalan. Cukup unggah empat hal ini apa adanya:

```
index.html
css/
js/
vendor/          <- jangan sampai ketinggalan, isinya library-nya
```

Tidak ada path absolut di seluruh sumber (semua `href`/`src` relatif), jadi
jalan di root domain maupun di dalam sub-folder tanpa perubahan apa pun —
sudah diuji dari `/3D/sub/` dan hasilnya identik.

Contoh Caddy statis:

```
3d.dodaa.id {
    root * /var/www/3d.dodaa.id
    file_server
    encode gzip
}
```

Untuk Apache/cPanel cukup unggah ke document root subdomain; tidak perlu
`.htaccess`, tidak ada routing sisi server.

---

Endpoint API dipanggil dengan path **relatif** (`api/projects`, bukan
`/api/projects`), jadi sifat portabel di atas tetap terjaga walau aplikasinya
dipasang di dalam sub-folder.

---

## Design challenge

Mode kompetisi desain: admin menyiapkan **template** (biasanya bidang tanah dan
konteks sekitarnya, tanpa bangunan), peserta merancang di dalamnya memakai
editor yang sama, lalu mengirim karyanya ke **galeri publik**.

### Tiga peran, tanpa akun

Backend ini sejak awal satu-password-untuk-satu-orang. Mode challenge butuh
banyak peserta yang masing-masing hanya boleh menyunting karyanya sendiri —
kalau dijawab dengan tabel user, ikut terseret registrasi, verifikasi email,
lupa password, dan moderasi. Itu proyek tersendiri.

Yang dipakai sebagai gantinya: **kapabilitas berbentuk tautan**.

| Peran | Cara masuk | Boleh apa |
|---|---|---|
| Admin | password server yang sudah ada | bikin/tutup/hapus challenge, terbitkan undangan, sunting & hapus karya siapa pun |
| Peserta baru | `/?c=<slug>&k=<undangan>` | memuat template, merancang, mengirim karya |
| Peserta lama | `/?s=<slug>/<id>&e=<sunting>` | membuka karyanya sendiri dan memperbaruinya |
| Siapa saja | `/c/<slug>` dan `/?view=<slug>/<id>` | melihat brief, galeri, dan karya peserta |

Token disimpan di server sebagai **hash SHA-256**, bukan apa adanya — backup
atau log yang bocor tidak langsung memberi hak sunting. Konsekuensinya jujur
saja: token tidak bisa ditampilkan ulang. Peserta yang kehilangan tautannya
minta admin menerbitkan yang baru; menerbitkan undangan baru **mematikan yang
lama**.

Batasnya juga jujur: siapa pun yang dikirimi tautan sunting bisa ikut
menyunting karya itu. Untuk kompetisi berhadiah besar, ini kurang; untuk
latihan desain internal, ini pas.

### Membuat challenge

1. Login ke server (tombol **Server**), lalu susun project template — tarik
   **Bidang Tanah**, atur ukurannya, tambahkan konteks kalau perlu.
2. Klik **Challenge** di toolbar (hanya muncul setelah login).
3. Isi judul, brief, dan batasannya. Dialog langsung memberi **tautan
   undangan** (untuk peserta) dan **tautan galeri** (publik).

Panel admin di halaman galeri bisa menutup/membuka challenge dan menerbitkan
tautan undangan baru.

### Batasan yang diperiksa

| Batasan | Arti |
|---|---|
| **KDB maks** | luas tapak bangunan ÷ luas tanah, dalam persen |
| **Tinggi maks** | puncak tertinggi (elevasi + tinggi) |
| **Objek maks** | jumlah objek bangunan |
| **Batas tanah** | selalu berlaku — semua bangunan harus di dalam poligon tanah |

Bar challenge di atas kanvas menampilkan status ini **sambil menggambar**;
arahkan kursor ke sana untuk melihat rinciannya.

Luas terbangun dihitung sebagai **gabungan**, bukan penjumlahan. Menjumlah luas
tiap objek salah begitu ada dua massa yang bertumpuk sebagian (badan + teras,
atau atap yang lebih lebar dari badannya): satu meter persegi tanah yang sama
terhitung dua kali dan peserta terlihat melanggar KDB padahal tidak.
Gabungannya dihitung dengan raster 600 sel pada sisi terpanjang — untuk tanah
100 m, galat tepinya sekitar 17 cm.

Tapak yang menjorok keluar tanah tidak menaikkan KDB; pelanggarannya diurus
aturan batas tanah, bukan dihitung dua kali.

### Satu implementasi untuk dua sisi

`js/evaluate.js` dipakai **editor dan server sekaligus** — server memuatnya
lewat `vm` (lihat `server/geom.js`). Kalau logikanya disalin, kedua salinan
pasti berbeda pelan-pelan, dan peserta akan melihat "memenuhi brief" di editor
lalu ditolak saat mengirim.

Angka yang **disimpan** selalu hasil hitungan server. Klien menghitung hanya
untuk umpan balik seketika; laporan yang dikirim klien diabaikan.

### Autosave saat mode challenge

Membuka tautan challenge **tidak** menyentuh autosave project pribadi: mode
challenge menulis ke kunci tersendiri (`layout3d:autosave:c:<slug>`). Tanpa
pemisahan ini, satu klik pada tautan undangan akan menimpa gambar pribadi
pengguna, dan penyebabnya mustahil ditebak.

Peserta yang me-refresh di tengah menggambar akan menemukan drafnya kembali,
bukan template kosong. Untuk karya yang sudah terkirim, versi server yang
dipakai — itu yang resmi.

### Yang belum ada

Penjurian dan voting (poin 8 bagian "judging") belum dibuat: belum ada skor,
peringkat, mode anonim, maupun peran juri. Galeri sekarang menampilkan angka
kepatuhan apa adanya, dan penilaian dilakukan manusia di luar aplikasi.
