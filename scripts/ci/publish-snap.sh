#!/usr/bin/env bash
set -euo pipefail

snap_path="${1:?snap path required}"
release_channel="${2:-stable}"
ci_user="$(id -un)"

if [ ! -f "${snap_path}" ]; then
    echo "::error::Snap artifact not found: ${snap_path}" >&2
    exit 1
fi

if [ -z "${SNAPCRAFT_STORE_CREDENTIALS:-}" ]; then
    echo "::error::SNAPCRAFT_STORE_CREDENTIALS is required to publish a snap." >&2
    exit 1
fi

sudo -u "${ci_user}" -E snapcraft upload "${snap_path}" --release "${release_channel}"
