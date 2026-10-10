FROM node:26-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless python3 python3-venv ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY bridge/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
COPY job/vendor/ /app/vendor/
COPY package.json /app/package.json
COPY src/ /app/src/
COPY bridge/db.py /app/bridge/db.py
COPY job/run.mjs job/db2_checkin.py /app/job/
CMD ["node", "job/run.mjs"]
