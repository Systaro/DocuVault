import type { Space, SearchResult, SemanticSearchResult, FileTreeEntry, UserInfo, DocumentContent, PatchOperation, PatchResult } from './types.js';

export class DocuVaultClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
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

  async searchKeyword(query: string, limit: number = 20): Promise<SearchResult[]> {
    return this.request<SearchResult[]>(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async searchSemantic(query: string, spaceId?: string, limit: number = 10): Promise<SemanticSearchResult[]> {
    return this.request<SemanticSearchResult[]>('/search/semantic', {
      method: 'POST',
      body: JSON.stringify({ query, spaceId, limit }),
    });
  }
}
