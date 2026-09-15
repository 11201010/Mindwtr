#!/usr/bin/env bash

set -euo pipefail

ARTIFACTS_DIR="${1:?usage: collect-ios27-environment.sh <artifacts-directory>}"
mkdir -p "$ARTIFACTS_DIR"

XCODE_VERSION_FILE="$ARTIFACTS_DIR/xcode-version.txt"
SDK_FILE="$ARTIFACTS_DIR/xcode-sdks.txt"
RUNTIMES_FILE="$ARTIFACTS_DIR/simulator-runtimes.txt"
TOOLS_FILE="$ARTIFACTS_DIR/tool-versions.txt"

xcodebuild -version | tee "$XCODE_VERSION_FILE"
xcodebuild -showsdks | tee "$SDK_FILE"
xcrun simctl list runtimes | tee "$RUNTIMES_FILE"
xcrun simctl list runtimes -j > "$ARTIFACTS_DIR/simulator-runtimes.json"

{
  echo "runner_image_os=${ImageOS:-unknown}"
  echo "runner_image_version=${ImageVersion:-unknown}"
  echo "developer_dir=$(xcode-select -p)"
  echo "iphoneos_sdk=$(xcrun --sdk iphoneos --show-sdk-version)"
  echo "iphonesimulator_sdk=$(xcrun --sdk iphonesimulator --show-sdk-version)"
  echo "node=$(node --version)"
  echo "bun=$(bun --version)"
  echo "ruby=$(ruby --version)"
  echo "cocoapods=$(pod --version)"
  echo "swift=$(swift --version | head -n 1)"
} | tee "$TOOLS_FILE"

(bun pm ls --all || bun pm ls) > "$ARTIFACTS_DIR/dependency-versions.txt"
if [ -f apps/mobile/ios/Podfile.lock ]; then
  cp apps/mobile/ios/Podfile.lock "$ARTIFACTS_DIR/Podfile.lock"
fi

IOS_SDK_VERSION="$(xcrun --sdk iphoneos --show-sdk-version)"
IOS_SDK_MAJOR="${IOS_SDK_VERSION%%.*}"
if ! [[ "$IOS_SDK_MAJOR" =~ ^[0-9]+$ ]]; then
  echo "::error::Unable to parse iPhoneOS SDK version: $IOS_SDK_VERSION"
  exit 1
fi
if [ "$IOS_SDK_MAJOR" -ne 27 ]; then
  echo "::error::The xcode-27 validation runner exposed iPhoneOS SDK $IOS_SDK_VERSION; SDK major 27 is required."
  exit 1
fi

echo "Validated iPhoneOS SDK $IOS_SDK_VERSION on the xcode-27 runner."
