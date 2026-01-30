package com.docuvault

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableAsync
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication
@EnableScheduling
@EnableAsync
class DocuVaultApplication

fun main(args: Array<String>) {
    runApplication<DocuVaultApplication>(*args)
}
