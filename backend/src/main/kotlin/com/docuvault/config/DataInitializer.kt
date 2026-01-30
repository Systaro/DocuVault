package com.docuvault.config

import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.UserRepository
import org.slf4j.LoggerFactory
import org.springframework.boot.CommandLineRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.crypto.password.PasswordEncoder

@Configuration
class DataInitializer(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder
) {
    private val logger = LoggerFactory.getLogger(DataInitializer::class.java)

    @Bean
    fun initDefaultData(): CommandLineRunner = CommandLineRunner {
        createDefaultAdminIfNotExists()
    }

    private fun createDefaultAdminIfNotExists() {
        val adminEmail = "admin@docuvault.local"

        if (userRepository.findByEmail(adminEmail) == null) {
            val admin = User(
                email = adminEmail,
                passwordHash = passwordEncoder.encode("password123"),
                name = "Admin",
                role = UserRole.SUPER_ADMIN
            )
            userRepository.save(admin)
            logger.info("Created default admin user: $adminEmail")
        } else {
            logger.debug("Default admin user already exists")
        }
    }
}
