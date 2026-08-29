# Builds a WSL2-importable root filesystem: Ubuntu + OpenFOAM (Foundation, from
# the official apt repo). `docker export` of a container started from this image
# IS the rootfs tarball that `wsl --import` consumes.
#
# We do NOT compile OpenFOAM here - the apt packages are the exact binaries the
# OpenFOAM Foundation publishes. Switch to a trimmed source build later only if
# the pack size becomes a problem.
#
#   docker build --build-arg OPENFOAM_VERSION=13 -t opencfd-foam docker/foam-pack

ARG UBUNTU_VERSION=22.04
FROM ubuntu:${UBUNTU_VERSION}

ARG OPENFOAM_VERSION=13
# The OpenFOAM apt repo is published per Ubuntu codename. Confirm the codename
# for your base image is carried by dl.openfoam.org before a real run.
ARG UBUNTU_CODENAME=jammy
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg wget sudo locales tzdata \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://dl.openfoam.org/gpg.key \
      | gpg --dearmor -o /usr/share/keyrings/openfoam.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/openfoam.gpg] http://dl.openfoam.org/ubuntu ${UBUNTU_CODENAME} main" \
      > /etc/apt/sources.list.d/openfoam.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends "openfoam${OPENFOAM_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

# Auto-source the OpenFOAM environment for any login shell (handy for debugging;
# the backend also sources it explicitly).
RUN printf '%s\n' \
      'for f in /opt/openfoam*/etc/bashrc; do [ -r "$f" ] && . "$f"; done' \
      > /etc/profile.d/openfoam.sh

# WSL runs this appliance as root - no interactive user needed.
RUN printf '%s\n' \
      '[boot]' 'systemd=false' \
      '[user]' 'default=root' \
      '[interop]' 'enabled=true' 'appendWindowsPath=false' \
      > /etc/wsl.conf

# Trim what a headless solver never needs (keeps the export smaller).
RUN rm -rf \
      /opt/openfoam*/tutorials \
      /opt/openfoam*/doc \
      /usr/share/doc/* \
      /var/cache/apt/* \
      /tmp/*

# Smoke-test the build fails loudly if simpleFoam is not runnable.
RUN bash -lc 'simpleFoam -help >/dev/null 2>&1 || (echo "simpleFoam missing" && exit 1)'

CMD ["/bin/bash"]
