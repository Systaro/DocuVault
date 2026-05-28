package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.SpaceNotificationSetting
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface SpaceNotificationSettingRepository : JpaRepository<SpaceNotificationSetting, UUID> {
    fun findByUserIdAndSpaceId(userId: UUID, spaceId: UUID): SpaceNotificationSetting?
    fun findAllByUserId(userId: UUID): List<SpaceNotificationSetting>
    fun deleteByUserIdAndSpaceId(userId: UUID, spaceId: UUID)
}
