FROM node:22.23.1-bookworm-slim

ENV HOME=/tmp \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

WORKDIR /opt/videobuddy/voice
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY synth.mjs ./
COPY model ./model
COPY voices ./voices

CMD ["node", "synth.mjs", "/work/job.json"]
