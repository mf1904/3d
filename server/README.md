# layout3d — backend save/load

Express + penyimpanan file JSON, satu password, untuk `3d.dodaa.id`.

**Nol dependensi native** — `npm install` cuma menarik Express, tidak ada
kompilasi C++, jadi tidak butuh toolchain build di VPS.

Satu proses menangani dua hal: menyajikan aplikasi (file statis) **dan** API.
Frontend jadi satu origin dengan API, sehingga cookie sesi jalan apa adanya
tanpa CORS, dan path API bisa tetap relatif.

---

## Terpasang di mana (kondisi nyata)

Sudah live di **https://3d.dodaa.id**. Ringkasan pemasangan yang sebenarnya
dipakai di VPS `72.60.79.103`:

| Hal | Nilai |
|---|---|
| Folder aplikasi | `/root/apps/layout3d` |
| Proses | PM2 `layout3d`, fork mode |
| Port | `8130`, bind `0.0.0.0` |
| Reverse proxy | container `mfadhil-api-caddy-1`, config `/root/mfadhil-api/Caddyfile` |
| Firewall | UFW: `8130/tcp` hanya dari `172.18.0.0/16` |

### Arsitektur VPS ini (penting)

Port 80/443 **tidak** dipegang Caddy host, melainkan container Docker
`mfadhil-api-caddy-1`. Container itu yang mengurus HTTPS/Let's Encrypt untuk
semua domain, lalu meneruskan ke layanan di host lewat gateway jaringan Docker
`172.18.0.1:<port>`.

Konsekuensinya untuk app ini:

- **Bind harus `0.0.0.0`, bukan `127.0.0.1`.** Kalau hanya loopback, container
  tidak bisa menjangkaunya lewat `172.18.0.1`. Keamanannya dijaga di lapis
  firewall (UFW membatasi sumbernya ke jaringan Docker), bukan di lapis bind —
  pola yang sama dipakai `arsipku`, `arsip`, dan `mathjdi`.
- Caddy host (`/etc/caddy/Caddyfile`, port 8080) **tidak dipakai** app ini. Itu
  khusus situs statis seperti `dodaa.id`.

---

## Pasang ulang / pasang di server lain

```bash
mkdir -p /root/apps/layout3d
# salin isi paket (index.html, css/, js/, vendor/, server/) ke sini
cd /root/apps/layout3d/server
npm install --omit=dev
npm run set-password          # ketik password, minimal 8 karakter
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
```

`set-password` menanyakan password lewat prompt supaya tidak tercatat di
history shell. Bisa juga `echo "rahasia" | npm run set-password`.

Kalau PM2 belum pernah dipasang di server itu, jalankan juga `pm2 startup` dan
ikuti perintah yang dicetaknya supaya app hidup lagi setelah reboot. (Di VPS
ini sudah aktif dari app lain, jadi tidak perlu diulang.)

Buka portnya hanya untuk jaringan Docker:

```bash
ufw allow from 172.18.0.0/16 to any port 8130 proto tcp
```

### Daftarkan domainnya

Tambahkan ke `/root/mfadhil-api/Caddyfile` (config container depan):

```
3d.dodaa.id {
	reverse_proxy 172.18.0.1:8130
}
```

File ini dipakai bersama semua domain lain, jadi **backup dan validasi dulu**
sebelum reload:

```bash
cp /root/mfadhil-api/Caddyfile /root/mfadhil-api/Caddyfile.bak.$(date +%Y%m%d%H%M%S)
docker exec mfadhil-api-caddy-1 caddy validate --config /etc/caddy/Caddyfile
docker exec mfadhil-api-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

`reload` tidak memutus domain lain. Sertifikat HTTPS terbit otomatis begitu
DNS subdomainnya sudah menunjuk ke IP VPS dan ada trafik pertama.

Cookie sesi menyalakan flag `Secure` begitu melihat `X-Forwarded-Proto: https`
dari container — sudah terverifikasi jalan di produksi.

---

## Struktur di server

```
/root/apps/layout3d/
  index.html                 <- aplikasi
  css/  js/  vendor/
  server/
    server.js  db.js  auth.js
    tools/set-password.js
    ecosystem.config.js
    node_modules/
    data/                    <- data (di luar jangkauan HTTP)
      meta.json              hash password
      sessions.json
      projects/<id>.meta.json   metadata (nama, waktu, ukuran)
      projects/<id>.data.json   isi project
    logs/
