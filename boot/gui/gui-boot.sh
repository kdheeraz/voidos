#!/usr/bin/env bash
# voidOS GUI boot: bring up a virtual display + VNC→noVNC bridge, then voidOS.
# Native X11/Qt apps (VLC, etc.) run on :99 and stream into the /os "Screen"
# window via noVNC on :6080. The X stack runs as the non-root 'gui' user.
export DISPLAY=:99
mkdir -p /tmp/voidgui

runuser -u gui -- Xvfb :99 -screen 0 1280x800x24 -ac > /tmp/voidgui/xvfb.log 2>&1 &
for _ in $(seq 1 30); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.3; done

runuser -u gui -- env DISPLAY=:99 openbox > /tmp/voidgui/openbox.log 2>&1 &
sleep 0.5
runuser -u gui -- env DISPLAY=:99 x11vnc -display :99 -forever -shared -nopw -quiet -rfbport 5900 > /tmp/voidgui/x11vnc.log 2>&1 &
sleep 1
# target 127.0.0.1 (IPv4) explicitly — "localhost" resolves to IPv6 ::1 first,
# but x11vnc binds IPv4 only, which gives a noVNC "failed to connect".
websockify --web /usr/share/novnc 6080 127.0.0.1:5900 > /tmp/voidgui/novnc.log 2>&1 &

# a terminal so the Screen isn't empty on first open
runuser -u gui -- env DISPLAY=:99 xclock -geometry 180x180+780+40 > /dev/null 2>&1 &
runuser -u gui -- env DISPLAY=:99 xterm -geometry 92x26+24+24 > /dev/null 2>&1 &

# hand off to voidOS (kernel + mind + /os desktop)
exec python3 /opt/voidos/boot/voidinit.py
