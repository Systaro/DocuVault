import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SpacesService, Space, SpacePermission } from '../../core/api/spaces.service';
import { UsersService } from '../../core/api/users.service';
import { TeamsService, Team, TeamSpacePermission } from '../../core/api/teams.service';
import { User } from '../../core/auth/auth.service';
import { LogoUploadComponent } from '../../shared/components/logo-upload.component';
import { ToastService } from '../../shared/services/toast.service';
import { InboxService, RoutingRule, RuleType, RuleAction } from '../../core/api/inbox.service';
import { AnnotationsService } from '../../core/api/annotations.service';
import { spaceRoute } from '../../shared/utils/route-utils';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';

interface SpaceTokenDto {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

@Component({
  selector: 'app-space-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, LogoUploadComponent, SearchableSelectComponent],
  template: `
    <div class="p-8">
      <div class="max-w-2xl mx-auto">
        <h1 class="text-2xl font-bold text-gray-900 mb-8">
          {{ space()?.type === 'GROUP' ? 'Group' : 'Space' }} Settings
        </h1>

        @if (space()) {
          <!-- General Settings -->
          <div class="card p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-4">General</h2>
            <form (ngSubmit)="saveSettings()" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Space ID</label>
                <div class="flex gap-2 items-center">
                  <input
                    type="text"
                    [value]="space()?.id"
                    readonly
                    class="input font-mono text-sm text-gray-500 bg-gray-50 cursor-default"
                  />
                  <button type="button" (click)="copySpaceId()" class="btn btn-secondary shrink-0">
                    {{ copied() ? 'Copied!' : 'Copy' }}
                  </button>
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Logo</label>
                <app-logo-upload
                  [currentLogoUrl]="space()?.logoUrl || null"
                  (fileSelected)="onLogoSelected($event)"
                  (logoRemoved)="onLogoRemoved()"
                ></app-logo-upload>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  [(ngModel)]="settings.name"
                  name="name"
                  class="input"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  [(ngModel)]="settings.description"
                  name="description"
                  class="input"
                  rows="3"
                ></textarea>
              </div>

              <!-- Git settings only for repositories -->
              @if (space()?.type === 'REPOSITORY') {
                @if (space()?.gitlabUrl) {
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">GitLab Repository</label>
                    <div class="gitlab-repo-link">
                      <svg class="gitlab-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 00-.867 0L16.418 9.45H7.582L4.918 1.263a.455.455 0 00-.867 0L1.387 9.452.045 13.587a.924.924 0 00.331 1.023L12 23.054l11.624-8.443a.92.92 0 00.331-1.024"/>
                      </svg>
                      <a [href]="space()!.gitlabUrl" target="_blank" rel="noopener" class="repo-url">
                        {{ getRepoPath(space()!.gitlabUrl!) }}
                      </a>
                      <svg class="external-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                      </svg>
                    </div>
                  </div>
                }

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                  <input
                    type="text"
                    [(ngModel)]="settings.branch"
                    name="branch"
                    class="input"
                  />
                </div>

                <div class="flex items-center justify-between">
                  <div class="flex items-center">
                    <input
                      type="checkbox"
                      [(ngModel)]="settings.syncEnabled"
                      name="syncEnabled"
                      id="syncEnabled"
                      class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <label for="syncEnabled" class="ml-2 text-sm text-gray-700">
                      Enable automatic sync
                    </label>
                  </div>
                </div>

                @if (settings.syncEnabled) {
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Sync interval (minutes)
                    </label>
                    <input
                      type="number"
                      [(ngModel)]="settings.syncIntervalMinutes"
                      name="syncIntervalMinutes"
                      class="input w-32"
                      min="5"
                      max="1440"
                    />
                  </div>
                }
              }

              <div class="flex justify-end pt-4">
                <button type="submit" [disabled]="saving()" class="btn btn-primary">
                  @if (saving()) {
                    Saving...
                  } @else {
                    Save Changes
                  }
                </button>
              </div>
            </form>
          </div>

          <!-- Location / Move to Group (only for spaces that can be moved) -->
          @if (space()?.type === 'REPOSITORY' || (space()?.type === 'GROUP' && !space()?.parentId)) {
            <div class="card p-6 mb-6">
              <h2 class="font-semibold text-gray-900 mb-4">Location</h2>
              <p class="text-sm text-gray-600 mb-4">
                Move this {{ space()?.type === 'GROUP' ? 'group' : 'repository' }} to a different parent group.
              </p>

              <div class="flex gap-2 items-end">
                <div class="flex-1">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Parent Group</label>
                  <app-searchable-select
                    [options]="parentGroupOptions()"
                    [(ngModel)]="selectedParentId"
                    placeholder="Select parent group"
                    searchPlaceholder="Search groups..."
                  />
                </div>
                <button
                  (click)="moveToGroup()"
                  [disabled]="moving() || selectedParentId === (space()?.parentId || '')"
                  class="btn btn-secondary"
                >
                  @if (moving()) {
                    Moving...
                  } @else {
                    Move
                  }
                </button>
              </div>

              @if (space()?.parentId) {
                <p class="text-sm text-gray-500 mt-2">
                  Currently in: <strong>{{ space()?.parentSlug }}</strong>
                </p>
              } @else {
                <p class="text-sm text-gray-500 mt-2">
                  Currently at: <strong>Top Level</strong>
                </p>
              }
            </div>
          }

          <!-- Permissions -->
          <div class="card p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-4">Permissions</h2>

            @if (space()?.parentId) {
              <p class="text-sm text-gray-500 mb-4">
                <span class="material-icons text-sm align-middle">info</span>
                Permissions are inherited from the parent group. Add permissions here to override.
              </p>
            }

            @if (permissions().length === 0) {
              <p class="text-gray-600 text-sm">No direct permissions configured.</p>
            } @else {
              <div class="divide-y divide-gray-200">
                @for (perm of permissions(); track perm.id) {
                  <div class="flex items-center justify-between py-3">
                    <div>
                      <div class="font-medium text-gray-900">{{ perm.userName }}</div>
                      <div class="text-sm text-gray-500">{{ perm.userEmail }}</div>
                    </div>
                    <div class="flex items-center gap-4">
                      <app-searchable-select
                        class="w-32 text-sm"
                        [options]="permissionOptions"
                        [ngModel]="perm.permissionLevel"
                        (ngModelChange)="updatePermission(perm.userId, $event)"
                        [searchable]="false"
                      />
                      <button
                        (click)="removePermission(perm.userId)"
                        class="text-red-600 hover:text-red-700"
                      >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                }
              </div>
            }

            <!-- Add User -->
            <div class="mt-4 pt-4 border-t border-gray-200">
              <div class="flex gap-2">
                <app-searchable-select
                  class="flex-1"
                  [options]="userOptions()"
                  [(ngModel)]="newPermission.userId"
                  placeholder="Select a user..."
                  searchPlaceholder="Search users..."
                />
                <app-searchable-select
                  class="w-32"
                  [options]="permissionOptions"
                  [(ngModel)]="newPermission.level"
                  [searchable]="false"
                />
                <button
                  (click)="addPermission()"
                  [disabled]="!newPermission.userId"
                  class="btn btn-primary"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          <!-- Team access -->
          <div class="card p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-1">Team Access</h2>
            <p class="text-sm text-gray-500 mb-4">
              Every member of a listed team gets this access, without needing an individual entry above.
            </p>

            @if (teamPermissions().length === 0) {
              <p class="text-gray-600 text-sm">No teams have access to this space.</p>
            } @else {
              <div class="divide-y divide-gray-200">
                @for (perm of teamPermissions(); track perm.spaceId + perm.teamId) {
                  <div class="flex items-center justify-between py-3">
                    <div class="flex items-center gap-2">
                      <span class="material-icons text-gray-400">groups</span>
                      <span class="font-medium text-gray-900">{{ perm.teamName }}</span>
                    </div>
                    <div class="flex items-center gap-4">
                      <app-searchable-select
                        class="w-32 text-sm"
                        [options]="permissionOptions"
                        [ngModel]="perm.permissionLevel"
                        (ngModelChange)="updateTeamPermission(perm.teamId, $event)"
                        [searchable]="false"
                      />
                      <button
                        (click)="removeTeamPermission(perm.teamId)"
                        class="text-red-600 hover:text-red-700"
                        [attr.aria-label]="'Remove ' + perm.teamName"
                      >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                }
              </div>
            }

            <!-- Add Team -->
            <div class="mt-4 pt-4 border-t border-gray-200">
              <div class="flex gap-2">
                <app-searchable-select
                  class="flex-1"
                  [options]="teamOptions()"
                  [(ngModel)]="newTeamPermission.teamId"
                  placeholder="Select a team..."
                  searchPlaceholder="Search teams..."
                />
                <app-searchable-select
                  class="w-32"
                  [options]="permissionOptions"
                  [(ngModel)]="newTeamPermission.level"
                  [searchable]="false"
                />
                <button
                  (click)="addTeamPermission()"
                  [disabled]="!newTeamPermission.teamId"
                  class="btn btn-primary"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          <!-- Auto-filing Rules -->
          @if (space()?.type === 'REPOSITORY') {
            <div class="card p-6 mb-6">
              <h2 class="font-semibold text-gray-900 mb-1">Auto-filing Rules</h2>
              <p class="text-sm text-gray-500 mb-4">Rules automatically route matching inbox notes to the right document.</p>

              @if (rules().length === 0) {
                <p class="text-sm text-gray-500 mb-4">No rules yet.</p>
              } @else {
                <div class="divide-y divide-gray-100 mb-4">
                  @for (rule of rules(); track rule.id) {
                    <div class="flex items-center justify-between py-3 gap-3">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="rule-type-badge">{{ rule.type }}</span>
                          <code class="rule-condition">{{ rule.condition }}</code>
                        </div>
                        <div class="text-xs text-gray-500">
                          → {{ rule.targetDocumentPath || rule.targetGroupPath || 'new document' }}
                          @if (rule.description) { · {{ rule.description }} }
                        </div>
                      </div>
                      <div class="flex items-center gap-3 flex-shrink-0">
                        <label class="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            [checked]="rule.autoFile"
                            (change)="toggleAutoFile(rule, $event)"
                          />
                          Auto-file
                        </label>
                        <button class="icon-btn" (click)="deleteRule(rule.id)" title="Delete rule">
                          <span class="material-icons" style="font-size:16px">delete_outline</span>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Add rule form -->
              <details class="add-rule-details">
                <summary class="text-sm font-medium text-gray-700 cursor-pointer mb-3">+ Add rule</summary>
                <div class="add-rule-form">
                  <div class="flex gap-2 flex-wrap">
                    <app-searchable-select
                      [options]="ruleTypeOptions"
                      [(ngModel)]="newRule.type"
                      [searchable]="false"
                    />
                    <input
                      type="text"
                      [(ngModel)]="newRule.condition"
                      class="input input-sm flex-1"
                      placeholder="e.g. meeting notes or #incident"
                    />
                    <app-searchable-select
                      [options]="ruleActionOptions"
                      [(ngModel)]="newRule.actionType"
                      [searchable]="false"
                    />
                  </div>
                  <div class="flex gap-2 flex-wrap mt-2">
                    <input
                      type="text"
                      [(ngModel)]="newRule.targetDocumentPath"
                      class="input input-sm flex-1"
                      placeholder="Target document path (e.g. docs/meetings.md)"
                    />
                    <label class="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                      <input type="checkbox" [(ngModel)]="newRule.autoFile" />
                      Auto-file (no prompt)
                    </label>
                    <button
                      class="btn btn-primary btn-sm"
                      [disabled]="!newRule.condition"
                      (click)="addRule()"
                    >
                      Add Rule
                    </button>
                  </div>
                </div>
              </details>
            </div>
          }

          <!-- State Script -->
          @if (space()?.type === 'REPOSITORY') {
            <div class="card p-6 mb-6">
              <div class="flex items-center gap-2 mb-1">
                <h2 class="font-semibold text-gray-900">State Script</h2>
                <button class="state-help-btn" (click)="stateHelpOpen.set(!stateHelpOpen())" title="How to use State">
                  <span class="material-icons" style="font-size:18px">help_outline</span>
                </button>
              </div>

              @if (stateHelpOpen()) {
                <div class="state-help-panel mb-4">
                  <div class="flex items-center justify-between mb-3">
                    <span class="state-help-title">How to use DocuVault State</span>
                    <button class="state-help-close" (click)="stateHelpOpen.set(false)">
                      <span class="material-icons" style="font-size:16px">close</span>
                    </button>
                  </div>

                  <p class="state-help-text mb-3">
                    DocuVault State lets interactive HTML files (forms, dashboards, checklists) persist data server-side
                    without creating Git commits. State is stored per <strong>space + key</strong> in the database and can be
                    read/written from any device.
                  </p>

                  <h4 class="state-help-subtitle">Setup (3 steps)</h4>
                  <ol class="state-help-list mb-3">
                    <li><strong>Create a Space Token</strong> — click "+ New token" below. Copy the <code>dvs_…</code> token immediately; it is shown only once.</li>
                    <li><strong>Choose a State Key</strong> — a unique name for this state bucket (e.g. <code>pilot-assignments</code>). One key = one JSON object in the database.</li>
                    <li><strong>Paste the snippet</strong> — copy the generated <code>&lt;script&gt;</code> block into your HTML file, right before your own scripts.</li>
                  </ol>

                  <h4 class="state-help-subtitle">Reading state</h4>
                  <pre class="state-help-code">const state = await DocuVaultState.ready();
const value = state.get('assignee');     // single key
const all   = state.getAll();            // full object</pre>

                  <h4 class="state-help-subtitle">Writing state</h4>
                  <pre class="state-help-code">state.set('assignee', 'Anna');
state.set('votes', {{ '{' }} 0: 3, 1: 5 {{ '}' }});
await state.save();                      // persists to DB</pre>

                  <h4 class="state-help-subtitle">Removing a key</h4>
                  <pre class="state-help-code">state.remove('assignee');
await state.save();</pre>

                  <h4 class="state-help-subtitle">Full example</h4>
                  <pre class="state-help-code">&lt;script src="/assets/docuvault-state.js"&gt;&lt;/script&gt;
&lt;script&gt;
  DocuVaultState.init({{ '{' }}
    spaceId: 'YOUR_SPACE_ID',
    key:     'my-form',
    token:   'dvs_…'
  {{ '}' }});

  async function main() {{ '{' }}
    const state = await DocuVaultState.ready();

    // Load saved data
    const saved = state.get('formData');
    if (saved) populateForm(saved);

    // Save on button click
    document.getElementById('save')
      .addEventListener('click', async () => {{ '{' }}
        state.set('formData', collectForm());
        await state.save();
      {{ '}' }});
  {{ '}' }}
  main();
&lt;/script&gt;</pre>

                  <h4 class="state-help-subtitle">API reference</h4>
                  <table class="state-help-table">
                    <tr><td><code>DocuVaultState.init(config)</code></td><td>Initialize with <code>spaceId</code>, <code>key</code>, and optional <code>token</code>. Triggers an immediate load.</td></tr>
                    <tr><td><code>DocuVaultState.ready()</code></td><td>Returns a Promise resolving to the state handle once loaded.</td></tr>
                    <tr><td><code>state.get(key)</code></td><td>Read a value from in-memory state.</td></tr>
                    <tr><td><code>state.getAll()</code></td><td>Get a shallow copy of the full state object.</td></tr>
                    <tr><td><code>state.set(key, value)</code></td><td>Set a value in memory (not persisted until <code>save()</code>).</td></tr>
                    <tr><td><code>state.remove(key)</code></td><td>Delete a key from memory (not persisted until <code>save()</code>).</td></tr>
                    <tr><td><code>state.save()</code></td><td>Persist current state to the database via <code>PUT</code>.</td></tr>
                    <tr><td><code>DocuVaultState.clearToken()</code></td><td>Clear the stored token. Next <code>save()</code> will re-prompt.</td></tr>
                  </table>

                  <h4 class="state-help-subtitle">Notes</h4>
                  <ul class="state-help-list">
                    <li>Each <code>save()</code> overwrites the entire state object for that key — there is no partial/merge update.</li>
                    <li>If multiple users edit concurrently, the last <code>save()</code> wins. For collaborative use, consider loading fresh state before saving (see <code>DocuVaultState.ready()</code>).</li>
                    <li>The token is stored in <code>localStorage</code> on the user's browser. If no token is configured in the snippet, the user will be prompted on first save.</li>
                    <li>State is scoped to a single space. Different spaces cannot share state.</li>
                  </ul>
                </div>
              }

              <p class="text-sm text-gray-500 mb-4">
                Add persistent, cross-device state to any interactive HTML file hosted in this space.
                Create a space token, enter a key for the state bucket, then paste the snippet into your HTML.
              </p>

              <!-- Token list -->
              <div class="mb-4">
                <div class="flex items-center justify-between mb-2">
                  <label class="text-sm font-medium text-gray-700">Space Tokens</label>
                  @if (!creatingToken()) {
                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px" (click)="startCreateToken()">
                      + New token
                    </button>
                  }
                </div>

                @if (creatingToken()) {
                  <div class="flex gap-2 mb-3">
                    <input
                      type="text"
                      [(ngModel)]="newTokenName"
                      name="newTokenName"
                      class="input text-sm flex-1"
                      placeholder="Token name (e.g. Pilot Form)"
                      (keydown.enter)="createToken()"
                      (keydown.escape)="cancelCreateToken()"
                    />
                    <button class="btn btn-primary" style="padding:4px 12px;font-size:12px" (click)="createToken()" [disabled]="!newTokenName.trim()">Create</button>
                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px" (click)="cancelCreateToken()">Cancel</button>
                  </div>
                }

                @if (newTokenValue()) {
                  <div class="new-token-banner">
                    <div class="text-xs text-yellow-200 mb-1 font-medium">Token created — copy it now, it won't be shown again.</div>
                    <div class="flex gap-2 items-center">
                      <code class="flex-1 text-xs break-all">{{ newTokenValue() }}</code>
                      <button class="snippet-copy-btn" style="position:static" (click)="copyNewToken()">
                        {{ newTokenCopied() ? 'Copied!' : 'Copy' }}
                      </button>
                    </div>
                  </div>
                }

                @if (spaceTokens().length === 0 && !creatingToken()) {
                  <p class="text-sm text-gray-400">No tokens yet.</p>
                } @else {
                  <div class="divide-y divide-gray-100">
                    @for (t of spaceTokens(); track t.id) {
                      <div class="flex items-center justify-between py-2 text-sm">
                        <div>
                          <span class="font-medium text-gray-800">{{ t.name }}</span>
                          <span class="text-gray-400 ml-2 font-mono text-xs">{{ t.tokenPrefix }}…</span>
                          @if (t.revokedAt) {
                            <span class="ml-2 text-xs text-red-500">revoked</span>
                          }
                        </div>
                        @if (!t.revokedAt) {
                          <button class="icon-btn" (click)="revokeToken(t.id)" title="Revoke token">
                            <span class="material-icons" style="font-size:16px">delete_outline</span>
                          </button>
                        }
                      </div>
                    }
                  </div>
                }
              </div>

              <!-- State key + snippet -->
              <div class="mb-3">
                <label class="block text-sm font-medium text-gray-700 mb-1">State key</label>
                <input
                  type="text"
                  [(ngModel)]="stateKey"
                  name="stateKey"
                  class="input font-mono text-sm"
                  placeholder="my-form"
                />
              </div>

              <div class="snippet-wrap">
                <pre class="snippet-pre">{{ getStateSnippet() }}</pre>
                <button class="snippet-copy-btn" (click)="copySnippet()">
                  {{ snippetCopied() ? 'Copied!' : 'Copy' }}
                </button>
              </div>

              <p class="text-xs text-gray-400 mt-3">
                State is stored in the database — no Git commits on every save.
                Click the <span class="material-icons" style="font-size:14px;vertical-align:middle">help_outline</span> icon above for full usage documentation.
              </p>
            </div>
          }

          <!-- Danger Zone -->
          <div class="card p-6 border-red-200">
            <h2 class="font-semibold text-red-600 mb-4">Danger Zone</h2>
            <p class="text-sm text-gray-600 mb-4">
              @if (space()?.type === 'GROUP') {
                Deleting this group will permanently remove all nested groups and repositories.
              } @else {
                Deleting this space will permanently remove all documents and settings.
              }
              This action cannot be undone.
            </p>
            <button
              (click)="deleteSpace()"
              class="btn btn-danger"
            >
              Delete {{ space()?.type === 'GROUP' ? 'Group' : 'Space' }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .rule-type-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(111, 179, 184, 0.15);
      color: var(--primary-dark);
    }
    .rule-condition {
      font-size: 12px;
      background: var(--background);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: 'Monaco','Menlo',monospace;
      color: var(--text-primary);
    }
    .add-rule-details summary { list-style: none; }
    .add-rule-details summary::-webkit-details-marker { display: none; }
    .add-rule-form { margin-top: 10px; }
    .add-rule-form app-searchable-select { flex: 0 0 auto; min-width: 150px; }
    .input-sm { padding: 5px 8px; font-size: 13px; }
    .icon-btn { background: none; border: none; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; padding: 4px; border-radius: 4px; transition: color 0.15s; }
    .icon-btn:hover { color: #dc2626; }

    .snippet-wrap { position: relative; }
    .snippet-pre {
      background: #1e1f2e;
      color: #e2e4f0;
      border-radius: 6px;
      padding: 16px;
      font-family: 'SFMono-Regular', 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre;
      overflow-x: auto;
    }
    .snippet-copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: #c9cdd4;
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .snippet-copy-btn:hover { background: rgba(255,255,255,0.18); }
    .new-token-banner {
      background: #2a1f00;
      border: 1px solid #7a5c00;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 12px;
    }
    .gitlab-repo-link {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--background, #f9fafb);
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 6px;
    }
    .gitlab-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      color: #e24329;
    }
    .repo-url {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 13px;
      color: var(--primary, #0d9488);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .repo-url:hover {
      text-decoration: underline;
    }
    .external-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      color: var(--text-muted, #9ca3af);
    }

    .state-help-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted, #9ca3af);
      display: flex;
      align-items: center;
      padding: 2px;
      border-radius: 50%;
      transition: color 0.15s, background 0.15s;
    }
    .state-help-btn:hover {
      color: var(--primary, #0d9488);
      background: rgba(13, 148, 136, 0.08);
    }
    .state-help-panel {
      background: var(--background, #f9fafb);
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 8px;
      padding: 16px 20px;
    }
    .state-help-title {
      font-weight: 600;
      font-size: 14px;
      color: var(--text-primary, #111827);
    }
    .state-help-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted, #9ca3af);
      display: flex;
      align-items: center;
      padding: 2px;
      border-radius: 4px;
      transition: color 0.15s;
    }
    .state-help-close:hover { color: var(--text-primary, #111827); }
    .state-help-text {
      font-size: 13px;
      color: var(--text-secondary, #6b7280);
      line-height: 1.6;
    }
    .state-help-subtitle {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-primary, #111827);
      margin: 12px 0 6px;
    }
    .state-help-list {
      font-size: 13px;
      color: var(--text-secondary, #6b7280);
      padding-left: 20px;
      line-height: 1.7;
    }
    .state-help-list code {
      font-size: 12px;
      background: rgba(0,0,0,0.06);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .state-help-code {
      background: #1e1f2e;
      color: #e2e4f0;
      border-radius: 6px;
      padding: 12px 14px;
      font-family: 'SFMono-Regular', 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre;
      overflow-x: auto;
      margin-bottom: 4px;
    }
    .state-help-table {
      width: 100%;
      font-size: 13px;
      border-collapse: collapse;
    }
    .state-help-table td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border, #e5e7eb);
      vertical-align: top;
      color: var(--text-secondary, #6b7280);
    }
    .state-help-table td:first-child {
      white-space: nowrap;
      font-family: 'SFMono-Regular', 'Fira Code', monospace;
      font-size: 12px;
      color: var(--text-primary, #111827);
    }
    .state-help-table code {
      font-size: 12px;
      background: rgba(0,0,0,0.06);
      padding: 1px 4px;
      border-radius: 3px;
    }
  `]
})
export class SpaceSettingsComponent implements OnInit {
  space = signal<Space | null>(null);
  permissions = signal<SpacePermission[]>([]);
  teamPermissions = signal<TeamSpacePermission[]>([]);
  availableTeams = signal<Team[]>([]);
  availableUsers = signal<User[]>([]);
  availableGroups = signal<Space[]>([]);
  rules = signal<RoutingRule[]>([]);
  spaceTokens = signal<SpaceTokenDto[]>([]);
  saving = signal(false);
  moving = signal(false);
  copied = signal(false);
  snippetCopied = signal(false);
  stateHelpOpen = signal(false);
  creatingToken = signal(false);
  newTokenValue = signal<string | null>(null);
  newTokenCopied = signal(false);
  selectedParentId = '';
  stateKey = '';
  newTokenName = '';

