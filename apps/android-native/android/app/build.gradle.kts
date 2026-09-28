plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "tech.dongdongbh.mindwtr.pilot"
    compileSdk = 36

    defaultConfig {
        applicationId = "tech.dongdongbh.mindwtr.nativeclient.dev"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "native-dev"
        // false: the isolated dev database. Only the upgradetest build type opens the RN app's storage.
        buildConfigField("boolean", "RN_STORAGE", "false")
    }

    buildTypes {
        // Upgrade harness only (scripts/check-upgrade-device.mjs): installs in place over the
        // RN v1.3.2 harness build, package tech.dongdongbh.mindwtr.upgradetest, and opens its files.
        create("upgradetest") {
            initWith(getByName("debug"))
            buildConfigField("boolean", "RN_STORAGE", "true")
        }
    }

    // BuildConfig.DEBUG gates the lifecycle check's fault hooks.
    buildFeatures { compose = true; buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

}

// A build type cannot replace applicationId; the variant API can. 152 = RN v1.3.2, 154 = RN recovery build.
androidComponents {
    onVariants(selector().withBuildType("upgradetest")) { variant ->
        variant.applicationId.set("tech.dongdongbh.mindwtr.upgradetest")
        variant.outputs.forEach { it.versionCode.set(153) }
    }
}

dependencies {
    implementation("wang.harlon.quickjs:wrapper-android:3.2.0")
    // Android's system SQLite does not guarantee FTS5, which core schema needs.
    implementation("androidx.sqlite:sqlite-bundled:2.7.1")
    // RN's fetch runs on OkHttp; the host's fetch uses it too (HostIo.kt), so redirects, TLS and cleartext match RN's.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation(platform("androidx.compose:compose-bom:2025.08.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    // RN's app lock prompt, as expo-local-authentication asks it (its version).
    implementation("androidx.biometric:biometric:1.2.0-alpha04")
    // biometric asks for fragment 1.2.5, which predates activity 1.10's result registry; MainActivity is a FragmentActivity.
    implementation("androidx.fragment:fragment:1.8.9")
}

val buildCoreBundle by tasks.registering(Exec::class) {
    workingDir = rootProject.projectDir.resolve("../../..")
    commandLine("node", "apps/android-native/scripts/build-bundle.mjs")
    inputs.files(
        fileTree(workingDir.resolve("packages/core/src")),
        fileTree(workingDir.resolve("apps/android-native/bundle")),
        workingDir.resolve("apps/android-native/scripts/build-bundle.mjs"),
        workingDir.resolve("bun.lock"),
        workingDir.resolve("package.json"),
        workingDir.resolve("packages/core/package.json"),
    )
    outputs.file("src/main/assets/core-host.js")
}
tasks.named("preBuild") { dependsOn(buildCoreBundle) }
