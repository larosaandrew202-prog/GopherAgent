#!/usr/bin/env sh
set -eu

# The data directory holds the SQLite database and the agent workspace.
# Mount a volume here to persist them across restarts.
export GOPHER_DATA_DIR="${GOPHER_DATA_DIR:-/data}"
mkdir -p "$GOPHER_DATA_DIR"

echo "[entrypoint] GopherAgent backend -> :9899 (data: $GOPHER_DATA_DIR)"
/app/gopheragent &
backend_pid=$!

echo "[entrypoint] nginx -> :80"
nginx -g 'daemon off;' &
nginx_pid=$!

# Forward termination to both children.
trap 'kill -TERM "$backend_pid" "$nginx_pid" 2>/dev/null || true; exit 0' TERM INT

# Keep the container alive for as long as nginx runs.
wait "$nginx_pid"
kill -TERM "$backend_pid" 2>/dev/null || true
