#!/bin/sh
# Runs the Claude Deck hook. Hook shells are not always initialised with nvm, so a
# node binary is looked up under ~/.nvm when `node` is missing from PATH.
if ! command -v node >/dev/null 2>&1; then
  for d in "$HOME"/.nvm/versions/node/*/bin; do
    [ -x "$d/node" ] && PATH="$d:$PATH"
  done
  export PATH
fi
exec node "$(dirname "$0")/claude-deck-hook.mjs" "$@"
