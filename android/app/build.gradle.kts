plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

val privLinesBaseUrl = providers.gradleProperty("PRIVLINES_BASE_URL")
    .orElse("https://privlines.com")
    .get()
    .trimEnd('/')

android {
    namespace = "com.privlines.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.privlines.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "PRIVLINES_BASE_URL", "\"$privLinesBaseUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation(platform("com.google.firebase:firebase-bom:35.0.1"))
    implementation("com.google.firebase:firebase-messaging")
}
