export interface Space {
  id: string;
  name: string;
  slug: string;
  description?: string;
  type: 'GROUP' | 'REPOSITORY';
  parentId?: string;
  fullPath: string;
  branch: string;
  syncEnabled: boolean;
  lastSyncedAt?: string;
  documentCount?: number;
  childCount?: number;
  logoUrl?: string;
}

export interface SearchResult {
  documentPath: string;
  documentTitle: string;
  spaceId: string;
  spaceName: string;
  spaceFullPath: string;
  snippet?: string;
  updatedAt: string;
}

export interface SemanticSearchResult {
  documentPath: string;
  documentTitle: string;
  content: string;
  spaceId: string;
  spaceName?: string;
  spaceFullPath?: string;
}

export interface FileTreeEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
}
