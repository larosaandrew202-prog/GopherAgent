# syntax=docker/dockerfile:1
#
# GopherAgent — multi-stage build on Ubuntu.
#
#   * web-builder : Ubuntu + Node  -> builds web/dist (same-origin API)
#   * go-builder  : Ubuntu + Go    -> builds the static gopheragent binary
#   * backend     : Ubuntu runtime with just the binary (target: `backend`)
#   * runtime     : Ubuntu + nginx, serves the SPA and proxies the API (default)
#
# Build:  docker build -t gopher-agent .
# Run:    docker run -d --name gopher-agent -p 8080:80 -v gopher-data:/data gopher-agent
# Backend only:  docker build --target backend -t gopher-agent-backend .

ARG UBUNTU_VERSION=24.04

# ---------------------------------------------------------------------------
# 1) Frontend (React + Vite)
# ---------------------------------------------------------------------------
FROM ubuntu:${UBUNTU_VERSION} AS web-builder
ARG NODE_VERSION=20.18.1
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz

WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Drop the local dev env so the build targets the same origin (/api, /message …),
# and turn off the mock layer so it talks to the real backend.
RUN rm -f .env.local .env.*.local \
 && VITE_USE_MOCK=false npm run build

# ---------------------------------------------------------------------------
# 2) Backend (Go, pure-Go SQLite → CGO off)
# ---------------------------------------------------------------------------
FROM ubuntu:${UBUNTU_VERSION} AS go-builder
ARG GO_VERSION=1.25.3
ARG VERSION=dev
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz \
 && tar -xzf /tmp/go.tgz -C /usr/local \
 && rm /tmp/go.tgz

ENV PATH="/usr/local/go/bin:${PATH}" \
    GOPATH=/go \
    GOCACHE=/go/cache \
    CGO_ENABLED=0

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags "-s -w -X GopherAgent/internal/controller/api.VersionString=${VERSION}" -o /out/gopheragent .

# ---------------------------------------------------------------------------
# 3a) Backend-only runtime (no nginx) — build with `--target backend`
# ---------------------------------------------------------------------------
FROM ubuntu:${UBUNTU_VERSION} AS backend
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=go-builder /out/gopheragent /app/gopheragent
RUN mkdir -p /app/manifest/config \
 && printf 'server:\n  openapiPath: "/api.json"\n  swaggerPath: "/swagger"\nlogger:\n  level: "all"\n  stdout: true\n' > /app/manifest/config/config.yaml
ENV GOPHER_DATA_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 9899
ENTRYPOINT ["/app/gopheragent"]

# ---------------------------------------------------------------------------
# 3b) Runtime: Ubuntu + nginx — serves the SPA and reverse-proxies the API (default)
# ---------------------------------------------------------------------------
FROM ubuntu:${UBUNTU_VERSION} AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata nginx curl \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/nginx/sites-enabled/default

WORKDIR /app
COPY --from=go-builder /out/gopheragent /app/gopheragent
RUN mkdir -p /app/manifest/config \
 && printf 'server:\n  openapiPath: "/api.json"\n  swaggerPath: "/swagger"\nlogger:\n  level: "all"\n  stdout: true\n' > /app/manifest/config/config.yaml
COPY --from=web-builder /src/web/dist /var/www/gopher-agent
COPY docker/nginx.conf /etc/nginx/conf.d/gopher-agent.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV GOPHER_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:9899/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
