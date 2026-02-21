FROM eclipse-temurin:21-jdk AS builder

RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy gradle files
COPY gradle gradle
COPY gradlew .
COPY build.gradle.kts .
COPY settings.gradle.kts .

# Download dependencies
RUN ./gradlew dependencies --no-daemon

# Copy source code
COPY src src

# Build the application (rm daemon files to avoid Kaniko snapshot race)
RUN ./gradlew bootJar --no-daemon && rm -rf /root/.kotlin /tmp/hsperfdata_root

FROM eclipse-temurin:21-jre

WORKDIR /app

# Create directory for git repos
RUN mkdir -p /data/repos

# Copy the built jar
COPY --from=builder /app/build/libs/*.jar app.jar

# Install git for JGit operations
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