  readonly permissionOptions: SelectOption[] = [
    { value: 'VIEW', label: 'View' },
    { value: 'EDIT', label: 'Edit' },
    { value: 'ADMIN', label: 'Admin' }
  ];

  readonly ruleTypeOptions: SelectOption[] = [
    { value: 'CATEGORY', label: 'Category' },
    { value: 'PATTERN', label: 'Pattern' }
  ];

  readonly ruleActionOptions: SelectOption[] = [
    { value: 'APPEND_TO_DOCUMENT', label: 'Append to doc' },
    { value: 'CREATE_DOCUMENT', label: 'Create new doc' }
  ];

  parentGroupOptions = computed<SelectOption[]>(() => {
    const options: SelectOption[] = [];
    if (this.space()?.type === 'GROUP') {
      options.push({ value: '', label: 'Top Level (no parent)' });
    }
    const selfId = this.space()?.id;
    for (const group of this.availableGroups()) {
      options.push({ value: group.id, label: group.fullPath, disabled: group.id === selfId });
    }
    return options;
  });

  userOptions = computed<SelectOption[]>(() =>
    this.availableUsers().map(user => ({ value: user.id, label: user.name, sublabel: user.email }))
  );

  teamOptions = computed<SelectOption[]>(() => {
    const taken = new Set(this.teamPermissions().map(p => p.teamId));
    return this.availableTeams()
      .filter(team => !taken.has(team.id))
      .map(team => ({ value: team.id, label: team.name, sublabel: `${team.memberCount} member(s)` }));
  });

