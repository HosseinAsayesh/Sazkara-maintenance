# Release build environment: the same Ubuntu and Node major as the production server, so
# the packaged server (and every native module in it) is built where it will run,
# whatever OS the vendor's laptop happens to be on. Used by scripts/release-docker.sh.
FROM ubuntu:24.04

# Keep on the Node 22 line the server installs (deploy/docs/INSTALL.md).
ARG NODE_VERSION=22.23.3

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils 7zip \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    cd /tmp; \
    f="node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${f}"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " ${f}\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "${f}" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f "${f}" SHASUMS256.txt; \
    node -v; 7z i >/dev/null

# The build runs as the host user (so the handover files are theirs), who needs a
# writable HOME for npm's cache and the escrow passwords mounted under it.
RUN mkdir -m 1777 /home/builder
ENV HOME=/home/builder NEXT_TELEMETRY_DISABLED=1
