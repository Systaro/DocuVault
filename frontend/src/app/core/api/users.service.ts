import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from '../auth/auth.service';

export interface UserSearchResult {
  id: string;
  name: string;
  email: string;
}

export interface UserPermission {
  spaceId: string;
  spaceName: string;
  spaceFullPath: string;
  spaceType: string;
  permissionLevel: string;
}

export interface Invitation {
  id: string;
  email: string;
  spaceId?: string;
  role: string;
  token: string;
  expiresAt: string;
  accepted: boolean;
  createdAt: string;
}

export interface SpaceNotificationPref {
  spaceId: string;
  name: string;
  fullPath: string;
  type: string;
  parentId: string | null;
  enabled: boolean;
  override: boolean | null;
}

export interface NotificationPreferences {
  pushMode: string;
  emailMode: string;
  spaces: SpaceNotificationPref[];
}

export interface UnsubscribeInfo {
  email: string;
  spaceId: string | null;
  spaceName: string | null;
  emailMode: string;
}

export interface UnsubscribeResult {
  scope: string;
  spaceName?: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  constructor(private http: HttpClient) {}

  searchUsers(query: string): Observable<UserSearchResult[]> {
    return this.http.get<UserSearchResult[]>('/api/users/search', {
      params: { q: query }
    });
  }

  getCurrentUser(): Observable<User> {
    return this.http.get<User>('/api/users/me');
  }

  updateCurrentUser(data: { name?: string; password?: string }): Observable<User> {
    return this.http.put<User>('/api/users/me', data);
  }

  getUsers(): Observable<User[]> {
    return this.http.get<User[]>('/api/users');
  }

  getUser(id: string): Observable<User> {
    return this.http.get<User>(`/api/users/${id}`);
  }

  updateUser(id: string, data: { name?: string; role?: string }): Observable<User> {
    return this.http.put<User>(`/api/users/${id}`, data);
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`/api/users/${id}`);
  }

  impersonateUser(id: string): Observable<User> {
    return this.http.post<User>(`/api/users/${id}/impersonate`, {});
  }

  /**
   * [teamIds] take effect immediately: the invite creates a disabled placeholder
   * account, so the person's team grants are already in place when they sign up.
   */
  inviteUser(email: string, spaceId?: string, role?: string, teamIds: string[] = []): Observable<Invitation> {
    return this.http.post<Invitation>('/api/users/invite', {
      email,
      spaceId,
      role,
      teamIds
    });
  }

  resendInvitation(id: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`/api/users/invitations/${id}/resend`, {});
  }

  deleteInvitation(id: string): Observable<void> {
    return this.http.delete<void>(`/api/users/invitations/${id}`);
  }

  getInvitations(): Observable<Invitation[]> {
    return this.http.get<Invitation[]>('/api/users/invitations');
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>('/api/users/me/change-password', { currentPassword, newPassword });
  }

  getNotificationPreferences(): Observable<NotificationPreferences> {
    return this.http.get<NotificationPreferences>('/api/users/me/notifications');
  }

  updateNotificationPreferences(pushMode: string, emailMode: string): Observable<NotificationPreferences> {
    return this.http.put<NotificationPreferences>('/api/users/me/notifications', { pushMode, emailMode });
  }

  setSpaceNotification(spaceId: string, enabled: boolean): Observable<void> {
    return this.http.put<void>(`/api/users/me/notifications/spaces/${spaceId}`, { enabled });
  }

  clearSpaceNotification(spaceId: string): Observable<void> {
    return this.http.delete<void>(`/api/users/me/notifications/spaces/${spaceId}`);
  }

  getUnsubscribeInfo(token: string, spaceId?: string): Observable<UnsubscribeInfo> {
    const params: Record<string, string> = { t: token };
    if (spaceId) params['s'] = spaceId;
    return this.http.get<UnsubscribeInfo>('/api/notifications/unsubscribe/info', { params });
  }

  unsubscribe(token: string, spaceId?: string): Observable<UnsubscribeResult> {
    const params: Record<string, string> = { t: token };
    if (spaceId) params['s'] = spaceId;
    return this.http.post<UnsubscribeResult>('/api/notifications/unsubscribe', {}, { params });
  }

  acceptInvitation(token: string, name: string, password: string): Observable<User> {
    return this.http.post<User>('/api/users/accept-invitation', {
      token,
      name,
      password
    });
  }

  getUserPermissions(userId: string): Observable<UserPermission[]> {
    return this.http.get<UserPermission[]>(`/api/users/${userId}/permissions`);
  }

  setUserPermissions(userId: string, permissions: { spaceId: string; permissionLevel: string }[]): Observable<UserPermission[]> {
    return this.http.put<UserPermission[]>(`/api/users/${userId}/permissions`, { permissions });
  }
}
