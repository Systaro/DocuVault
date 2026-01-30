import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from '../auth/auth.service';

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

@Injectable({ providedIn: 'root' })
export class UsersService {
  constructor(private http: HttpClient) {}

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

  inviteUser(email: string, spaceId?: string, role?: string): Observable<Invitation> {
    return this.http.post<Invitation>('/api/users/invite', {
      email,
      spaceId,
      role
    });
  }

  resendInvitation(id: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`/api/users/invitations/${id}/resend`, {});
  }

  getInvitations(): Observable<Invitation[]> {
    return this.http.get<Invitation[]>('/api/users/invitations');
  }

  acceptInvitation(token: string, name: string, password: string): Observable<User> {
    return this.http.post<User>('/api/users/accept-invitation', {
      token,
      name,
      password
    });
  }
}
