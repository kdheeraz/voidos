#!/usr/bin/env bash
# voidOS — the AI-first desktop. The warm AI surface IS the screen; you talk to
# it and real Linux app windows open over it (openbox manages those windows).
# No terminal, no dock. Previewed over noVNC (:6080); on hardware = the real screen.
export DISPLAY=:99
mkdir -p /tmp/voidgui

Xvfb :99 -screen 0 1280x800x24 -ac > /tmp/voidgui/xvfb.log 2>&1 &
for _ in $(seq 1 30); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.3; done

openbox > /tmp/voidgui/openbox.log 2>&1 &
sleep 0.5

# voidOS kernel (the AI capability gate)
node /opt/voidos/kernel/src/index.ts > /tmp/voidgui/kernel.log 2>&1 &
for _ in $(seq 1 40); do [ -S /var/void/.void/void.sock ] && break; sleep 0.3; done

# the surface server (serves /her + the companion mind that can open apps)
python3 /opt/voidos/ui/server.py > /tmp/voidgui/console.log 2>&1 &
for _ in $(seq 1 40); do
  node -e "require('net').connect(7777,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null && break
  sleep 0.3
done

# the AI surface, fullscreen, AS the desktop (clear any stale profile lock first)
rm -f /home/gui/.cr-shell/Singleton* /home/gui/.cr/Singleton* 2>/dev/null
runuser -u gui -- env DISPLAY=:99 HOME=/home/gui chromium \
  --no-sandbox --disable-dev-shm-usage --use-gl=angle --use-angle=swiftshader \
  --autoplay-policy=no-user-gesture-required --kiosk --app=http://localhost:7777/her \
  --user-data-dir=/home/gui/.cr-shell > /tmp/voidgui/shell.log 2>&1 &

# preview bridge (real screen on hardware)
x11vnc -display :99 -forever -shared -nopw -quiet -rfbport 5900 > /tmp/voidgui/x11vnc.log 2>&1 &
sleep 1
websockify --web /usr/share/novnc 6080 127.0.0.1:5900 > /tmp/voidgui/novnc.log 2>&1 &

exec sleep infinity
