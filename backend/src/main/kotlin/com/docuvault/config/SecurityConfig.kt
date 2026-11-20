package com.docuvault.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.authentication.AuthenticationManager
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.security.core.userdetails.UserDetailsService
import org.springframework.security.core.userdetails.UsernameNotFoundException
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.cors.UrlBasedCorsConfigurationSource
import com.docuvault.infrastructure.repository.UserRepository
import java.net.URI

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
class SecurityConfig(
    private val userDetailsService: UserDetailsService,
    private val rateLimitFilter: RateLimitFilter,
    private val apiTokenAuthFilter: ApiTokenAuthFilter,
    private val allowedOrigins: AllowedOrigins
) {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .cors { it.configurationSource(corsConfigurationSource()) }
            .csrf { it.disable() }
            .sessionManagement {
                it.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                it.sessionFixation().migrateSession()
            }
            .authorizeHttpRequests { auth ->
                auth
                    .requestMatchers("/auth/**").permitAll()
                    .requestMatchers("/actuator/health").permitAll()
                    .requestMatchers("/capabilities").permitAll()
                    // Login page, public shares and email clients show the brand without a session.
                    .requestMatchers(org.springframework.http.HttpMethod.GET, "/branding", "/branding/assets/**").permitAll()
                    .requestMatchers("/users/accept-invitation").permitAll()
                    .requestMatchers("/notifications/unsubscribe", "/notifications/unsubscribe/info").permitAll()
                    .requestMatchers("/shared/**").permitAll()
                    .requestMatchers("/meetings/bot/**").permitAll()
                    // MCP + OAuth: discovery is public, the rest checks its own credential
                    // (bearer token, or the session on the consent endpoints) so the 401
                    // can carry the WWW-Authenticate pointer MCP clients discover with.
                    .requestMatchers("/.well-known/**").permitAll()
                    // Live collaboration socket: it authenticates itself, from the session
                    // of the handshake or a bearer token sent as its first message.
                    .requestMatchers("/live").permitAll()
                    // The office document server fetches and saves files with signed links
                    // and its shared secret, never with a session.
                    .requestMatchers(org.springframework.http.HttpMethod.GET, "/office/file").permitAll()
                    .requestMatchers(org.springframework.http.HttpMethod.POST, "/office/callback").permitAll()
                    .requestMatchers("/oauth/**").permitAll()
                    .requestMatchers("/mcp").permitAll()
                    // Redeeming a transfer ticket: the ticket itself is the credential (issuing one is authenticated).
                    .requestMatchers(org.springframework.http.HttpMethod.PUT, "/transfers/*").permitAll()
                    .requestMatchers(org.springframework.http.HttpMethod.GET, "/transfers/*").permitAll()
                    .anyRequest().authenticated()
            }
            .addFilterBefore(rateLimitFilter, UsernamePasswordAuthenticationFilter::class.java)
            .addFilterAfter(apiTokenAuthFilter, RateLimitFilter::class.java)

        return http.build()
    }

    @Bean
    fun corsConfigurationSource(): CorsConfigurationSource {
        val configuration = CorsConfiguration()
        configuration.allowedOrigins = allowedOrigins.list
        configuration.allowedMethods = listOf("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS")
        configuration.allowedHeaders = listOf("*")
        configuration.allowCredentials = true

        val source = UrlBasedCorsConfigurationSource()
        source.registerCorsConfiguration("/**", configuration)
        return source
    }

    @Bean
    fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder()

    @Bean
    fun authenticationManager(config: AuthenticationConfiguration): AuthenticationManager =
        config.authenticationManager
}

/** The browser origins the API answers: the public URL, local development and the native app. */
@Component
class AllowedOrigins(@Value("\${app.public-url}") publicUrl: String) {
    val list: List<String> = listOf(
        "http://localhost:4200",
        "http://localhost:7031",
        "http://127.0.0.1:7031",
        "http://localhost:80",
        URI(publicUrl).let { "${it.scheme}://${it.authority}" },
        "capacitor://localhost",
        "https://localhost",
        "ionic://localhost"
    ).distinct()
}

@Service
class CustomUserDetailsService(
    private val userRepository: UserRepository
) : UserDetailsService {
    override fun loadUserByUsername(email: String): UserDetails {
        val user = userRepository.findByEmail(email)
            ?: throw UsernameNotFoundException("User not found")

        return org.springframework.security.core.userdetails.User(
            user.email,
            user.passwordHash,
            user.enabled,  // enabled
            true,          // accountNonExpired
            true,          // credentialsNonExpired
            true,          // accountNonLocked
            listOf(SimpleGrantedAuthority("ROLE_${user.role.name}"))
        )
    }
}
