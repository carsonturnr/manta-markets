#!/usr/bin/env bash
# Hourly archive (systemd timer manta-archive): every finished hourly file is copied as-is to the
# Hetzner Storage Box and verified by checksum. Local copies are deleted only when older than
# KEEP_HOURS *and* confirmed archived, so recent data always exists twice. (Nightly with a day kept
# until 2026-11-16; hourly since the added coverage roughly doubled the volume, to fit the VM's disk.) `status` keeps counting
# archived hours through index.jsonl.
#
# Files stay gzip: recompressing with zstd saves only about 23% at a level fast enough to keep up
# (level 19 needs about 94 CPU-seconds per minute of Kalshi data), and 1 TB holds about 5 months
# as-is. A file cut off by a crash is copied as-is too; rawlog.ReadFile (and rawcat) read it.
set -euo pipefail
. /etc/manta/env
RAW=${RAW:-/var/lib/manta/raw}
KEEP_HOURS=${KEEP_HOURS:-12}
BOX="$STORAGEBOX_USER@$STORAGEBOX_USER.your-storagebox.de"
SSH="ssh -p 23 -i /root/.ssh/storagebox -o BatchMode=yes"
DONE="$RAW/archived.txt"   # relative paths already on the Storage Box
touch "$DONE"

/opt/manta/bin/status -in "$RAW" > /dev/null   # index every finished hour first
current=$(date -u +%Y-%m-%d/%H)
cutoff=$(date -u -d "-$KEEP_HOURS hours" +%Y-%m-%d/%H)   # compared with "<day>/<hour>" of each file

cd "$RAW"
failed=0
todo=$(mktemp)
trap 'rm -f "$todo"' EXIT
find . -name '*.jsonl.gz' | sed 's|^\./||' | sort | while read -r rel; do
  [[ "$rel" == *"$current"[-.]* ]] && continue            # this hour's files are still being written
  grep -qxF "$rel" "$DONE" || echo "$rel"
done > "$todo"

# One rsync for all new files (relative paths kept), checksummed; then a dry run must find nothing
# left to copy before any of them counts as archived.
if [ -s "$todo" ]; then
  if rsync -a --checksum --files-from="$todo" -e "$SSH" . "$BOX:manta/raw/" \
     && [ -z "$(rsync -a --checksum --dry-run --itemize-changes --files-from="$todo" -e "$SSH" . "$BOX:manta/raw/")" ]; then
    cat "$todo" >> "$DONE"
  else
    echo "archive: FAILED to copy $(wc -l < "$todo") files (kept locally, retried next run)" >&2
    failed=1
  fi
fi

while read -r rel; do
  hour="$(basename "$(dirname "$rel")")/$(basename "$rel" | cut -c1-2)"   # kalshi/2026-11-16/01-0000.jsonl.gz → 2026-11-16/01
  if [[ "$hour" < "$cutoff" ]] && grep -qxF "$rel" "$DONE"; then rm -f "$rel"; fi
done < <(find . -name '*.jsonl.gz' | sed 's|^\./||')
rsync -a -e "$SSH" "$RAW/index.jsonl" "$DONE" "$BOX:manta/"
find "$RAW" -mindepth 2 -type d -empty -delete
echo "archive: $(wc -l < "$DONE") files archived in total; $(wc -l < "$todo") new this run; failed=$failed"
[ "$failed" -eq 0 ]
