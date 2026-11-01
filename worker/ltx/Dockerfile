# RunPod serverless worker for LTX-2.5 (text/image to video with audio).
# Build context: repository root. Dockerfile path: worker/ltx/Dockerfile
FROM pytorch/pytorch:2.11.0-cuda12.6-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/runpod-volume/hf \
    LTX_MODEL_ID=Lightricks/LTX-2.5-Diffusers \
    LTX_OFFLOAD=none

WORKDIR /app
COPY worker/ltx/requirements.txt .
RUN pip install -r requirements.txt
COPY worker/ltx/handler.py .

CMD ["python", "-u", "handler.py"]
