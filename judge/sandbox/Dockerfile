FROM python:3.12-slim
RUN pip install --no-cache-dir pytest==8.3.4 && useradd -m runner
USER runner
WORKDIR /work
