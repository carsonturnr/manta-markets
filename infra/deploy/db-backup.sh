#!/usr/bin/env bash
# Nightly database backup (systemd timer manta-db-backup): the manta database (pg_dump, custom
# format) and the logins (pg_dumpall --globals-only: without them a restore has no manta_site,
# manta_account, …) go to the Storage Box under manta/db/, 14 days kept. Restore steps:
# infra/deploy/db/setup.md.
#
# shortcut: the 14 days are also kept on the VM and mirrored with rsync --delete (about 20 MB a
# dump on 2026-11-27); if dumps reach gigabytes, prune on the box over sftp instead.
set -euo pipefail
. /etc/manta/env
DIR=/var/lib/manta/db-backup
KEEP=14
BOX="$STORAGEBOX_USER@$STORAGEBOX_USER.your-storagebox.de"
SSH="ssh -p 23 -i /root/.ssh/storagebox -o BatchMode=yes"
umask 077   # the dumps hold account rows and password hashes
mkdir -p "$DIR"
day=$(date -u +%Y-%m-%d)

# Written under a dot-name first, so a failed dump never replaces a good one or gets mirrored.
runuser -u postgres -- pg_dump -d manta -Fc > "$DIR/.manta-$day.dump"
runuser -u postgres -- pg_dumpall --globals-only > "$DIR/.globals-$day.sql"
pg_restore --list "$DIR/.manta-$day.dump" > /dev/null   # a complete archive, not a cut-off file
mv "$DIR/.manta-$day.dump" "$DIR/manta-$day.dump"
mv "$DIR/.globals-$day.sql" "$DIR/globals-$day.sql"

ls -1 "$DIR"/manta-*.dump | sort | head -n -"$KEEP" | while read -r old; do
  rm -f "$old" "$DIR/globals-$(basename "$old" .dump | cut -d- -f2-).sql"
done
rsync -a --checksum --delete --exclude '.*' -e "$SSH" "$DIR/" "$BOX:manta/db/"
[ -z "$(rsync -a --checksum --delete --exclude '.*' --dry-run --itemize-changes -e "$SSH" "$DIR/" "$BOX:manta/db/")" ]
echo "db-backup: manta-$day.dump ($(du -h "$DIR/manta-$day.dump" | cut -f1)); $(ls "$DIR"/manta-*.dump | wc -l) kept"
