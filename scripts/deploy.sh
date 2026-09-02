#!/usr/bin/env bash
#
# Deploy layout3d di VPS: tarik kode terbaru dari GitHub, pasang dependensi
# kalau perlu, restart PM2, lalu pastikan aplikasinya benar-benar hidup.
#
#   ssh root@72.60.79.103 '/root/apps/layout3d/scripts/deploy.sh'
#
# Kalau health check gagal, skrip otomatis balik ke commit sebelumnya —
# lebih baik jalan dengan versi lama daripada mati dengan versi baru.
#
set -euo pipefail

APP_DIR="${LAYOUT3D_DIR:-/root/apps/layout3d}"
PM2_NAME="${LAYOUT3D_PM2:-layout3d}"
HEALTH_URL="${LAYOUT3D_HEALTH:-http://127.0.0.1:8130/api/me}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
err() { printf '\n\033[1;31m!!! %s\033[0m\n' "$1" >&2; }

cd "$APP_DIR"

# --------------------------------------------------------------------------
# Data runtime (hash password, sesi, project tersimpan) tidak dilacak git.
# Backup dulu — murah, dan sekali waktu pasti menyelamatkan.
# --------------------------------------------------------------------------
if [ -d server/data ]; then
  BACKUP="/root/backup/layout3d-$(date +%Y%m%d-%H%M%S).tar.gz"
  mkdir -p /root/backup
  tar czf "$BACKUP" -C server data
  say "Data di-backup ke $BACKUP"
  # simpan 10 backup terakhir saja
  ls -1t /root/backup/layout3d-*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm --
fi

PREV="$(git rev-parse HEAD)"
say "Commit sekarang: $(git log -1 --oneline)"

say "Menarik perubahan dari GitHub"
git fetch --quiet origin
git reset --hard --quiet "origin/$(git rev-parse --abbrev-ref HEAD)"

NEW="$(git rev-parse HEAD)"
if [ "$PREV" = "$NEW" ]; then
  say "Sudah versi terbaru — tidak ada yang berubah"
else
  say "Update ke: $(git log -1 --oneline)"
fi

# --------------------------------------------------------------------------
# npm install hanya kalau daftar dependensinya memang berubah.
# --------------------------------------------------------------------------
if [ "$PREV" != "$NEW" ] && ! git diff --quiet "$PREV" "$NEW" -- server/package-lock.json server/package.json; then
  say "Dependensi berubah — npm install"
  (cd server && npm install --omit=dev --no-audit --no-fund)
else
  say "Dependensi tidak berubah — npm install dilewati"
fi

say "Restart PM2: $PM2_NAME"
pm2 restart "$PM2_NAME" --update-env >/dev/null
pm2 save >/dev/null

# --------------------------------------------------------------------------
# Health check: PM2 bilang "online" belum tentu aplikasinya benar-benar
# melayani permintaan. Yang menentukan adalah jawaban HTTP-nya.
# --------------------------------------------------------------------------
say "Health check"
OK=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then
    OK=1
    break
  fi
  printf '  menunggu... (%s/10)\n' "$i"
done

if [ "$OK" = "1" ]; then
  say "BERHASIL — $(curl -fsS --max-time 5 "$HEALTH_URL")"
  pm2 list | grep -E "$PM2_NAME|name" || true
  exit 0
fi

err "Health check GAGAL setelah 10 detik"
if [ "$PREV" != "$NEW" ]; then
  err "Mengembalikan ke commit sebelumnya: $PREV"
  git reset --hard --quiet "$PREV"
  (cd server && npm install --omit=dev --no-audit --no-fund) || true
  pm2 restart "$PM2_NAME" --update-env >/dev/null
  sleep 3
  if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then
    err "Sudah kembali ke versi lama dan sehat. Perbaiki kodenya, lalu deploy lagi."
  else
    err "Versi lama pun tidak sehat. Cek: pm2 logs $PM2_NAME --lines 50"
  fi
fi
exit 1
