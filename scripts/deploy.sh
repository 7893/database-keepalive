#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-use}"

echo "=================================================="
echo "🚀 [1/4] Cross-compiling for Linux (x86_64 amd64)..."
mkdir -p bin
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o bin/database-keepalive-linux-amd64 .
echo "  ✓ Static binary generated: bin/database-keepalive-linux-amd64"

echo "📦 [2/4] Uploading binary and configuration to target host [$TARGET]..."
ssh -o ConnectTimeout=10 "$TARGET" "sudo mkdir -p /etc/database-keepalive /var/log/database-keepalive"
scp bin/database-keepalive-linux-amd64 "$TARGET:/tmp/database-keepalive"
ssh "$TARGET" "sudo mv /tmp/database-keepalive /usr/local/bin/database-keepalive && sudo chmod +x /usr/local/bin/database-keepalive"

# Synchronize configuration (preserve remote config unless --force is specified)
if [ "${2:-}" = "--force" ] || ! ssh "$TARGET" "test -f /etc/database-keepalive/config.yaml"; then
  echo "  ✓ Uploading config to $TARGET:/etc/database-keepalive/config.yaml"
  scp config.yaml "$TARGET:/tmp/config.yaml"
  ssh "$TARGET" "sudo mv /tmp/config.yaml /etc/database-keepalive/config.yaml && sudo chmod 600 /etc/database-keepalive/config.yaml"
else
  echo "  ℹ Remote configuration /etc/database-keepalive/config.yaml already exists (use --force to overwrite)"
fi

echo "⚙️ [3/4] Registering and reloading systemd service..."
ssh "$TARGET" "sudo tee /etc/systemd/system/database-keepalive.service > /dev/null << 'EOF'
[Unit]
Description=Database Keepalive Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/etc/database-keepalive
ExecStart=/usr/local/bin/database-keepalive daemon -c /etc/database-keepalive/config.yaml
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable database-keepalive
sudo systemctl restart database-keepalive
"

echo "🔍 [4/4] Verifying systemd service status on target..."
ssh "$TARGET" "sudo systemctl status database-keepalive --no-pager"

echo "=================================================="
echo "🎉 Deployment complete! Service is running persistently on [$TARGET]."
echo "🌐 Dashboard URL: http://$TARGET:8080 (or via Cloudflare Tunnel / SSH port forward)"
echo "=================================================="
