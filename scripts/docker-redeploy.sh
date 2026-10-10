#!/usr/bin/env bash
#
# One-click: rebuild the GopherAgent image and start a fresh container.
# The old container keeps running if the build fails.
#
# Usage:
#   ./scripts/docker-redeploy.sh
#   HOST_PORT=80 ./scripts/docker-redeploy.sh
#   TARGET=backend CONTAINER_PORT=9899 HOST_PORT=9899 ./scripts/docker-redeploy.sh
#
# Overridable env vars:
#   IMAGE            image tag                 (default: gopher-agent)
#   CONTAINER        container name            (default: gopher-agent)
#   HOST_PORT        host port to publish      (default: 8080)
#   CONTAINER_PORT   container port to expose  (default: 80)
#   DATA_VOLUME      data volume name          (default: gopher-data)
#   TZ_NAME          container timezone        (default: Asia/Shanghai)
#   CONFIG_FILE      host config.json mounted read-only at /data/config.json
#                    (default: /etc/gopher/config.json; set to "" to skip)
#   TARGET           Docker build target       (default: "" = all-in-one runtime)
#   BUILD_ARGS       extra `docker build` args (word-split)
#   RUN_ARGS         extra `docker run` args   (word-split)
set -euo pipefail

IMAGE="${IMAGE:-gopher-agent}"
CONTAINER="${CONTAINER:-gopher-agent}"
HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_PORT="${CONTAINER_PORT:-80}"
DATA_VOLUME="${DATA_VOLUME:-gopher-data}"
TZ_NAME="${TZ_NAME:-Asia/Shanghai}"
CONFIG_FILE="${CONFIG_FILE:-/etc/gopher/config.json}"
TARGET="${TARGET:-}"
# shellcheck disable=SC2206
BUILD_ARGS=(${BUILD_ARGS:-})
# shellcheck disable=SC2206
RUN_ARGS=(${RUN_ARGS:-})

# Run from the repository root regardless of where the script is invoked.
cd "$(dirname "$0")/.."

green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
red() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*" >&2; }

if ! command -v docker >/dev/null 2>&1; then
    red "error: docker not found in PATH"
    exit 1
fi

green "==> 1/3  Building image '${IMAGE}'${TARGET:+ (target: ${TARGET})}"
build=(docker build -t "$IMAGE")
[ -n "$TARGET" ] && build+=(--target "$TARGET")
[ "${#BUILD_ARGS[@]}" -gt 0 ] && build+=("${BUILD_ARGS[@]}")
build+=(.)
"${build[@]}"

green "==> 2/3  Recreating container '${CONTAINER}'"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

green "==> 3/3  Starting container (${HOST_PORT} -> ${CONTAINER_PORT}, volume: ${DATA_VOLUME})"
run=(
    docker run -d
    --name "$CONTAINER"
    -p "${HOST_PORT}:${CONTAINER_PORT}"
    -v "${DATA_VOLUME}:/data"
    -e "TZ=${TZ_NAME}"
    --restart unless-stopped
)
# Mount an operator-supplied config.json read-only at the data root. It overlays
# the embedded defaults / SQLite and is the recommended home for Redis
# credentials. Skipped (with a warning) when the file is absent so that docker
# does not create a *directory* in its place.
if [ -n "$CONFIG_FILE" ]; then
    if [ -f "$CONFIG_FILE" ]; then
        run+=(-v "${CONFIG_FILE}:/data/config.json:ro")
    else
        warn "warning: CONFIG_FILE '${CONFIG_FILE}' not found; mount skipped (container will use env vars / DB / built-in defaults)."
    fi
fi
[ "${#RUN_ARGS[@]}" -gt 0 ] && run+=("${RUN_ARGS[@]}")
run+=("$IMAGE")
"${run[@]}"

echo
docker ps --filter "name=^/${CONTAINER}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo
green "Done.  http://<server-ip>:${HOST_PORT}"
echo "Logs:   docker logs -f ${CONTAINER}"
