plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// RN's home-screen widget module, compiled as it is: RN's Kotlin, resources and JVM tests (apps/mobile/modules/android-widget),
// under RN's namespace, so class names and R stay RN's and placed widgets keep their providers. Left out: the Expo bridge
// (AndroidWidgetModule.kt; the engine publishes the payload, HostWidgets.kt) and RN's headless task (CaptureSyncHeadlessService.kt)
// and capture receiver (CaptureIntentReceiver.kt), whose native versions are in src/main: they start CoreWork through the app's
// hook. The manifest entries and the plugins' XML are generated per build type in the app (scripts/build-widgets.mjs).
val rnModule = rootProject.projectDir.resolve("../../mobile/modules/android-widget/android")
val rnExcluded = listOf("AndroidWidgetModule", "CaptureSyncHeadlessService", "CaptureIntentReceiver")

android {
    namespace = "tech.dongdongbh.mindwtr.androidwidget"
    compileSdk = 36

    defaultConfig { minSdk = 24 }

    // The app's build types, so each finds this module's variant.
    buildTypes {
        create("upgradetest") { initWith(getByName("debug")) }
        listOf("benchmark", "benchmarkSeed", "benchmarkTrace").forEach { create(it) { initWith(getByName("release")) } }
    }

    sourceSets {
        // src/main/res is a link to RN's resources: RN's tests read them by that relative path (WidgetThemeResourcesTest).
        getByName("main").java.srcDir(layout.buildDirectory.dir("generated/rnWidget/main/java"))
        getByName("test").java.srcDir(layout.buildDirectory.dir("generated/rnWidget/test/java"))
    }

    testOptions { unitTests.isIncludeAndroidResources = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // RN's module dependencies (its build.gradle), without React Native.
    implementation("androidx.appcompat:appcompat:1.7.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("org.robolectric:robolectric:4.14.1")
}

val rnWidget by tasks.registering(Sync::class) {
    from(rnModule.resolve("src")) {
        include("main/java/**", "test/java/**")
        exclude(rnExcluded.map { "main/java/**/$it.kt" })
    }
    into(layout.buildDirectory.dir("generated/rnWidget"))
}
tasks.named("preBuild") { dependsOn(rnWidget) }
