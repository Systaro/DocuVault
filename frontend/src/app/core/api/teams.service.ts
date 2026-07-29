import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Lightweight team reference, used for badges next to a user. */
export interface TeamBadge {
  id: string;
  name: string;
  color?: string;
}

export interface Team extends TeamBadge {
  slug: string;
  description?: string;
  memberCount: number;
  spaceCount: number;
  createdAt: string;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  enabled: boolean;
}

export interface TeamSpacePermission {
  teamId: string;
  teamName: string;
  teamColor?: string;
  spaceId: string;
  spaceName: string;
  spaceFullPath: string;
  spaceType: string;
  permissionLevel: string;
}

export interface TeamDetail extends Team {
  members: TeamMember[];
  permissions: TeamSpacePermission[];
}

export interface TeamMembership {
  teamId: string;
  teamName: string;
  teamColor?: string;
  userId: string;
}

/** A team a user belongs to, plus the access that membership confers. */
export interface UserTeam {
  id: string;
  name: string;
  color?: string;
  permissions: TeamSpacePermission[];
}

export interface SaveTeamPayload {
  name: string;
  description?: string;
  color?: string;
  memberIds: string[];
  permissions: { spaceId: string; permissionLevel: string }[];
}

@Injectable({ providedIn: 'root' })
export class TeamsService {
  constructor(private http: HttpClient) {}

  getTeams(): Observable<Team[]> {
    return this.http.get<Team[]>('/api/teams');
  }

  getTeam(id: string): Observable<TeamDetail> {
    return this.http.get<TeamDetail>(`/api/teams/${id}`);
  }

  getMemberships(): Observable<TeamMembership[]> {
    return this.http.get<TeamMembership[]>('/api/teams/memberships');
  }

  createTeam(payload: SaveTeamPayload): Observable<TeamDetail> {
    return this.http.post<TeamDetail>('/api/teams', payload);
  }

  updateTeam(id: string, payload: SaveTeamPayload): Observable<TeamDetail> {
    return this.http.put<TeamDetail>(`/api/teams/${id}`, payload);
  }

  deleteTeam(id: string): Observable<void> {
    return this.http.delete<void>(`/api/teams/${id}`);
  }

  addMember(teamId: string, userId: string): Observable<TeamDetail> {
    return this.http.post<TeamDetail>(`/api/teams/${teamId}/members`, { userId });
  }

  removeMember(teamId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`/api/teams/${teamId}/members/${userId}`);
  }

  setPermissions(
    teamId: string,
    permissions: { spaceId: string; permissionLevel: string }[]
  ): Observable<TeamSpacePermission[]> {
    return this.http.put<TeamSpacePermission[]>(`/api/teams/${teamId}/permissions`, { permissions });
  }

  getUserTeams(userId: string): Observable<UserTeam[]> {
    return this.http.get<UserTeam[]>(`/api/users/${userId}/teams`);
  }

  setUserTeams(userId: string, teamIds: string[]): Observable<UserTeam[]> {
    return this.http.put<UserTeam[]>(`/api/users/${userId}/teams`, { teamIds });
  }

  getSpaceTeamPermissions(spaceId: string): Observable<TeamSpacePermission[]> {
    return this.http.get<TeamSpacePermission[]>(`/api/spaces/${spaceId}/team-permissions`);
  }

  addSpaceTeamPermission(
    spaceId: string,
    teamId: string,
    permissionLevel: string
  ): Observable<TeamSpacePermission> {
    return this.http.post<TeamSpacePermission>(`/api/spaces/${spaceId}/team-permissions`, {
      teamId,
      permissionLevel
    });
  }

  removeSpaceTeamPermission(spaceId: string, teamId: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${spaceId}/team-permissions/${teamId}`);
  }
}