  newTeamPermission = {
    teamId: '',
    level: 'VIEW'
  };

  newRule = {
    type: 'CATEGORY' as RuleType,
    condition: '',
    actionType: 'APPEND_TO_DOCUMENT' as RuleAction,
    targetDocumentPath: '',
    autoFile: false
  };

  settings = {
    name: '',
    description: '',
    branch: '',
    syncEnabled: true,
    syncIntervalMinutes: 15
  };

  newPermission = {
    userId: '',
    level: 'VIEW'
  };

  pendingLogoFile: File | null = null;
  pendingLogoRemoval = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private spacesService: SpacesService,
    private usersService: UsersService,
    private teamsService: TeamsService,
    private toastService: ToastService,
    private inboxService: InboxService,
    private annotationsService: AnnotationsService
  ) {}

  ngOnInit(): void {
    // Get the full path from parent route params
    this.route.parent?.paramMap.subscribe(params => {
      const path1 = params.get('path1');
      const path2 = params.get('path2');
      const path3 = params.get('path3');

      const fullPath = [path1, path2, path3].filter(Boolean).join('/');
      if (fullPath) {
        this.loadSpaceByPath(fullPath);
      }
    });
    this.loadUsers();
    this.loadTeams();
    this.loadGroups();
  }

  loadSpaceByPath(fullPath: string): void {
    this.spacesService.getSpaceByPath(fullPath).subscribe({
      next: (space) => {
        // Settings are admin-only (the backend rejects non-admins anyway) —
        // bounce deep links from users who merely have view/edit access.
        this.annotationsService.getMyPermission(space.id).subscribe({
          next: (res) => {
            if (res.level !== 'ADMIN') {
              this.redirectNonAdmin(fullPath);
              return;
            }
            this.initSettings(space);
          },
          error: () => this.redirectNonAdmin(fullPath)
        });
      }
    });
  }

  private redirectNonAdmin(fullPath: string): void {
    this.toastService.error('No access', 'Only space admins can open space settings.');
    this.router.navigate(['/spaces', ...fullPath.split('/')]);
  }

  private initSettings(space: Space): void {
    this.space.set(space);
    this.selectedParentId = space.parentId || '';
    this.settings = {
      name: space.name,
      description: space.description || '',
      branch: space.branch,
      syncEnabled: space.syncEnabled,
      syncIntervalMinutes: space.syncIntervalMinutes
    };
    this.loadPermissions(space.id);
    this.loadTeamPermissions(space.id);
    if (space.type === 'REPOSITORY') {
      this.loadRules(space.id);
      this.loadSpaceTokens(space.id);
    }
  }

  loadRules(spaceId: string): void {
    this.inboxService.getRules(spaceId).subscribe({
      next: (rules) => this.rules.set(rules),
      error: () => this.rules.set([])
    });
  }

  addRule(): void {
    const space = this.space();
    if (!space || !this.newRule.condition) return;

    this.inboxService.createRule(space.id, {
      type: this.newRule.type,
      condition: this.newRule.condition,
      actionType: this.newRule.actionType,
      targetDocumentPath: this.newRule.targetDocumentPath || undefined,
      autoFile: this.newRule.autoFile
    }).subscribe({
      next: (rule) => {
        this.rules.update(rules => [...rules, rule]);
        this.newRule = { type: 'CATEGORY', condition: '', actionType: 'APPEND_TO_DOCUMENT', targetDocumentPath: '', autoFile: false };
        this.toastService.success('Rule added', 'Routing rule saved successfully.');
      },
      error: () => this.toastService.error('Error', 'Failed to add rule')
    });
  }

  toggleAutoFile(rule: RoutingRule, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.inboxService.updateRule(rule.spaceId, rule.id, { autoFile: checked }).subscribe({
      next: (updated) => {
        this.rules.update(rules => rules.map(r => r.id === updated.id ? updated : r));
      },
      error: () => this.toastService.error('Error', 'Failed to update rule')
    });
  }

  deleteRule(ruleId: string): void {
    const space = this.space();
    if (!space) return;

    this.inboxService.deleteRule(space.id, ruleId).subscribe({
      next: () => {
        this.rules.update(rules => rules.filter(r => r.id !== ruleId));
        this.toastService.success('Rule deleted', 'The routing rule has been removed.');
      },
      error: () => this.toastService.error('Error', 'Failed to delete rule')
    });
  }

  loadGroups(): void {
    // Load all groups to populate the "move to" dropdown
    this.spacesService.getSpaces().subscribe({
      next: (spaces) => {
        // Filter to only groups that can be parents (top-level groups and subgroups)
        const groups = spaces.filter(s => s.type === 'GROUP');
        this.availableGroups.set(groups);
      }
    });
  }

  moveToGroup(): void {
    const space = this.space();
    if (!space) return;

    const newParentId = this.selectedParentId || null;
    if (newParentId === (space.parentId || '')) return;

    this.moving.set(true);

    // Build the update payload
    const payload: any = {};
    if (newParentId) {
      payload.parentId = newParentId;
    } else {
      payload.clearParent = true;
    }

    this.spacesService.updateSpace(space.id, payload).subscribe({
      next: (updated) => {
        this.space.set(updated);
        this.moving.set(false);
        this.toastService.success('Moved', `${space.name} has been moved successfully.`);
        // Navigate to new location
        this.router.navigate(spaceRoute(updated.fullPath, 'settings'));
      },
      error: (err) => {
        this.moving.set(false);
        this.toastService.error('Move Failed', err.error?.message || 'Failed to move space');
      }
    });
  }

  loadPermissions(spaceId: string): void {
    this.spacesService.getPermissions(spaceId).subscribe({
      next: (perms) => this.permissions.set(perms)
    });
  }

  loadUsers(): void {
    this.usersService.getUsers().subscribe({
      next: (users) => this.availableUsers.set(users)
    });
  }

  saveSettings(): void {
    const space = this.space();
    if (!space) return;

    this.saving.set(true);

    // First save settings
    this.spacesService.updateSpace(space.id, this.settings).subscribe({
      next: (updated) => {
        this.space.set(updated);

        // Then handle logo changes
        if (this.pendingLogoRemoval) {
          this.spacesService.deleteLogo(space.id).subscribe({
            next: (result) => {
              this.space.set(result);
              this.pendingLogoRemoval = false;
              this.saving.set(false);
            },
            error: () => this.saving.set(false)
          });
        } else if (this.pendingLogoFile) {
          this.spacesService.uploadLogo(space.id, this.pendingLogoFile).subscribe({
            next: (result) => {
              this.space.set(result);
              this.pendingLogoFile = null;
              this.saving.set(false);
            },
            error: () => this.saving.set(false)
          });
        } else {
          this.saving.set(false);
        }
      },
      error: () => {
        this.saving.set(false);
      }
    });
  }

  addPermission(): void {
    const space = this.space();
    if (!space || !this.newPermission.userId) return;

    this.spacesService.addPermission(
      space.id,
      this.newPermission.userId,
      this.newPermission.level
    ).subscribe({
      next: () => {
        this.loadPermissions(space.id);
        this.newPermission = { userId: '', level: 'VIEW' };
      }
    });
  }

  updatePermission(userId: string, level: string): void {
    const space = this.space();
    if (!space) return;

    this.spacesService.addPermission(space.id, userId, level).subscribe();
  }

  removePermission(userId: string): void {
    const space = this.space();
    if (!space) return;

    if (confirm('Remove this user\'s access to the space?')) {
      this.spacesService.removePermission(space.id, userId).subscribe({
        next: () => this.loadPermissions(space.id)
      });
    }
  }

  loadTeamPermissions(spaceId: string): void {
    this.teamsService.getSpaceTeamPermissions(spaceId).subscribe({
      next: (perms) => this.teamPermissions.set(perms),
      error: () => this.teamPermissions.set([])
    });
  }

  loadTeams(): void {
    this.teamsService.getTeams().subscribe({
      next: (teams) => this.availableTeams.set(teams)
    });
  }

  addTeamPermission(): void {
    const space = this.space();
    if (!space || !this.newTeamPermission.teamId) return;

    this.teamsService.addSpaceTeamPermission(
      space.id,
      this.newTeamPermission.teamId,
      this.newTeamPermission.level
    ).subscribe({
      next: () => {
        this.loadTeamPermissions(space.id);
        this.newTeamPermission = { teamId: '', level: 'VIEW' };
      },
      error: () => this.toastService.error('Grant Failed', 'The team could not be given access.')
    });
  }

  updateTeamPermission(teamId: string, level: string): void {
    const space = this.space();
    if (!space) return;

    this.teamsService.addSpaceTeamPermission(space.id, teamId, level).subscribe({
      next: () => this.loadTeamPermissions(space.id)
    });
  }

  removeTeamPermission(teamId: string): void {
    const space = this.space();
    if (!space) return;

    this.teamsService.removeSpaceTeamPermission(space.id, teamId).subscribe({
      next: () => this.loadTeamPermissions(space.id),
      error: () => this.toastService.error('Remove Failed', 'The team grant could not be removed.')
    });
  }

  loadSpaceTokens(spaceId: string): void {
    this.http.get<SpaceTokenDto[]>(`/api/spaces/${spaceId}/tokens`).subscribe({
      next: (tokens) => this.spaceTokens.set(tokens),
      error: () => this.spaceTokens.set([])
    });
  }

  startCreateToken(): void {
    this.newTokenName = '';
    this.creatingToken.set(true);
  }

  cancelCreateToken(): void {
    this.creatingToken.set(false);
    this.newTokenName = '';
  }

  createToken(): void {
    const space = this.space();
    if (!space || !this.newTokenName.trim()) return;

    this.http.post<{ token: SpaceTokenDto; rawToken: string }>(
      `/api/spaces/${space.id}/tokens`,
      { name: this.newTokenName.trim() }
    ).subscribe({
      next: ({ token, rawToken }) => {
        this.spaceTokens.update(ts => [token, ...ts]);
        this.newTokenValue.set(rawToken);
        this.creatingToken.set(false);
        this.newTokenName = '';
      },
      error: () => this.toastService.error('Error', 'Failed to create token')
    });
  }

  revokeToken(tokenId: string): void {
    const space = this.space();
    if (!space) return;

    this.http.delete(`/api/spaces/${space.id}/tokens/${tokenId}`).subscribe({
      next: () => {
        this.spaceTokens.update(ts =>
          ts.map(t => t.id === tokenId ? { ...t, revokedAt: new Date().toISOString() } : t)
        );
        if (this.newTokenValue()) this.newTokenValue.set(null);
        this.toastService.success('Token revoked', 'The space token has been revoked.');
      },
      error: () => this.toastService.error('Error', 'Failed to revoke token')
    });
  }

  copyNewToken(): void {
    const token = this.newTokenValue();
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      this.newTokenCopied.set(true);
      setTimeout(() => this.newTokenCopied.set(false), 2000);
    });
  }

  getStateSnippet(): string {
    const spaceId = this.space()?.id ?? 'YOUR_SPACE_ID';
    const key     = this.stateKey.trim() || 'my-form';
    const token   = this.newTokenValue() ?? (this.spaceTokens().find(t => !t.revokedAt)?.tokenPrefix + '…') ?? 'dvs_…';
    return `<script src="/assets/docuvault-state.js"></script>\n<script>\n  DocuVaultState.init({\n    spaceId: '${spaceId}',\n    key:     '${key}',\n    token:   '${token}'\n  });\n</script>`;
  }

  copySnippet(): void {
    navigator.clipboard.writeText(this.getStateSnippet()).then(() => {
      this.snippetCopied.set(true);
      setTimeout(() => this.snippetCopied.set(false), 2000);
    });
  }

  copySpaceId(): void {
    const id = this.space()?.id;
    if (!id) return;
    navigator.clipboard.writeText(id).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  onLogoSelected(file: File): void {
    this.pendingLogoFile = file;
    this.pendingLogoRemoval = false;
  }

  onLogoRemoved(): void {
    this.pendingLogoFile = null;
    this.pendingLogoRemoval = true;
  }

  getRepoPath(gitlabUrl: string): string {
    try {
      const url = new URL(gitlabUrl);
      // Strip leading slash and .git suffix
      return url.pathname.replace(/^\//, '').replace(/\.git$/, '');
    } catch {
      return gitlabUrl;
    }
  }

  deleteSpace(): void {
    const space = this.space();
    if (!space) return;

    if (confirm(`Are you sure you want to delete "${space.name}"? This cannot be undone.`)) {
      this.spacesService.deleteSpace(space.id).subscribe({
        next: () => this.router.navigate(['/dashboard'])
      });
    }
  }
}
