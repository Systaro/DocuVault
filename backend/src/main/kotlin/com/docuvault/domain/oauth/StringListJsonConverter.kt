package com.docuvault.domain.oauth

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import jakarta.persistence.AttributeConverter
import jakarta.persistence.Converter

/** Stores a list of strings as a JSON array in a TEXT column. */
@Converter
class StringListJsonConverter : AttributeConverter<List<String>, String> {
    private val mapper = jacksonObjectMapper()

    override fun convertToDatabaseColumn(attribute: List<String>?): String =
        mapper.writeValueAsString(attribute ?: emptyList<String>())

    override fun convertToEntityAttribute(dbData: String?): List<String> =
        if (dbData.isNullOrBlank()) emptyList() else mapper.readValue(dbData)
}
