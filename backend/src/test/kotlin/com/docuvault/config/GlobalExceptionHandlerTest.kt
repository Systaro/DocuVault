package com.docuvault.config

import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.resource.NoResourceFoundException

class GlobalExceptionHandlerTest {

    /** Stand-in for what the DispatcherServlet raises on an unmatched route in Boot 3.2. */
    @RestController
    class UnmatchedRouteController {
        @GetMapping("/notes")
        fun notes(): Nothing = throw NoResourceFoundException(HttpMethod.GET, "notes")
    }

    private val mockMvc = MockMvcBuilders
        .standaloneSetup(UnmatchedRouteController())
        .setControllerAdvice(GlobalExceptionHandler())
        .build()

    @Test
    fun `unmatched route resolves to 404 with the JSON error envelope`() {
        mockMvc.perform(get("/notes"))
            .andExpect(status().isNotFound)
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.message").value("Resource not found"))
    }
}
