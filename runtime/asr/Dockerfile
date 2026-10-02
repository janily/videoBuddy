FROM python:3.11-slim-bookworm@sha256:2333bd330d12de02514770b3585cad313644316047cdee24a7acfdece6de6efb

ENV HOME=/tmp \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /opt/videobuddy/asr
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY transcribe.py ./
COPY model ./model

CMD ["python3", "/opt/videobuddy/asr/transcribe.py", "/work/job.json"]
