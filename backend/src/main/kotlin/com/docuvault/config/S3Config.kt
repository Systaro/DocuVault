package com.docuvault.config

import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.CreateBucketRequest
import software.amazon.awssdk.services.s3.model.HeadBucketRequest
import software.amazon.awssdk.services.s3.model.NoSuchBucketException
import java.net.URI

@Configuration
class S3Config(
    @Value("\${minio.endpoint}") private val endpoint: String,
    @Value("\${minio.access-key}") private val accessKey: String,
    @Value("\${minio.secret-key}") private val secretKey: String,
    @Value("\${minio.bucket}") private val bucket: String,
    @Value("\${minio.attachments-bucket}") private val attachmentsBucket: String
) {
    private val logger = LoggerFactory.getLogger(S3Config::class.java)

    private fun buildClient(): S3Client = S3Client.builder()
        .endpointOverride(URI.create(endpoint))
        .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey)))
        .region(Region.US_EAST_1)
        .forcePathStyle(true)
        .build()

    @Bean
    fun s3Client(): S3Client = buildClient()

    @PostConstruct
    fun ensureBuckets() {
        listOf(bucket, attachmentsBucket).distinct().forEach { name ->
            try {
                val client = buildClient()
                try {
                    client.headBucket(HeadBucketRequest.builder().bucket(name).build())
                    logger.info("S3 bucket '$name' already exists")
                } catch (e: NoSuchBucketException) {
                    client.createBucket(CreateBucketRequest.builder().bucket(name).build())
                    logger.info("Created S3 bucket '$name'")
                }
            } catch (e: Exception) {
                logger.warn("Could not prepare bucket '$name' on MinIO at $endpoint: ${e.message}. Uploads to it will fail until MinIO is available.")
            }
        }
    }
}
