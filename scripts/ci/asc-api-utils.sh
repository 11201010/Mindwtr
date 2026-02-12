#!/usr/bin/env bash

api_get() {
  local out_file="$1"
  shift

  local prefix="${ASC_API_TMP_PREFIX:-asc-api}"
  local tmp_body="${RUNNER_TEMP}/${prefix}-$(date +%s)-$RANDOM.json"
  local http_code

  http_code="$(curl -sS -w '%{http_code}' -o "$tmp_body" "$@" || true)"
  if [ "${http_code}" -ge 200 ] && [ "${http_code}" -lt 300 ]; then
    mv "$tmp_body" "$out_file"
    return 0
  fi

  local preview
  preview="$(tr '\n' ' ' < "$tmp_body" | head -c 240)"
  rm -f "$tmp_body"
  echo "::warning::App Store Connect API request failed (HTTP ${http_code}): ${preview}"
  return 1
}
