#!/usr/bin/env bash
set -euo pipefail

ARCHS="${ARCHS:-arm64-v8a,armeabi-v7a}"
export FOSS_BUILD="${FOSS_BUILD:-0}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${ROOT_DIR}/../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/build}"
cd "$ROOT_DIR"

# Metro in this monorepo checks for a repo-level node_modules path even when
# dependencies are installed per-package for F-Droid-style builds.
mkdir -p "${REPO_ROOT}/node_modules"

if [[ "${FOSS_BUILD}" == "1" && "${SKIP_FDROID_PREP:-0}" != "1" ]]; then
  ./scripts/fdroid_prep.sh
fi

npx expo prebuild --clean --platform android

if [[ "${UNSIGNED_APK:-0}" == "1" ]]; then
  python3 - <<'PY'
from pathlib import Path
import re

path = Path("android/app/build.gradle")
text = path.read_text()

# Remove signingConfigs block (debug/release)
text = re.sub(r"\n\s*signingConfigs\s*\{.*?\n\s*\}\n", "\n", text, flags=re.S)
# Remove signingConfig assignments inside buildTypes
text = re.sub(r"^\s*signingConfig\s+signingConfigs\.\w+\s*$\n?", "", text, flags=re.M)

path.write_text(text)
PY
fi

if grep -q "^reactNativeArchitectures=" android/gradle.properties; then
  sed -i "s/^reactNativeArchitectures=.*/reactNativeArchitectures=${ARCHS}/" android/gradle.properties
else
  echo "reactNativeArchitectures=${ARCHS}" >> android/gradle.properties
fi

if ! grep -q "splits {\\s*abi" android/app/build.gradle; then
  python3 - <<'PY'
from pathlib import Path

path = Path("android/app/build.gradle")
text = path.read_text()
marker = "defaultConfig {"
if marker in text:
    start = text.find(marker)
    end = text.find("\n    }\n", start)
    if end != -1:
        insert = """
    def reactNativeArchitectures = (findProperty('reactNativeArchitectures') ?: 'arm64-v8a')
        .split(',')
        .collect { it.trim() }
        .findAll { it }
    splits {
        abi {
            enable true
            reset()
            include(*reactNativeArchitectures)
            universalApk false
        }
    }
"""
        text = text[: end + 6] + insert + text[end + 6 :]
        path.write_text(text)
PY
fi

if [[ "${FOSS_BUILD}" == "1" ]]; then
  python3 - <<'PY'
from pathlib import Path

path = Path("android/app/build.gradle")
text = path.read_text()

excludes_block = """

configurations.all {
    exclude group: 'com.google.android.gms'
    exclude group: 'com.google.firebase'
    exclude group: 'com.google.android.datatransport'
    exclude group: 'com.google.mlkit'
}
"""

dependencies_info_block = """

android {
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}
"""

if "exclude group: 'com.google.firebase'" not in text:
    text = text.rstrip() + excludes_block

if "dependenciesInfo {" not in text:
    text = text.rstrip() + dependencies_info_block

path.write_text(text)
PY
fi

cd android
./gradlew assembleRelease -PreactNativeArchitectures="${ARCHS}"

APK_DIR="${ROOT_DIR}/android/app/build/outputs/apk/release"
if [[ ! -d "$APK_DIR" ]]; then
  echo "APK output directory not found: $APK_DIR" >&2
  exit 1
fi

IFS=',' read -ra ARCH_LIST <<< "${ARCHS}"
mkdir -p "${OUTPUT_DIR}"
VERSION="$(node -e "console.log(require('../app.json').expo.version)")"
SUFFIX=""
if [[ "${FOSS_BUILD:-0}" == "1" ]]; then
  SUFFIX="-foss"
fi

found=0
for arch in "${ARCH_LIST[@]}"; do
  arch_trimmed="$(echo "$arch" | xargs)"
  if [[ -z "$arch_trimmed" ]]; then
    continue
  fi
  apk_path="$(ls "$APK_DIR"/app-*${arch_trimmed}*-release*.apk 2>/dev/null | head -1 || true)"
  if [[ -n "$apk_path" ]]; then
    out_name="mindwtr-${VERSION}-${arch_trimmed}${SUFFIX}.apk"
    cp "$apk_path" "${OUTPUT_DIR}/${out_name}"
    echo "APK: ${OUTPUT_DIR}/${out_name}"
    found=1
  fi
done

if [[ "$found" -eq 0 ]]; then
  apk_path="$(ls "$APK_DIR"/app-release*.apk 2>/dev/null | head -1 || true)"
  if [[ -z "$apk_path" ]]; then
    echo "No release APKs found in ${APK_DIR}" >&2
    exit 1
  fi
  out_name="mindwtr-${VERSION}-universal${SUFFIX}.apk"
  cp "$apk_path" "${OUTPUT_DIR}/${out_name}"
  echo "APK: ${OUTPUT_DIR}/${out_name}"
fi
