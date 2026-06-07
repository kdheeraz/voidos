# voidOS as a bootable container image.
# PID 1 is voidinit, which brings up the kernel and hands the machine to the mind.
# Build from the repo root:  docker build -t voidos:dev -f boot/Dockerfile .

FROM node:24-bookworm-slim

# Node (>=23.6) runs the TS kernel via native type-stripping; Python runs the mind.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/voidos

COPY package.json tsconfig.json ./
COPY kernel ./kernel
COPY mind ./mind
COPY ui ./ui
COPY boot ./boot

# Single-purpose image: install the mind's deps system-wide.
RUN pip3 install --no-cache-dir --break-system-packages -r mind/requirements.txt

# Rootfs and control plane live outside the read-only code tree.
ENV VOID_ROOT=/var/void \
    VOID_SOCK=/var/void/.void/void.sock \
    VOID_POLICY=guarded \
    PYTHONUNBUFFERED=1
RUN mkdir -p /var/void/.void

# voidOS *is* the init. No shell, no login — the mind owns the session.
ENTRYPOINT ["python3", "boot/voidinit.py"]
