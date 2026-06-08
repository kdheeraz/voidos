#!/usr/bin/env bash
# voidOS — VM installer. Turns a fresh Debian 13 (arm64) VM into voidOS:
# boots straight into the warm AI surface as the *real* desktop (GPU-accelerated,
# real keyboard, no Docker / noVNC). Run inside the VM:  sudo bash boot/vm/install.sh
set -euo pipefail

# `su` (without -) leaves /usr/sbin out of PATH, hiding useradd/usermod/agetty.
export PATH=/usr/sbin:/sbin:/usr/bin:/bin:$PATH

[ "$(id -u)" -eq 0 ] || { echo "run as root: su - , then bash boot/vm/install.sh"; exit 1; }

# repo root = two levels up from this script (boot/vm/install.sh)
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$SRC/kernel/src/index.ts" ] || { echo "can't find voidOS source at $SRC (run from the extracted kit)"; exit 1; }

VOID_USER=void

echo "==> [1/7] system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg sudo \
  python3 python3-pip \
  xserver-xorg xinit openbox x11-xserver-utils wmctrl tint2 picom \
  chromium \
  fonts-inter fonts-dejavu-core mesa-utils

echo "==> [2/7] Node 24 (runs the TS kernel via native type-stripping)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 23 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

echo "==> [3/7] Python deps (the mind) + yt-dlp"
pip3 install --no-cache-dir --break-system-packages -r "$SRC/mind/requirements.txt"
pip3 install --no-cache-dir --break-system-packages yt-dlp

echo "==> [4/7] install voidOS source to /opt/voidos"
install -d /opt/voidos
cp -r "$SRC"/kernel "$SRC"/mind "$SRC"/ui "$SRC"/boot "$SRC"/package.json "$SRC"/tsconfig.json /opt/voidos/

echo "==> [5/7] the void user + rootfs"
id "$VOID_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$VOID_USER"
usermod -aG video,render,input "$VOID_USER" 2>/dev/null || true
# let the AI install apps on demand (gui-run → apt) without a password prompt
echo "$VOID_USER ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/local/bin/void-block, /usr/local/bin/void-unblock" > /etc/sudoers.d/voidos
chmod 440 /etc/sudoers.d/voidos
# let the AI set system time/zone via timedatectl without hanging on a polkit auth prompt
install -d /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/49-voidos-timedate.rules <<'POLKIT'
polkit.addRule(function(action, subject) {
  if (action.id.indexOf("org.freedesktop.timedate1.") === 0 && subject.user === "void") {
    return polkit.Result.YES;
  }
});
POLKIT
mkdir -p /var/void/.void
chown -R "$VOID_USER":"$VOID_USER" /var/void

echo "==> [6/7] launch helpers (open sites / play media on the real screen)"
cat > /usr/local/bin/void-web <<'EOF'
#!/bin/sh
# Open a URL as its own window on the voidOS desktop (real GPU here — no swiftshader).
url="${1:-about:blank}"
setsid chromium --app="$url" --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$HOME/.cr" </dev/null >/dev/null 2>&1 &
EOF
cat > /usr/local/bin/void-youtube <<'EOF'
#!/bin/sh
q="$*"; [ -z "$q" ] && { echo "usage: void-youtube <search>"; exit 1; }
id=$(yt-dlp --no-warnings --flat-playlist --get-id "ytsearch1:$q" 2>/dev/null | head -n1)
[ -n "$id" ] && exec void-web "https://www.youtube.com/watch?v=$id" \
              || exec void-web "https://www.youtube.com/results?search_query=$(printf '%s' "$q" | tr ' ' '+')"
EOF
cat > /usr/local/bin/gui-run <<'EOF'
#!/bin/sh
# Launch an installed app on the desktop (apt-get install -y <pkg> first if missing).
[ -z "$1" ] && { echo "usage: gui-run <app> [args]"; exit 1; }
setsid "$@" </dev/null >/dev/null 2>&1 &
EOF
chmod +x /usr/local/bin/void-web /usr/local/bin/void-youtube /usr/local/bin/gui-run
# domain block/unblock helpers (run by the mind via the narrow sudoers rule above)
cp "$SRC/boot/vm/void-block" "$SRC/boot/vm/void-unblock" /usr/local/bin/
chmod 755 /usr/local/bin/void-block /usr/local/bin/void-unblock

echo "==> [7/7] environment, autologin, and the boot-to-surface X session"

# --- environment (API key + the desktop AI's behavior) ---
KEY="${OLLAMA_API_KEY:-}"
if [ -z "$KEY" ]; then
  printf "\nPaste your Ollama API key (input hidden): "
  read -rs KEY; echo
