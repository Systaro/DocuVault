import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SettingValue {
  value: string;
  source: 'database' | 'environment';
  masked: boolean;
  configured?: boolean;
}

export interface AppSettings {
  'gitlab.url': SettingValue;
  'gitlab.token': SettingValue;
  'openai.api-key': SettingValue;
  'openai.chat-model': SettingValue;
  'openai.edit-model'?: SettingValue;
  'openai.embedding-model': SettingValue;
  'mail.host'?: SettingValue;
  'mail.port'?: SettingValue;
  'mail.username'?: SettingValue;
  'mail.password'?: SettingValue;
  'mail.starttls'?: SettingValue;
  'mail.from-address'?: SettingValue;
  'mail.from-name'?: SettingValue;
  'pdf.render-url'?: SettingValue;
  'pdf.api-key'?: SettingValue;
}

export interface UpdateSettingsRequest {
  gitlabUrl?: string;
  gitlabToken?: string;
  openaiApiKey?: string;
  openaiChatModel?: string;
  openaiEditModel?: string;
  openaiEmbeddingModel?: string;
  mailHost?: string;
  mailPort?: number;
  mailUsername?: string;
  mailPassword?: string;
  mailStartTls?: boolean;
  mailFromAddress?: string;
  mailFromName?: string;
  pdfRenderUrl?: string;
  pdfApiKey?: string;
}

export interface TestResult {
  success: boolean;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private http: HttpClient) {}

  getSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/settings');
  }

  updateSettings(request: UpdateSettingsRequest): Observable<{ message: string }> {
    return this.http.put<{ message: string }>('/api/settings', request);
  }

  testGitlab(url?: string, token?: string): Observable<TestResult> {
    return this.http.post<TestResult>('/api/settings/test-gitlab', { url, token });
  }

  testOpenai(apiKey?: string, model?: string): Observable<TestResult> {
    return this.http.post<TestResult>('/api/settings/test-openai', { apiKey, model });
  }

  testEmail(to: string): Observable<TestResult> {
    return this.http.post<TestResult>('/api/settings/test-email', { to });
  }
}
