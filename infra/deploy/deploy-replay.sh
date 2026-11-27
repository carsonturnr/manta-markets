#!/usr/bin/env bash
# Deploy the replay (step 8) to the VM: infra/deploy/deploy-replay.sh root@HOST
#   - manta-replay.timer: hourly replay files (replay.sh, recorder/cmd/replay)
#   - manta-replayserve: the read-only file server the site's server reads them from, port 8790,
#     over TLS with the relay's certificate (made by deploy.sh; the site trusts it as RELAY_CA)
#   - event response (recorder/cmd/eventresponse), run by replay.sh for each release in releases.tsv
#   - manta-news: the official news collector (recorder/cmd/news), writing /var/lib/manta/replay/news;
#     replay.sh runs `news -moves` after each hour's replay
# Never touches the recorder; installs only the binaries it builds, the others in bin/ stay. REPLAY_TOKEN (the file server's key) is made once and kept in the
# local .env; the same value goes into /etc/manta/env here and into Vercel's settings.
set -euo pipefail
host=${1:?usage: deploy-replay.sh root@HOST}
cd "$(dirname "$0")/../.."
if ! grep -q '^REPLAY_TOKEN=' .env; then
  echo "REPLAY_TOKEN=$(openssl rand -hex 24)" >> .env
fi
token=$(grep '^REPLAY_TOKEN=' .env | cut -d= -f2-)
bin=$(mktemp -d)
trap 'rm -rf "$bin"' EXIT
(cd recorder && for c in replay replayserve eventresponse news; do
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$bin/$c" "./cmd/$c"
done)
scp -q "$bin/replay" "$host:/opt/manta/replay.new"
scp -q "$bin/replayserve" "$host:/opt/manta/replayserve.new"
scp -q "$bin/eventresponse" "$host:/opt/manta/eventresponse.new"
scp -q "$bin/news" "$host:/opt/manta/news.new"
scp -q infra/deploy/replay.sh infra/deploy/releases.tsv "$host:/opt/manta/"
rsync -a infra/deploy/manta-replay.service infra/deploy/manta-replay.timer \
  infra/deploy/manta-replayserve.service infra/deploy/manta-news.service "$host:/etc/systemd/system/"
# The key goes over ssh's stdin, never on a command line (where `ps` would show it).
printf '%s\n' "$token" | ssh "$host" 'set -euo pipefail
  read -r token
  test -f /etc/manta/relay.crt || { echo "no /etc/manta/relay.crt: run deploy.sh first" >&2; exit 1; }
  grep -v "^REPLAY_TOKEN=" /etc/manta/env > /etc/manta/env.new || true
  echo "REPLAY_TOKEN=$token" >> /etc/manta/env.new
  chmod 640 /etc/manta/env.new && chown root:manta /etc/manta/env.new && mv /etc/manta/env.new /etc/manta/env
  for c in replay replayserve eventresponse news; do
    install -m 755 -o root -g root /opt/manta/$c.new /opt/manta/bin/$c && rm /opt/manta/$c.new
  done
  chown root:root /opt/manta/replay.sh /opt/manta/releases.tsv
  chmod 755 /opt/manta/replay.sh && chmod 644 /opt/manta/releases.tsv
  install -d -o manta -g manta -m 755 /var/lib/manta/replay /var/lib/manta/replay/news
  chmod 644 /etc/systemd/system/manta-replay.* /etc/systemd/system/manta-replayserve.service /etc/systemd/system/manta-news.service
  ufw allow 8790/tcp comment "manta replay file server" > /dev/null
  systemctl daemon-reload
  systemctl enable -q --now manta-replay.timer
  systemctl enable -q manta-replayserve.service && systemctl restart manta-replayserve.service
  systemctl enable -q manta-news.service && systemctl restart manta-news.service
  sleep 1
  systemctl is-active manta-replayserve.service manta-news.service manta-recorder.service'
