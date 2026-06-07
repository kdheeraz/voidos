# Run voidOS in a VM (Apple Silicon · UTM)

This boots voidOS as a **real desktop** — the warm AI surface fills the screen,
GPU-accelerated, with a real keyboard. No Docker, no noVNC, no port-publishing.
You talk to it and real Linux app windows open over it.

> Your Mac is an **M1 (arm64)**, so the guest must be **arm64 Linux**. These steps
> use **Debian 13 (trixie) arm64** — its `.deb` Chromium kiosks cleanly (unlike
> Ubuntu's snap Chromium).

## 1. Install UTM (free, M1-native)

```sh
brew install --cask utm
```

## 2. Get the Debian 13 arm64 installer

Download the **arm64 netinst** ISO from <https://www.debian.org/distrib/netinst>
(file looks like `debian-13.x.x-arm64-netinst.iso`).

## 3. Create the VM in UTM

- **+ → Virtualize → Linux**
- Boot ISO: the Debian arm64 `.iso` above
- Memory **4096 MB**, CPU **4 cores**, drive **32 GB**
- ✅ **Enable hardware OpenGL acceleration** (this is the virtio-GPU — it's what
  makes the surface and video smooth)
- Network: **Shared** (default)

## 4. Install Debian (minimal)

Run the installer. When it asks about software:
- **Uncheck** "GNOME / Desktop environment" (voidOS *is* the desktop)
- ✅ Keep **SSH server** and **standard system utilities**

Create any user/password when asked — voidOS installs its own `void` user.
After install, remove the ISO from the VM's drives and boot into Debian.

## 5. Get the voidOS kit into the VM

On your **Mac**, in the project folder, serve the kit:

```sh
cd /Users/mac/projects/voidOs
python3 -m http.server 8000
```

In the **VM** (log in as the user you made), pull and unpack it. UTM's shared
network reaches your Mac at the gateway — usually `192.168.64.1`:

```sh
curl -O http://192.168.64.1:8000/voidos-vm.tar.gz   # if that IP fails: ip route | grep default → use that gateway
tar xzf voidos-vm.tar.gz
cd voidos
sudo bash boot/vm/install.sh
```

The installer asks for your **Ollama API key** (paste it — input is hidden),
installs Node 24 + Python + Chromium + the X session, and wires voidOS to boot
as the desktop. Then:

```sh
sudo reboot
```

## 6. That's it

The VM boots straight into the **voidOS surface**. Type into the bar —
*"play Let Her Go"*, *"open Wikipedia"*, *"build a calculator and host it"* —
and it acts: sites and apps open as real windows on the screen.

---

### Notes
- **Real screen, real keyboard.** Everything you fought in Docker (can't type in
  noVNC, copy, publish ports) is gone — this is a real Linux display.
- **GPU.** With "hardware OpenGL acceleration" on, Chromium renders with the
  virtio-GPU, so YouTube/WebGL/video are smooth (no swiftshader fallback).
- **Audio.** UTM gives the guest a sound device, so unlike the container, audio
  works — songs actually play out loud.
- **Update later.** Re-run `python3 -m http.server` on the Mac, `curl` the new
  tarball in the VM, and `sudo bash boot/vm/install.sh` again — it's idempotent.
- **To get a console** (debugging): switch VTs with `Ctrl+Alt+F2`, log in as
  `void`; logs are `/tmp/void-kernel.log` and `/tmp/void-surface.log`.
