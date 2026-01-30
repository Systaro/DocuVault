package com.docuvault.config

import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.UserRepository
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.CommandLineRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.crypto.password.PasswordEncoder

@Configuration
class DataInitializer(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder,
    @Value("\${admin.email:}") private val adminEmail: String,
    @Value("\${admin.password:}") private val adminPassword: String
) {
    private val logger = LoggerFactory.getLogger(DataInitializer::class.java)

    @Bean
    fun initDefaultData(): CommandLineRunner = CommandLineRunner {
        createDefaultAdminIfNotExists()
    }

    private fun createDefaultAdminIfNotExists() {
        if (adminEmail.isBlank() || adminPassword.isBlank()) {
            logger.info("No admin credentials configured (ADMIN_EMAIL / ADMIN_PASSWORD). Skipping default admin creation.")
            return
        }

        if (adminPassword.length < 12) {
            logger.error("ADMIN_PASSWORD must be at least 12 characters. Refusing to create admin with weak password.")
            return
        }

        if (userRepository.findByEmail(adminEmail) == null) {
            val admin = User(
                email = adminEmail,
                passwordHash = passwordEncoder.encode(adminPassword),
                name = "Admin",
                role = UserRole.SUPER_ADMIN
            )
            userRepository.save(admin)
            logger.info("Created default admin user: $adminEmail")
        } else {
            logger.debug("Admin user already exists")
        }
    }
}