```

`server.js` hanya menyajikan `/`, `/css`, `/js`, dan `/vendor` — folder
`server/` beserta datanya tidak pernah bisa diakses lewat HTTP. Ini disengaja:
menyajikan seluruh folder project akan membocorkan isi `data/`.

### Kenapa file JSON, bukan SQLite

Rencana awal menyebut SQLite. Saat dicoba, `better-sqlite3` ternyata butuh
modul native: `npm install` gagal karena tidak ada prebuild untuk versi Node
yang dipakai, lalu jatuh ke kompilasi C++ — artinya VPS wajib punya toolchain
build. Itu jadi satu-satunya titik rapuh di proyek yang selebihnya tanpa build
step sama sekali.

Yang sebenarnya dibutuhkan hanya: simpan blob JSON, ambil per id, daftar, hapus
— untuk satu pengguna. File biasa memenuhi itu tanpa dependensi apa pun,
datanya bisa dibaca mata telanjang, dan backup cukup menyalin folder.

Penulisan selalu lewat file sementara lalu `rename`, yang bersifat atomik —
mati listrik di tengah penyimpanan tidak meninggalkan file separuh jadi.
Metadata dipisah dari isi project supaya menampilkan daftar tidak perlu membaca
seluruh isi tiap project.

---

## API

Semua endpoint di bawah `/api`, jawabannya JSON. Selain `me` dan `login`,
semuanya butuh cookie sesi.

| Metode | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/me` | status: backend ada? password sudah diset? sudah login? |
| POST | `/api/login` | `{password}` → set cookie sesi |
| POST | `/api/logout` | hapus sesi |
| GET | `/api/projects` | daftar project (tanpa isi datanya) |
| GET | `/api/projects/:id` | satu project lengkap dengan datanya |
| POST | `/api/projects` | `{name, data, id?}` simpan / timpa |
| DELETE | `/api/projects/:id` | hapus |

`data` yang disimpan adalah blob JSON persis keluaran `Project.serialize()` di
frontend — sama dengan isi file **Export JSON**. Jadi project bisa dipindah
bolak-balik antara server, browser, dan file tanpa konversi.

**Nama project bersifat unik.** Menyimpan dengan nama yang sudah ada akan
menimpa project tersebut, mencerminkan cara kerja tombol Simpan di frontend
(bagi user, nama itulah identitas project).

---

## Keamanan

- Password tidak pernah disimpan apa adanya — hanya hash **scrypt** dengan salt
  acak per-password.
- Id project divalidasi ketat (`[A-Za-z0-9_-]`) sebelum dipakai sebagai nama
  file, jadi `../` tidak bisa dipakai untuk keluar dari folder data.
- Token sesi acak 32 byte, disimpan di `sessions.json` dalam bentuk **hash**;
  isi file itu saja tidak cukup untuk membajak sesi aktif.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` saat di belakang HTTPS.
- Login dibatasi **10 percobaan per 15 menit** per IP.
- Batas ukuran body 12 MB (`LAYOUT3D_MAX_BODY` untuk mengubah).
- Header `X-Powered-By` dimatikan.

Sudah diuji: percobaan `path traversal` lewat URL maupun lewat id project
semuanya ditolak 404, begitu juga akses langsung ke `server/*`, `README.md`,
dan `package.json`.

---

## Backup

Cukup salin satu folder — aman dilakukan saat server jalan, karena setiap
file ditulis atomik:

```bash
tar czf /backup/layout3d-$(date +%F).tar.gz -C /root/apps/layout3d/server data
```

Isi `data/projects/*.data.json` formatnya identik dengan file **Export JSON**
di aplikasi, jadi satu file project bisa langsung di-Import lewat browser tanpa
konversi apa pun.

---

## Variabel lingkungan

| Nama | Default | Fungsi |
|---|---|---|
| `PORT` | `8130` | port dengar |
| `HOST` | `127.0.0.1` | alamat bind (di VPS ini di-override jadi `0.0.0.0` lewat ecosystem.config.js) |
| `LAYOUT3D_PUBLIC` | `../` | folder aplikasi statis |
| `LAYOUT3D_DATA` | `./data` | folder data |
| `LAYOUT3D_MAX_BODY` | `12mb` | batas ukuran project |

---

## Backend ini opsional

Frontend mendeteksi keberadaan backend lewat `GET api/me` saat mulai. Kalau
gagal, seluruh tombol server disembunyikan dan aplikasi tetap berfungsi penuh
dengan localStorage + Export/Import JSON. Jadi aplikasi yang sama bisa
di-deploy sebagai file statis murni tanpa perubahan kode.
