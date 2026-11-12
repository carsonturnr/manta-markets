#!/usr/bin/env bash
# Nightly archive (systemd timer manta-archive): every finished hourly file is recompressed with
# zstd (about 37% smaller than the recorder's streaming gzip), checked, and copied to the Hetzner
# Storage Box. Local copies are deleted only when older than KEEP_DAYS *and* confirmed archived,
# so recent data always exists twice. `status` keeps counting archived hours through index.jsonl.
set -euo pipefail
. /etc/manta/env
RAW=${RAW:-/var/lib/manta/raw}
KEEP_DAYS=${KEEP_DAYS:-1}
BOX="$STORAGEBOX_USER@$STORAGEBOX_USER.your-storagebox.de"
SSH="ssh -p 23 -i /root/.ssh/storagebox -o BatchMode=yes"
DONE="$RAW/archived.txt"   # relative paths already on the Storage Box
touch "$DONE"

/opt/manta/bin/status -in "$RAW" > /dev/null   # index every finished hour first
current=$(date -u +%Y-%m-%d/%H)
cutoff=$(date -u -d "-$KEEP_DAYS days" +%Y-%m-%d)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cd "$RAW"
find . -name '*.jsonl.gz' | sed 's|^\./||' | sort | while read -r rel; do
  [[ "$rel" == *"$current"[-.]* ]] && continue              # this hour's files are still being written
  if ! grep -qxF "$rel" "$DONE"; then
    zst="$tmp/${rel%.gz}.zst"
    mkdir -p "$(dirname "$zst")"
    gzip -dc "$rel" | zstd -19 -q -o "$zst"
    zstd -tq "$zst"
    (cd "$tmp" && rsync -aR --checksum -e "$SSH" "${rel%.gz}.zst" "$BOX:manta/raw/")
    rm -f "$zst"
    echo "$rel" >> "$DONE"
  fi
  day=$(basename "$(dirname "$rel")")
  if [[ "$day" < "$cutoff" ]]; then rm -f "$rel"; fi
done
rsync -a -e "$SSH" "$RAW/index.jsonl" "$DONE" "$BOX:manta/"
find "$RAW" -mindepth 2 -type d -empty -delete
