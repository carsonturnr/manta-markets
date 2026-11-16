#!/usr/bin/env bash
# Build and deploy the recorder to the VM: infra/deploy/deploy.sh root@HOST
# First run creates the manta user, /etc/manta/env (from env.example plus the Kalshi key already on
# the box at /etc/series/), installs zstd, and enables the recorder and the hourly archive.
set -euo pipefail
host=${1:?usage: deploy.sh root@HOST}
cd "$(dirname "$0")/../.."
bin=$(mktemp -d)
trap 'rm -rf "$bin"' EXIT
(cd recorder && for c in recorder status rawcat; do
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$bin/$c" "./cmd/$c"
done)
cp infra/deploy/archive.sh "$bin/"
ssh "$host" "mkdir -p /opt/manta"
rsync -a "$bin/" "$host:/opt/manta/bin.new/"
rsync -a infra/deploy/manta-recorder.service infra/deploy/manta-archive.service infra/deploy/manta-archive.timer "$host:/etc/systemd/system/"
scp -q infra/deploy/env.example "$host:/opt/manta/env.example"
ssh "$host" 'set -euo pipefail
  command -v zstd >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get -qq install -y zstd >/dev/null
  id manta >/dev/null 2>&1 || useradd -r -m -d /var/lib/manta -s /usr/sbin/nologin manta
  mkdir -p /var/lib/manta/raw && chown -R manta:manta /var/lib/manta
  if [ ! -f /etc/manta/env ]; then
    install -d -m 750 -o root -g manta /etc/manta
    install -m 600 -o manta -g manta /etc/series/kalshi.pem /etc/manta/kalshi.pem
    { cat /opt/manta/env.example; grep ^KALSHI_API_KEY_ID= /etc/series/env; } > /etc/manta/env
    chmod 640 /etc/manta/env && chown root:manta /etc/manta/env
  fi
  chown -R root:root /opt/manta/bin.new && chmod 755 /opt/manta/bin.new /opt/manta/bin.new/*
  chmod 644 /etc/systemd/system/manta-*
  rm -rf /opt/manta/bin.old; [ -d /opt/manta/bin ] && mv /opt/manta/bin /opt/manta/bin.old
  mv /opt/manta/bin.new /opt/manta/bin
  systemctl daemon-reload
  systemctl enable -q --now manta-recorder manta-archive.timer
  systemctl restart manta-recorder
  systemctl --no-pager --lines=0 status manta-recorder | grep Active'
