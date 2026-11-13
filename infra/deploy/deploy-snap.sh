#!/usr/bin/env bash
# Deploy the tracker snapshotter to the VM: infra/deploy/deploy-snap.sh root@HOST
# Separate from deploy.sh, which restarts the recorder: this one never touches it.
# Copies DATABASE_URL from the local .env into /etc/manta/env, applies db/schema.sql, and
# enables the every-minute timer. The VM runs the venv's script directly, not uv.
set -euo pipefail
host=${1:?usage: deploy-snap.sh root@HOST}
cd "$(dirname "$0")/../.."
db_url=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
site_pw=$(grep '^SITE_DB_PASSWORD=' .env | cut -d= -f2-)
ssh "$host" "mkdir -p /opt/manta/pricing /opt/manta/db"
rsync -a --delete --exclude .venv --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache \
  pricing/ "$host:/opt/manta/pricing/"
rsync -a --delete db/ "$host:/opt/manta/db/"
rsync -a infra/deploy/manta-snap.service infra/deploy/manta-snap.timer "$host:/etc/systemd/system/"
# The secrets go over ssh's stdin, never on a command line (where `ps` would show them).
printf '%s\n%s\n' "$db_url" "$site_pw" | ssh "$host" 'set -euo pipefail
  read -r db_url; read -r site_pw
  grep -v "^DATABASE_URL=" /etc/manta/env > /etc/manta/env.new || true
  echo "DATABASE_URL=$db_url" >> /etc/manta/env.new
  chmod 640 /etc/manta/env.new && chown root:manta /etc/manta/env.new && mv /etc/manta/env.new /etc/manta/env
  chown -R root:root /opt/manta/pricing /opt/manta/db
  cd /opt/manta/pricing
  UV_PYTHON_INSTALL_DIR=/opt/manta/python uv sync -q --frozen --no-dev
  chmod -R a+rX /opt/manta/pricing /opt/manta/db /opt/manta/python
  set -a; . /etc/manta/env; set +a
  SITE_DB_PASSWORD=$site_pw .venv/bin/manta-snap --init
  chmod 644 /etc/systemd/system/manta-snap.*
  systemctl daemon-reload
  systemctl enable -q --now manta-snap.timer
  systemctl start manta-snap.service
  journalctl -u manta-snap --no-pager -n 3 -o cat'
