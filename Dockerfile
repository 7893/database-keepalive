FROM cloudflare/cloudflared:2026.9.3 AS tunnel
FROM node:26-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=tunnel /usr/local/bin/cloudflared /usr/local/bin/cloudflared
WORKDIR /app
COPY native/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
COPY scripts/fetch-deps.py /tmp/fetch-deps.py
RUN python3 /tmp/fetch-deps.py /app/vendor
COPY package.json /app/package.json
COPY src/ /app/src/
COPY native/ /app/native/
CMD ["node", "src/runtime/server.js"]
