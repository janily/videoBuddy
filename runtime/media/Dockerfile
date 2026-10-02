FROM node:22.23.1-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    HOME=/tmp

ARG APT_PROXY
RUN if [ -n "$APT_PROXY" ]; then printf 'Acquire::http::Proxy "%s";\n' "$APT_PROXY" > /etc/apt/apt.conf.d/99proxy; fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-cjk python3 \
    && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99proxy

WORKDIR /opt/videobuddy
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY render.mjs runner.py analyze-pdf.mjs ./

CMD ["python3", "/opt/videobuddy/runner.py"]
