#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_JAR:?Set ANDROID_JAR to the API 35 android.jar}"
: "${BUILD_TOOLS:?Set BUILD_TOOLS to Android build-tools 35.0.0}"
: "${ZENO_KEYSTORE:?Set ZENO_KEYSTORE to the private PKCS12 signing key}"
: "${ZENO_KEY_PASS:?Supply the keystore password via the environment}"
out=${1:?Supply an APK output path}
src=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$work/dex"
"$BUILD_TOOLS/aapt2" compile --dir "$src/res" -o "$work/resources.zip"
"$BUILD_TOOLS/aapt2" link -I "$ANDROID_JAR" --manifest "$src/AndroidManifest.xml" \
    -o "$work/base.apk" "$work/resources.zip"
java -m jdk.compiler/com.sun.tools.javac.Main -encoding UTF-8 -source 8 -target 8 \
    -bootclasspath "$ANDROID_JAR:$BUILD_TOOLS/core-lambda-stubs.jar" -d "$work/classes" "$src/src/kr/zeno/owner/OwnerActivity.java"
java -m jdk.jartool/sun.tools.jar.Main cf "$work/classes.jar" -C "$work/classes" .
"$BUILD_TOOLS/d8" --min-api 26 --lib "$ANDROID_JAR" --output "$work/dex" "$work/classes.jar"
(cd "$work/dex" && zip -q "$work/base.apk" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$work/base.apk" "$work/aligned.apk"
"$BUILD_TOOLS/apksigner" sign --ks "$ZENO_KEYSTORE" --ks-key-alias owner --ks-pass env:ZENO_KEY_PASS --out "$out" "$work/aligned.apk"
"$BUILD_TOOLS/apksigner" verify --verbose "$out"
