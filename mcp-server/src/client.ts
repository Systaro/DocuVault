import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Space, SearchResult, SemanticSearchResult, FileTreeEntry, UserInfo, DocumentContent, PatchOperation, PatchResult, ShareLink, SpaceStateEntry, SpaceStateKey } from './types.js';

export class DocuVaultClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`DocuVault API error ${response.status}: ${response.statusText}${body ? ` - ${body}` : ''}`);
    }

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async validateToken(): Promise<UserInfo> {
    const response = await this.request<{ user: UserInfo }>('/auth/me');
    return response.user;
  }

  async listSpaces(): Promise<Space[]> {
    return this.request<Space[]>('/spaces');
  }

  async getFileTree(spaceId: string): Promise<FileTreeEntry[]> {
    return this.request<FileTreeEntry[]>(`/spaces/${spaceId}/documents/tree`);
  }

  async readDocument(spaceId: string, path: string): Promise<DocumentContent> {
    return this.request<DocumentContent>(`/spaces/${spaceId}/documents/${path}`);
  }

  async createDocument(spaceId: string, path: string, content: string, title?: string): Promise<DocumentContent> {
    return this.request<DocumentContent>(`/spaces/${spaceId}/documents`, {
      method: 'POST',
      body: JSON.stringify({ path, content, title }),
    });
  }

  async patchDocument(
    spaceId: string,
    path: string,
    operations: PatchOperation[],
    options?: { contentHash?: string; autoCommit?: boolean; commitMessage?: string }
  ): Promise<PatchResult> {
    return this.request<PatchResult>(`/spaces/${spaceId}/documents/${path}`, {
      method: 'PATCH',
      body: JSON.stringify({
        operations,
        contentHash: options?.contentHash,
        autoCommit: options?.autoCommit ?? false,
        commitMessage: options?.commitMessage,
      }),
    });
  }

  async updateDocument(
    spaceId: string,
    path: string,
    content: string,
    title?: string,
    options?: { autoCommit?: boolean; commitMessage?: string }
  ): Promise<DocumentContent> {
    return this.request<DocumentContent>(`/spaces/${spaceId}/documents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        content,
        title,
        autoCommit: options?.autoCommit ?? false,
        commitMessage: options?.commitMessage,
      }),
    });
  }

  async deleteDocument(spaceId: string, path: string): Promise<void> {
    await this.request<void>(`/spaces/${spaceId}/documents/${path}`, { method: 'DELETE' });
  }

  async createShareLink(
    spaceId: string,
    filePath: string,
    shareType: 'FILE' | 'FOLDER' = 'FILE',
    password?: string,
    expiresInDays?: number
  ): Promise<ShareLink> {
    return this.request<ShareLink>(`/spaces/${spaceId}/shares`, {
      method: 'POST',
      body: JSON.stringify({ filePath, shareType, password, expiresInDays }),
    });
  }

  async searchKeyword(query: string, limit: number = 20): Promise<SearchResult[]> {
    return this.request<SearchResult[]>(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async searchSemantic(query: string, spaceId?: string, limit: number = 10): Promise<SemanticSearchResult[]> {
    return this.request<SemanticSearchResult[]>('/search/semantic', {
      method: 'POST',
      body: JSON.stringify({ query, spaceId, limit }),
    });
  }

  async listSpaceState(spaceId: string): Promise<SpaceStateKey[]> {
    return this.request<SpaceStateKey[]>(`/spaces/${spaceId}/state`);
  }

  async getSpaceState(spaceId: string, key: string): Promise<SpaceStateEntry> {
    return this.request<SpaceStateEntry>(`/spaces/${spaceId}/state/${encodeURIComponent(key)}`);
  }

  async putSpaceState(spaceId: string, key: string, value: string): Promise<SpaceStateEntry> {
    return this.request<SpaceStateEntry>(`/spaces/${spaceId}/state/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }

  async downloadFile(spaceId: string, path: string, saveTo: string): Promise<number> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.baseUrl}/api/spaces/${spaceId}/files/${encodedPath}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`DocuVault API error ${response.status}: ${response.statusText}${body ? ` - ${body}` : ''}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(saveTo, buffer);
    return buffer.length;
  }

  async uploadFile(spaceId: string, localPath: string, folder?: string): Promise<{ path: string; name: string }[]> {
    const url = `${this.baseUrl}/api/spaces/${spaceId}/documents/upload`;
    const fileBuffer = await readFile(localPath);
    const fileName = basename(localPath);
    const blob = new Blob([fileBuffer]);

    const formData = new FormData();
    formData.append('files', blob, fileName);
    if (folder) {
      formData.append('folder', folder);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`DocuVault API error ${response.status}: ${response.statusText}${body ? ` - ${body}` : ''}`);
    }

    return response.json() as Promise<{ path: string; name: string }[]>;
  }
}
