#!/usr/bin/env bash
set -euo pipefail

ruby_minor_version="${1:-3.3}"
runner_tool_cache="${RUNNER_TOOL_CACHE:-/Users/runner/hostedtoolcache}"
selected_bin=""

declare -a candidates=(
    "/opt/homebrew/opt/ruby@${ruby_minor_version}/bin"
    "/usr/local/opt/ruby@${ruby_minor_version}/bin"
)

if command -v ruby >/dev/null 2>&1; then
    candidates+=("$(dirname "$(command -v ruby)")")
fi

shopt -s nullglob
for bin_dir in \
    "${runner_tool_cache}"/Ruby/${ruby_minor_version}*/arm64/bin \
    "${runner_tool_cache}"/Ruby/${ruby_minor_version}*/x64/bin; do
    candidates+=("${bin_dir}")
done
shopt -u nullglob

for bin_dir in "${candidates[@]}"; do
    if [ ! -x "${bin_dir}/ruby" ]; then
        continue
    fi
    if "${bin_dir}/ruby" -e "exit RUBY_VERSION.start_with?('${ruby_minor_version}.') ? 0 : 1"; then
        selected_bin="${bin_dir}"
        break
    fi
done

if [ -z "${selected_bin}" ]; then
    echo "::error::Ruby ${ruby_minor_version}.x not found on runner." >&2
    printf 'Checked Ruby locations:\n' >&2
    printf '  %s\n' "${candidates[@]}" >&2
    exit 1
fi

export PATH="${selected_bin}:${PATH}"
if [ -n "${GITHUB_PATH:-}" ]; then
    echo "${selected_bin}" >> "${GITHUB_PATH}"
fi

echo "Using Ruby from ${selected_bin}"
ruby --version
gem --version
