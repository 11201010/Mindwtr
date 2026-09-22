#!/bin/sh
set -eu

# Expo may recreate ios/, so run the bootstrap from outside the generated folder.
cd "${CI_PRIMARY_REPOSITORY_PATH:?Xcode Cloud must provide the repository path}"
exec bash scripts/ci/xcode-cloud-post-clone.sh
