#!/usr/bin/env bash
# Aggiorna il server MCP quando origin/main cambia. Pensato per il cron del VPS, ogni 5 minuti:
#   */5 * * * * $HOME/protask-mcp-server/scripts/auto-update.sh >> $HOME/protask-mcp-update.log 2>&1
# Se build, test o /health falliscono torna alla versione di prima e salta quel commit finché main non cambia.
set -euo pipefail

DIR="${PROTASK_MCP_DIR:-$HOME/protask-mcp-server}"
BRANCH="${PROTASK_MCP_BRANCH:-main}"
APP="${PROTASK_MCP_PM2_APP:-protask-mcp}"
HEALTH_URL="${PROTASK_MCP_HEALTH_URL:-http://127.0.0.1:3456/health}"
SKIP_FILE="${PROTASK_MCP_SKIP_FILE:-$HOME/.protask-mcp-update-skip}"

# Il cron ha un PATH minimo: node, npm e pm2 possono stare sotto nvm
export PATH="$PATH:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

log() { echo "$(date '+%F %T') $*"; }

# Un solo aggiornamento alla volta
exec 9>"${TMPDIR:-/tmp}/protask-mcp-update.lock"
flock -n 9 || exit 0

cd "$DIR"
git fetch -q origin "$BRANCH"
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "origin/$BRANCH")

[ "$OLD" = "$NEW" ] && exit 0
if [ -f "$SKIP_FILE" ] && [ "$(cat "$SKIP_FILE")" = "$NEW" ]; then exit 0; fi

# dist/ è versionata ma la rigenera la build: le sue modifiche locali non contano
git checkout -q -- dist
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  log "modifiche locali non committate in $DIR: aggiornamento saltato"
  exit 1
fi

deps_changed() { ! git diff --quiet "$1" "$2" -- package.json package-lock.json; }

# Dentro un `&&` set -e non vale: ogni passo deve fermare la funzione da sé
build_and_test() {
  if deps_changed "$1" "$2"; then npm ci --no-audit --no-fund || return 1; fi
  npm test || return 1
  git checkout -q -- dist
}

healthy() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null --max-time 3 "$HEALTH_URL"; then return 0; fi
    sleep 2
  done
  return 1
}

log "aggiorno ${OLD:0:7} -> ${NEW:0:7}"
git merge -q --ff-only "origin/$BRANCH"

if build_and_test "$OLD" "$NEW" && pm2 restart "$APP" --update-env >/dev/null && healthy; then
  rm -f "$SKIP_FILE"
  log "ok: ${NEW:0:7} online"
  exit 0
fi

log "ERRORE su ${NEW:0:7}: torno a ${OLD:0:7} e salto questo commit"
echo "$NEW" > "$SKIP_FILE"
git reset -q --hard "$OLD"
if deps_changed "$NEW" "$OLD"; then npm ci --no-audit --no-fund; fi
npm run build
git checkout -q -- dist
pm2 restart "$APP" --update-env >/dev/null
if healthy; then log "ripristinato ${OLD:0:7}"; else log "ATTENZIONE: anche ${OLD:0:7} non risponde su $HEALTH_URL"; fi
exit 1