fi
cat > /etc/voidos.env <<EOF
OLLAMA_API_KEY=$KEY
VOID_ROOT=/var/void
VOID_SOCK=/var/void/.void/void.sock
VOID_POLICY=guarded
VOID_MODEL=${VOID_MODEL:-gpt-oss:120b}
VOID_UI_HOST=127.0.0.1
PYTHONUNBUFFERED=1
VOID_SYSTEM='You are voidOS on a real Debian Linux desktop, running as the void user with broad rights. Act by running commands via shell.exec and your file/network capabilities directly — you do NOT need an operator token for ordinary tasks, and never just hand the user a URL. System admin: set the timezone with `timedatectl set-timezone <Area/City>` (no sudo — e.g. timedatectl set-timezone Asia/Kolkata); the clock is NTP-synced so never set the wall time by hand; use sudo only with apt-get to install packages; do not change the TZ env var to set the timezone. To block outgoing access to a domain run `sudo void-block <domain>` (re-allow with `sudo void-unblock <domain>`). To open a website: void-web <url>. To play a song or video: void-youtube "<search>". To open an installed app: gui-run <app> (sudo apt-get install -y <package> first if missing). To build and host a web app: write the files with fs.write, host the folder with net.serve on port 8080, then open it with void-web http://localhost:8080. Always run the steps yourself; reply with one short warm line about what you did.'
EOF
# the X session runs as `void` and sources this file (`. /etc/voidos.env`), so
# void must be able to read it — and VOID_SYSTEM above must be single-quoted, or
# `.` parses its spaces/parens as shell and dash aborts the whole session.
chown root:"$VOID_USER" /etc/voidos.env
chmod 640 /etc/voidos.env

# --- let startx open the console when launched from autologin (else: blank cursor) ---
printf 'allowed_users=anybody\nneeds_root_rights=yes\n' > /etc/X11/Xwrapper.config

# --- the X session: kernel + surface + the fullscreen AI surface as the desktop ---
cat > /home/$VOID_USER/.xinitrc <<'EOF'
#!/bin/sh
set -a; . /etc/voidos.env; set +a
export HOME=/home/void
openbox &
# the virtio-GPU boots at a low mode; raise it to 4K so the surface is crisp
xrandr --output Virtual-1 --mode 3840x2160 2>/dev/null
# compositor (real transparency for the dock) + the dock (top-center, shows open apps)
picom --config "$HOME/.config/picom.conf" >/dev/null 2>&1 &
( sleep 2; tint2 >/dev/null 2>&1 ) &
# voidOS kernel (the AI capability gate)
node /opt/voidos/kernel/src/index.ts >/tmp/void-kernel.log 2>&1 &
for _ in $(seq 1 40); do [ -S "$VOID_SOCK" ] && break; sleep 0.3; done
# the surface server (serves /her + the companion mind that opens apps)
python3 /opt/voidos/ui/server.py >/tmp/void-surface.log 2>&1 &
for _ in $(seq 1 40); do
  node -e "require('net').connect(7777,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null && break
  sleep 0.3
done
rm -f "$HOME"/.cr-shell/Singleton* 2>/dev/null
# the warm AI surface, fullscreen, AS the desktop (real GPU — hardware WebGL)
exec chromium --class=voidos --force-device-scale-factor=2 --app=http://localhost:7777/her \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$HOME/.cr-shell"
EOF
chown "$VOID_USER":"$VOID_USER" /home/$VOID_USER/.xinitrc

# --- openbox: the surface (launched with --class=voidos) is a borderless, maximized,
#     BELOW-layer desktop so app windows open OVER it; keep minimize; Super+W / Alt+grave
#     pop a list of all windows (incl. minimized) to restore; bigger chrome for 4K ---
install -d /home/$VOID_USER/.config/openbox
RC=/home/$VOID_USER/.config/openbox/rc.xml
cp /etc/xdg/openbox/rc.xml "$RC"
sed -i 's#</applications>#  <application class="*oidos*"><decor>no</decor><maximized>true</maximized><layer>below</layer><focus>yes</focus></application>\n</applications>#' "$RC"
sed -i 's#</keyboard>#  <keybind key="W-w"><action name="ShowMenu"><menu>client-list-combined-menu</menu></action></keybind>\n  <keybind key="A-grave"><action name="ShowMenu"><menu>client-list-combined-menu</menu></action></keybind>\n</keyboard>#' "$RC"
sed -i 's#<size>8</size>#<size>15</size>#g' "$RC"
# the dock (top-center, icon-only) + compositor config (real transparency)
install -d /home/$VOID_USER/.config/tint2
cp "$SRC/boot/vm/tint2rc" /home/$VOID_USER/.config/tint2/tint2rc
cp "$SRC/boot/vm/picom.conf" /home/$VOID_USER/.config/picom.conf
chown -R "$VOID_USER":"$VOID_USER" /home/$VOID_USER/.config

# --- start X automatically on login at the console ---
cat > /home/$VOID_USER/.bash_profile <<'EOF'
[ "$(tty)" = "/dev/tty1" ] && [ -z "$DISPLAY" ] && exec startx
EOF
chown "$VOID_USER":"$VOID_USER" /home/$VOID_USER/.bash_profile

# --- autologin the void user on tty1 (no password prompt → boots to the surface) ---
install -d /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $VOID_USER --noclear %I \$TERM
EOF
systemctl daemon-reload
systemctl set-default graphical.target >/dev/null 2>&1 || true

echo
echo "  ✓ voidOS installed.  Reboot and it boots straight into the surface:"
echo "      sudo reboot"
