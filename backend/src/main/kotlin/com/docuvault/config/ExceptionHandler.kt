package com.docuvault.config

import com.docuvault.service.SpaceInConflictException
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.AccessDeniedException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.resource.NoResourceFoundException

@RestControllerAdvice
class GlobalExceptionHandler {
    private val logger = LoggerFactory.getLogger(GlobalExceptionHandler::class.java)

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidationExceptions(ex: MethodArgumentNotValidException): ResponseEntity<ErrorResponse> {
        val errors = ex.bindingResult.fieldErrors.map { "${it.field}: ${it.defaultMessage}" }
        logger.warn("Validation failed for ${ex.parameter.method?.declaringClass?.simpleName}.${ex.parameter.method?.name}: $errors")
        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse(
                status = 400,
                message = "Validation failed",
                errors = errors
            ))
    }

    @ExceptionHandler(SpaceInConflictException::class)
    fun handleSpaceInConflict(ex: SpaceInConflictException): ResponseEntity<ErrorResponse> {
        return ResponseEntity
            .status(HttpStatus.CONFLICT)
            .body(ErrorResponse(
                status = 409,
                message = ex.message ?: "Space is in conflict",
                errorCode = "SPACE_IN_CONFLICT",
                conflictMrUrl = ex.conflictMrUrl
            ))
    }

    @ExceptionHandler(IllegalArgumentException::class)
    fun handleIllegalArgument(ex: IllegalArgumentException): ResponseEntity<ErrorResponse> {
        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse(
                status = 400,
                message = ex.message ?: "Invalid request"
            ))
    }

    /** Honour the status carried by an explicitly thrown ResponseStatusException
     *  (e.g. a 401/403/400 from a controller) instead of letting it fall through
     *  to the generic 500 handler. */
    @ExceptionHandler(ResponseStatusException::class)
    fun handleResponseStatus(ex: ResponseStatusException): ResponseEntity<ErrorResponse> {
        return ResponseEntity
            .status(ex.statusCode)
            .body(ErrorResponse(
                status = ex.statusCode.value(),
                message = ex.reason ?: "Request failed"
            ))
    }

    /** Unmatched routes surface as NoResourceFoundException in Boot 3.2 — map them
     *  to a deterministic 404 instead of letting them fall through to the generic
     *  500 handler. */
    @ExceptionHandler(NoResourceFoundException::class)
    fun handleNoResourceFound(ex: NoResourceFoundException): ResponseEntity<ErrorResponse> {
        return ResponseEntity
            .status(HttpStatus.NOT_FOUND)
            .body(ErrorResponse(
                status = 404,
                message = "Resource not found"
            ))
    }

    /** A failed @PreAuthorize check (e.g. a non-admin calling an admin endpoint)
     *  is a 403, not a server error. */
    @ExceptionHandler(AccessDeniedException::class)
    fun handleAccessDenied(ex: AccessDeniedException): ResponseEntity<ErrorResponse> {
        return ResponseEntity
            .status(HttpStatus.FORBIDDEN)
            .body(ErrorResponse(
                status = 403,
                message = "You do not have permission to do this"
            ))
    }

    @ExceptionHandler(Exception::class)
    fun handleGenericException(ex: Exception): ResponseEntity<ErrorResponse> {
        logger.error("Unhandled exception: ${ex.message}", ex)
        return ResponseEntity
            .status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ErrorResponse(
                status = 500,
                message = "An unexpected error occurred"
            ))
    }
}

data class ErrorResponse(
    val status: Int,
    val message: String,
    val errors: List<String>? = null,
    val errorCode: String? = null,
    val conflictMrUrl: String? = null
)
