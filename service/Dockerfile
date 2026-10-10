FROM cloudflare/cloudflared:2026.9.3 AS tunnel
FROM node:26-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=tunnel /usr/local/bin/cloudflared /usr/local/bin/cloudflared
WORKDIR /app
COPY bridge/requirements.txt bridge/requirements-mysql.txt /tmp/
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir \
    -r /tmp/requirements.txt -r /tmp/requirements-mysql.txt
COPY job/vendor/ /app/vendor/
COPY package.json /app/package.json
COPY src/ /app/src/
COPY bridge/db.py bridge/mysql_db.py /app/bridge/
COPY job/run.mjs /app/job/run.mjs
COPY service/ /app/service/
CMD ["node", "service/server.mjs"]
