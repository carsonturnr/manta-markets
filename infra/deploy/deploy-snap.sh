#!/usr/bin/env bash
# Deploy the site's data jobs to the VM: infra/deploy/deploy-snap.sh root@HOST
#   - the tracker snapshotter (manta-snap, every minute)
#   - the data-quality report (status -json + manta-quality, every 15 minutes)
#   - the screener's contracts (contracts + manta-contracts, every minute)
#   - the nightly database backup to the Storage Box (db-backup.sh, 03:30 UTC)
# Separate from deploy.sh, which restarts the recorder: this one never touches it (it only
# replaces the status and contracts binaries). The jobs' DATABASE_URL is the local Postgres, kept in
# /etc/manta/db.env on the VM (infra/deploy/db/setup.md); this applies db/schema.sql and enables the timers. The VM runs the venv's scripts directly, not uv.
set -euo pipefail
host=${1:?usage: deploy-snap.sh root@HOST}
cd "$(dirname "$0")/../.."
bin=$(mktemp -d)
trap 'rm -rf "$bin"' EXIT
(cd recorder && for c in status contracts; do
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$bin/$c" "./cmd/$c"
done)
ssh "$host" "mkdir -p /opt/manta/pricing /opt/manta/db /opt/manta/bin"
scp -q "$bin/status" "$host:/opt/manta/status.new"
scp -q "$bin/contracts" "$host:/opt/manta/contracts.new"
scp -q infra/deploy/db-backup.sh "$host:/opt/manta/db-backup.sh.new"
rsync -a --delete --exclude .venv --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache \
  pricing/ "$host:/opt/manta/pricing/"
rsync -a --delete db/ "$host:/opt/manta/db/"
rsync -a infra/deploy/manta-snap.service infra/deploy/manta-snap.timer \
  infra/deploy/manta-quality.service infra/deploy/manta-quality.timer \
  infra/deploy/manta-contracts.service infra/deploy/manta-contracts.timer \
  infra/deploy/manta-db-backup.service infra/deploy/manta-db-backup.timer "$host:/etc/systemd/system/"
ssh "$host" 'set -euo pipefail
  test -f /etc/manta/db.env || { echo "/etc/manta/db.env missing: see infra/deploy/db/setup.md" >&2; exit 1; }
  chown -R root:root /opt/manta/pricing /opt/manta/db
  for c in status contracts; do
    install -m 755 -o root -g root /opt/manta/$c.new /opt/manta/bin/$c && rm /opt/manta/$c.new
  done
  install -m 755 -o root -g root /opt/manta/db-backup.sh.new /opt/manta/bin/db-backup.sh && rm /opt/manta/db-backup.sh.new
  cd /opt/manta/pricing
  UV_PYTHON_INSTALL_DIR=/opt/manta/python uv sync -q --frozen --no-dev
  chmod -R a+rX /opt/manta/pricing /opt/manta/db /opt/manta/python
  set -a; . /etc/manta/env; . /etc/manta/db.env; set +a
  # Schema only: passwords are set by hand (manta-snap --init --passwords) when one changes.
  .venv/bin/manta-snap --init
  chmod 644 /etc/systemd/system/manta-snap.* /etc/systemd/system/manta-quality.* /etc/systemd/system/manta-contracts.* /etc/systemd/system/manta-db-backup.*
  systemctl daemon-reload
  systemctl enable -q --now manta-snap.timer manta-quality.timer manta-contracts.timer manta-db-backup.timer
  systemctl start manta-snap.service manta-quality.service manta-contracts.service
  journalctl -u manta-snap --no-pager -n 3 -o cat
  journalctl -u manta-quality --no-pager -n 2 -o cat
  journalctl -u manta-contracts --no-pager -n 2 -o cat'
