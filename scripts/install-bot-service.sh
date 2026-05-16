#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_FILE="$PROJECT_DIR/scripts/life-quant-bot.service"

echo "==> Life Quant Bot — Systemd Service Installer"
echo ""

# Ensure .env exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "ERROR: .env file not found at $PROJECT_DIR/.env"
  echo "       Create it with: BOT_TOKEN=your_token_here"
  exit 1
fi

# Check which mode to use
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  # Running as root — install system-wide
  echo "Installing as SYSTEM service (requires root)..."

  # Fix paths in service file for system install
  sed "s|/home/ega/tubes/Project-001-Life-Quant-Dashboard|$PROJECT_DIR|g; s|User=ega|User=$(logname 2>/dev/null || echo $SUDO_USER)|g" \
    "$SERVICE_FILE" > /tmp/life-quant-bot.service

  cp /tmp/life-quant-bot.service /etc/systemd/system/life-quant-bot.service
  systemctl daemon-reload
  systemctl enable life-quant-bot.service
  systemctl start life-quant-bot.service

  echo ""
  echo "✅ Service installed and started!"
  echo "   Status: systemctl status life-quant-bot.service"
  echo "   Logs:   journalctl -u life-quant-bot.service -f"
else
  # Not root — install as user service
  echo "Installing as USER service (no root needed)..."

  # Create user systemd dir
  mkdir -p "$HOME/.config/systemd/user"

  # Adapt service file for user mode
  sed "s|/home/ega/tubes/Project-001-Life-Quant-Dashboard|$PROJECT_DIR|g; s|User=.*||; s|WantedBy=multi-user.target|WantedBy=default.target|g; s|ProtectSystem=strict|ProtectSystem=strict|g; s|ProtectHome=read-only|ProtectHome=read-only|g" \
    "$SERVICE_FILE" > "$HOME/.config/systemd/user/life-quant-bot.service"

  systemctl --user daemon-reload
  systemctl --user enable life-quant-bot.service
  systemctl --user start life-quant-bot.service

  echo ""
  echo "✅ User service installed and started!"
  echo "   Status: systemctl --user status life-quant-bot.service"
  echo "   Logs:   journalctl --user -u life-quant-bot.service -f"
  echo ""
  echo "NOTE: For auto-start on boot, you may need:"
  echo "  sudo loginctl enable-linger $(whoami)"
fi
