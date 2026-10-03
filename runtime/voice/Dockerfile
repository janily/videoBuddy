FROM node:22.23.1-bookworm-slim AS node-runtime
ENV HOME=/tmp \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1
WORKDIR /opt/videobuddy/voice
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM python:3.11-slim-bookworm@sha256:2333bd330d12de02514770b3585cad313644316047cdee24a7acfdece6de6efb

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node --version

ENV HOME=/tmp \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

WORKDIR /opt/videobuddy/voice
RUN python3 -m venv /opt/videobuddy/phonemizer
ENV PATH="/opt/videobuddy/phonemizer/bin:${PATH}"
COPY build-requirements.txt requirements.txt ./
RUN python3 -m pip install --no-cache-dir --require-hashes -r build-requirements.txt \
    && python3 -m pip install --no-cache-dir --no-build-isolation --require-hashes -r requirements.txt \
    && python3 -m pip check
COPY --from=node-runtime /opt/videobuddy/voice/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY synth.mjs generate.mjs phonemize.py ./
COPY test ./test
RUN --network=none node --test test/phonemes.test.mjs
COPY model ./model
COPY voices ./voices

CMD ["node", "synth.mjs", "/work/job.json"]
