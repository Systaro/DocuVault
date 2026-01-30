package com.docuvault

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.boot.runApplication
import org.springframework.context.event.EventListener
import org.springframework.core.env.Environment
import org.springframework.scheduling.annotation.EnableAsync
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.stereotype.Component

@SpringBootApplication
@EnableScheduling
@EnableAsync
class DocuVaultApplication

fun main(args: Array<String>) {
    runApplication<DocuVaultApplication>(*args)
}

@Component
class StartupBanner(private val env: Environment) {

    @EventListener(ApplicationReadyEvent::class)
    fun onReady() {
        val port = env.getProperty("server.port", "8080")
        val contextPath = env.getProperty("server.servlet.context-path", "")
        val profile = env.activeProfiles.joinToString(", ").ifEmpty { "default" }
        val url = "http://localhost:$port$contextPath"

        println("""

  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ┃                                                         ┃
  ┃     ██████╗  ██████╗  ██████╗██╗   ██╗                  ┃
  ┃     ██╔══██╗██╔═══██╗██╔════╝██║   ██║                  ┃
  ┃     ██║  ██║██║   ██║██║     ██║   ██║                  ┃
  ┃     ██║  ██║██║   ██║██║     ██║   ██║                  ┃
  ┃     ██████╔╝╚██████╔╝╚██████╗╚██████╔╝                  ┃
  ┃     ╚═════╝  ╚═════╝  ╚═════╝ ╚═════╝                   ┃
  ┃     ██╗   ██╗ █████╗ ██╗   ██╗██╗  ████████╗            ┃
  ┃     ██║   ██║██╔══██╗██║   ██║██║  ╚══██╔══╝            ┃
  ┃     ██║   ██║███████║██║   ██║██║     ██║               ┃
  ┃     ╚██╗ ██╔╝██╔══██║██║   ██║██║     ██║               ┃
  ┃      ╚████╔╝ ██║  ██║╚██████╔╝███████╗██║               ┃
  ┃       ╚═══╝  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝               ┃
  ┃                                                         ┃
  ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
  ┃                                                         ┃
  ┃   ➜  Local:    $url${" ".repeat(maxOf(0, 40 - url.length))}┃
  ┃   ➜  Profile:  $profile${" ".repeat(maxOf(0, 40 - profile.length))}┃
  ┃                                                         ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
        """)
    }
}
