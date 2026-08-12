ARG OPENCODE_IMAGE=ghcr.io/anomalyco/opencode:latest
FROM ${OPENCODE_IMAGE}

USER root

RUN apk add --no-cache git nodejs npm \
    && printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/xdg-open \
    && chmod +x /usr/local/bin/xdg-open
