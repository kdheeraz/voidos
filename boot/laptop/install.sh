#!/usr/bin/env bash
# voidOS laptop installer — turns an existing Arch Linux install into a voidOS
# machine. voidOS runs as the graphical shell ON TOP OF Arch; Linux provides the
# kernel, drivers, networking, and hardware support.
#
#   sudo bash boot/laptop/install.sh
#
# READ docs/laptop.md FIRST. Try this in a VM or on a spare machine before any
# daily driver — it sets tty1 to autologin into the voidOS desktop.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0"; exit 1; }
command -v pacman >/dev/null || { echo "this targets Arch Linux (pacman not found)"; exit 1; }

SRC="$(cd "$(dirname "$0")/../.." && pwd)"   # repo root
DEST=/opt/voidos
VOID_HOME=/var/lib/voidos

echo "==> packages"
pacman -Sy --needed --noconfirm nodejs npm python python-pip cage chromium wayland seatd curl

echo "==> void user + directories"
id void >/dev/null 2>&1 || useradd -m -G video,input,audio,seat -s /bin/bash void
install -d "$DEST" "$VOID_HOME/.void" /etc/voidos
cp -rT "$SRC/kernel" "$DEST/kernel"
cp -rT "$SRC/mind" "$DEST/mind"
cp -rT "$SRC/ui" "$DEST/ui"
cp "$SRC/package.json" "$SRC/tsconfig.json" "$DEST/"
install -m755 "$SRC/boot/laptop/voidos-session.sh" "$DEST/voidos-session.sh"

echo "==> python venv + deps"
python -m venv "$DEST/.venv"
"$DEST/.venv/bin/pip" install --quiet --upgrade pip
"$DEST/.venv/bin/pip" install --quiet -r "$DEST/mind/requirements.txt"
chown -R void:void "$DEST" "$VOID_HOME"

echo "==> /etc/voidos/env"
if [ ! -f /etc/voidos/env ]; then
  cp "$SRC/boot/laptop/env.example" /etc/voidos/env
  chmod 600 /etc/voidos/env
  echo "    (edit /etc/voidos/env and set OLLAMA_API_KEY)"
fi

echo "==> systemd services"
cp "$SRC/boot/laptop/voidos-kernel.service" "$SRC/boot/laptop/voidos-console.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable seatd.service voidos-kernel.service voidos-console.service

echo "==> autologin void on tty1 -> voidOS desktop"
install -d /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<'EOF'
[Service]
ExecStart=
ExecStart=-/usr/bin/agetty --autologin void --noclear %I $TERM
EOF
cat > /home/void/.bash_profile <<'EOF'
# Launch the voidOS desktop on the main console; other TTYs stay normal shells.
if [ "$(tty)" = "/dev/tty1" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  set -a; . /etc/voidos/env; set +a
  exec /opt/voidos/voidos-session.sh
fi
EOF
chown void:void /home/void/.bash_profile

systemctl daemon-reload
echo
echo "voidOS installed."
echo "  1. set OLLAMA_API_KEY in /etc/voidos/env   (or set OLLAMA_HOST for local ollama)"
echo "  2. reboot  ->  the machine boots into the voidOS desktop"
echo
echo "Escape hatch: switch to a normal shell with Ctrl+Alt+F2 (tty2)."
echo "Uninstall: systemctl disable --now voidos-console voidos-kernel; rm the units + autologin drop-in."
