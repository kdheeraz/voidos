#!/usr/bin/env bash
# voidOS graphical session: a Wayland kiosk that shows the voidOS desktop
# fullscreen — no browser chrome, no login, the desktop IS the machine.
# Launched on tty1 autologin (see install.sh).
set -e

URL="http://localhost:${VOID_UI_PORT:-7777}/os"

# wait for the Console to come up
for _ in $(seq 1 60); do
  if curl -fsS "$URL" >/dev/null 2>&1; then break; fi
  sleep 1
done

# cage = a single-app Wayland compositor (kiosk). chromium in --kiosk app mode.
exec cage -- chromium \
  --kiosk --app="$URL" \
  --ozone-platform=wayland \
  --no-first-run --disable-translate --disable-features=TranslateUI \
  --user-data-dir="${VOID_ROOT:-/var/lib/voidos}/.chromium"
