pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "mindwtr-android-native"
include(":app")
// RN's home-screen widget module (apps/mobile/modules/android-widget) as a library: widget/build.gradle.kts.
include(":widget")
