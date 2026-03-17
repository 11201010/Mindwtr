#!/usr/bin/env bash
set -euo pipefail

ci_user="$(id -un)"
snapcraft_channel="${SNAPCRAFT_CHANNEL:-stable}"

sudo groupadd --force --system lxd
sudo usermod --append --groups lxd "${ci_user}"

if snap list lxd >/dev/null 2>&1; then
    sudo snap refresh lxd
else
    sudo snap install lxd
fi

sudo lxd init --auto
if command -v iptables >/dev/null 2>&1; then
    sudo iptables -P FORWARD ACCEPT || true
fi

if snap list snapcraft >/dev/null 2>&1; then
    sudo snap refresh --channel "${snapcraft_channel}" snapcraft
else
    sudo snap install --channel "${snapcraft_channel}" --classic snapcraft
fi

sudo -u "${ci_user}" -E snapcraft --enable-manifest

snap_path="$(find . -maxdepth 1 -type f -name '*.snap' | sort | tail -n 1)"
if [ -z "${snap_path}" ]; then
    echo "::error::Snap build finished without producing a .snap artifact." >&2
    exit 1
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'snap=%s\n' "${snap_path}" >> "${GITHUB_OUTPUT}"
fi

echo "Built snap: ${snap_path}"
