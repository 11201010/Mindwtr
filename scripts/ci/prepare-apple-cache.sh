#!/bin/bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
: "${GITHUB_ENV:?}" "${GITHUB_PATH:?}" "${RUNNER_TEMP:?}"

cache_root="$RUNNER_TEMP/mindwtr-native"
if [ "${RUNNER_ENVIRONMENT:-}" = self-hosted ]; then
  # Preserve installed dependencies and their mtimes, but remove all other
  # untracked/ignored files so deleted sources and local config cannot leak in.
  git clean -ffdx -e node_modules/
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  echo "DEVELOPER_DIR=$DEVELOPER_DIR" >> "$GITHUB_ENV"
  cache_root="$HOME/Library/Caches/MindwtrNativeCI"
  gem_home="$HOME/.local/share/gems/ruby-3.3"
  mkdir -p "$gem_home"
  echo "GEM_HOME=$gem_home" >> "$GITHUB_ENV"
  echo "GEM_PATH=$gem_home" >> "$GITHUB_ENV"
  echo "$gem_home/bin" >> "$GITHUB_PATH"
  # This account has no desktop login, so Watchman's LaunchAgent cannot start.
  watchman --no-site-spawner get-sockname >/dev/null
fi

# Keep Swift/Xcode intermediates outside checkout cleanup, separated by compiler.
xcode_id="$(xcodebuild -version | shasum -a 256 | cut -c 1-16)"
cache_root="$cache_root/$xcode_id"
mkdir -p "$cache_root/swift" "$cache_root/simulator" "$cache_root/archive"
echo "MINDWTR_NATIVE_CACHE=$cache_root" >> "$GITHUB_ENV"
echo "MINDWTR_SWIFT_CACHE=$cache_root/swift" >> "$GITHUB_ENV"
echo 'LANG=en_US.UTF-8' >> "$GITHUB_ENV"
echo 'LC_ALL=en_US.UTF-8' >> "$GITHUB_ENV"
