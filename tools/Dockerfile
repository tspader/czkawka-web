###############
# CZKAWKA CLI #
###############
FROM rust:1.95.0-alpine3.23 AS rust-build

RUN apk add --no-cache \
        bash \
        git

WORKDIR /app
COPY tools/build-czkawka.sh tools/czkawka.patch ./tools/

RUN bash tools/build-czkawka.sh

##########
# SERVER #
##########
FROM oven/bun:alpine AS web-build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/core/package.json ./packages/core/
COPY packages/web/package.json ./packages/web/

RUN bun i --frozen-lockfile

COPY packages/ ./packages/
COPY tsconfig.json ./

RUN cd packages/web && bun run build:docker

#########
# IMAGE #
#########
FROM alpine:3.23

RUN apk add --no-cache \
        ca-certificates \
        ffmpeg \
        libgcc \
        libstdc++ \
        wget

COPY --from=rust-build /app/build/czkawka/target/release/czkawka_cli /usr/local/bin/czkawka_cli
COPY --from=web-build  /app/packages/web/dist/czkawka-web /usr/local/bin/czkawka-web

VOLUME ["/storage"]
WORKDIR /storage
EXPOSE 3000

ENV CZKAWKA_BIN=/usr/local/bin/czkawka_cli
ENV BROWSE_ROOT=/storage
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 || exit 1

CMD ["/usr/local/bin/czkawka-web"]
