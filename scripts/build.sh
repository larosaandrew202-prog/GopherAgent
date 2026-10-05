#!/usr/bin/env bash
# Build GopherAgent into standalone binaries (pure Go, CGO disabled).
#
# Usage:
#   ./scripts/build.sh                 # native build -> ./gopheragent
#   ./scripts/build.sh all             # cross-compile matrix -> ./dist/
#   ./scripts/build.sh linux amd64     # single target -> ./dist/
#   VERSION=1.2.3 ./scripts/build.sh all
#
# The version is injected into internal/controller/api.VersionString and is
# returned by GET /api/version.
set -euo pipefail

VERSION="${VERSION:-0.2.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export CGO_ENABLED=0
LDFLAGS="-s -w -X 'GopherAgent/internal/controller/api.VersionString=${VERSION}'"

build_target() {
  local os="$1" arch="$2" ext=""
  [ "$os" = "windows" ] && ext=".exe"
  echo "Building ${os}/${arch} -> dist/gopheragent-${os}-${arch}${ext}"
  GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags "$LDFLAGS" \
    -o "dist/gopheragent-${os}-${arch}${ext}" .
}

mkdir -p dist

case "${1:-native}" in
  native)
    echo "Building native -> gopheragent"
    go build -trimpath -ldflags "$LDFLAGS" -o gopheragent .
    ;;
  all)
    build_target linux   amd64
    build_target linux   arm64
    build_target windows amd64
    build_target darwin  arm64
    ;;
  *)
    if [ "$#" -ne 2 ]; then
      echo "usage: $0 [native|all|<os> <arch>]" >&2
      exit 1
    fi
    build_target "$1" "$2"
    ;;
esac

echo "Done."
