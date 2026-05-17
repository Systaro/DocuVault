import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("org.springframework.boot") version "3.2.5"
    id("io.spring.dependency-management") version "1.1.4"
    kotlin("jvm") version "1.9.23"
    kotlin("plugin.spring") version "1.9.23"
    kotlin("plugin.jpa") version "1.9.23"
}

group = "com.docuvault"
version = "0.0.1-SNAPSHOT"
description = "DocuVault backend — self-hosted documentation platform with Git as the source of truth"

java {
    sourceCompatibility = JavaVersion.VERSION_17
}

repositories {
    mavenCentral()
}

dependencies {
    // Spring Boot
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-mail")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.springframework.session:spring-session-data-redis")

    // Kotlin
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation("org.jetbrains.kotlin:kotlin-reflect")

    // Database
    runtimeOnly("org.postgresql:postgresql")

    // Schema migrations — Flyway runs on startup, baselines existing installs at V013
    // and auto-applies any new V*.sql files. See application.yml + db/migration/.
    // Spring Boot 3.2 ships Flyway 9.x which has built-in PostgreSQL support.
    implementation("org.flywaydb:flyway-core")

    // pgvector support
    implementation("com.pgvector:pgvector:0.1.4")

    // Git operations
    implementation("org.eclipse.jgit:org.eclipse.jgit:6.9.0.202403050737-r")

    // GitLab API
    implementation("org.gitlab4j:gitlab4j-api:6.0.0-rc.6")

    // OpenAI API
    implementation("com.aallam.openai:openai-client:3.7.0")
    implementation("io.ktor:ktor-client-okhttp:2.3.9")

    // Coroutines for OpenAI client
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-reactor:1.8.0")

    // Markdown processing
    implementation("org.commonmark:commonmark:0.21.0")

    // HTML parsing (strip tags for indexing)
    implementation("org.jsoup:jsoup:1.17.2")

    // AWS S3 SDK (for MinIO)
    implementation(platform("software.amazon.awssdk:bom:2.25.16"))
    implementation("software.amazon.awssdk:s3")

    // Firebase Admin SDK (FCM push notifications)
    implementation("com.google.firebase:firebase-admin:9.4.3")

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
}

tasks.withType<KotlinCompile> {
    kotlinOptions {
        freeCompilerArgs += "-Xjsr305=strict"
        jvmTarget = "17"
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
}
