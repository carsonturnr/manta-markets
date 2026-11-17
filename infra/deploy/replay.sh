#!/usr/bin/env bash
# Hourly replay files (step 8; recorder/cmd/replay): for every finished hour still on this
# machine (the VM keeps 12 hours of raw files) that has no replay yet, rebuild Kalshi's books
# from that hour's files, warmed up on the previous hour's, and write one file per event to
# /var/lib/manta/replay/<event>/<hour>.json.gz. Run by manta-replay.service at low priority
# with CPU and memory caps, so it can't crowd out the recorder. Files older than 60 days go.
set -euo pipefail
RAW=${RAW:-/var/lib/manta/raw}
OUT=${OUT:-/var/lib/manta/replay}
SERIES=${REPLAY_SERIES:-KXBTCD}
DONE="$OUT/.done"
mkdir -p "$DONE"

files() { # the Kalshi files of one hour (YYYY-mm-ddTHH), in time order
  ls "$RAW/kalshi/${1%T*}/${1#*T}"-*.jsonl.gz 2>/dev/null | sort || true
}

for back in $(seq 11 -1 1); do
  hour=$(date -u -d "$back hour ago" +%Y-%m-%dT%H)
  prev=$(date -u -d "$((back + 1)) hour ago" +%Y-%m-%dT%H)
  [ -e "$DONE/$hour" ] && continue
  cur=$(files "$hour")
  if [ -z "$cur" ]; then
    echo "$hour: no raw files (already archived away, or the recorder was down)"
    touch "$DONE/$hour"
    continue
  fi
  # shellcheck disable=SC2086 # file lists split on whitespace on purpose (names have none)
  /opt/manta/bin/replay -series "$SERIES" -hour "$hour" -out "$OUT" $(files "$prev") $cur
  touch "$DONE/$hour"
done
find "$OUT" -name '*.json.gz' -mtime +60 -delete
find "$DONE" -type f -mtime +60 -delete
find "$OUT" -mindepth 1 -type d -empty -not -path "$DONE" -delete
