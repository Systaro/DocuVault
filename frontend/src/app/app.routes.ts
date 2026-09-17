import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

export function askMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments[0]?.path !== 'ask' || segments.length > 2) return null;
  return { consumed: segments, posParams: segments[1] ? { id: segments[1] } : {} };
}

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register.component').then(m => m.RegisterComponent)
  },
  {
    path: 'setup',
    loadComponent: () => import('./features/auth/setup.component').then(m => m.SetupComponent)
  },
  {
    path: 'accept-invitation',
    loadComponent: () => import('./features/auth/accept-invitation.component').then(m => m.AcceptInvitationComponent)
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./features/auth/forgot-password.component').then(m => m.ForgotPasswordComponent)
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./features/auth/reset-password.component').then(m => m.ResetPasswordComponent)
  },
  {
    // OAuth consent for MCP clients (Claude Code, Cursor, ...). The guard runs
    // the normal login first and returns here with the query string intact.
    path: 'oauth/authorize',
    canActivate: [authGuard],
    loadComponent: () => import('./features/auth/oauth-consent.component').then(m => m.OAuthConsentComponent)
  },
  {
    path: 'unsubscribe',
    loadComponent: () => import('./features/public/unsubscribe.component').then(m => m.UnsubscribeComponent)
  },
  {
    path: 'share',
    children: [
      {
        path: '**',
        loadComponent: () => import('./features/public/public-viewer.component').then(m => m.PublicViewerComponent)
      }
    ]
  },
  {
    path: 'preview/:spaceId',
    canActivate: [authGuard],
    loadComponent: () => import('./features/preview/preview.component').then(m => m.PreviewComponent),
    children: [
      {
        path: '**',
        loadComponent: () => import('./features/preview/preview.component').then(m => m.PreviewComponent)
      }
    ]
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'tasks',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/my-tasks.component').then(m => m.MyTasksComponent)
  },
  {
    // /ask and /ask/:id share one route so the page survives the URL change
    // when a new conversation gets its id while its answer is still streaming.
    matcher: askMatcher,
    canActivate: [authGuard],
    loadComponent: () => import('./features/ask/ask.component').then(m => m.AskComponent)
  },
  // Nested path routing for spaces - supports paths like /spaces/group/subgroup/repo
  {
    path: 'spaces',
    canActivate: [authGuard],
    children: [
      {
        path: ':path1',
        loadComponent: () => import('./features/space/space-router.component').then(m => m.SpaceRouterComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/space/space-overview.component').then(m => m.SpaceOverviewComponent)
          },
          {
            path: 'settings',
            loadComponent: () => import('./features/space/space-settings.component').then(m => m.SpaceSettingsComponent)
          },
          {
            path: 'doc',
            loadComponent: () => import('./features/editor/editor.component').then(m => m.EditorComponent),
            // Switching documents only changes ?path=, so without this the guard
            // would never run and the HTML editor's unsaved work would vanish
            // on the next click in the file tree.
            runGuardsAndResolvers: 'paramsOrQueryParamsChange',
            canDeactivate: [unsavedChangesGuard]
          },
          {
            // Old per-space chat links; the assistant now lives at /ask.
            path: 'chat',
            loadComponent: () => import('./features/ask/space-chat-redirect.component').then(m => m.SpaceChatRedirectComponent)
          },
          {
            path: 'inbox',
            loadComponent: () => import('./features/inbox/inbox.component').then(m => m.InboxComponent)
          },
          {
            path: 'tasks',
            loadComponent: () => import('./features/tasks/space-tasks.component').then(m => m.SpaceTasksComponent)
          }
        ]
      },
      {
        path: ':path1/:path2',
        loadComponent: () => import('./features/space/space-router.component').then(m => m.SpaceRouterComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/space/space-overview.component').then(m => m.SpaceOverviewComponent)
          },
          {
            path: 'settings',
            loadComponent: () => import('./features/space/space-settings.component').then(m => m.SpaceSettingsComponent)
          },
          {
            path: 'doc',
            loadComponent: () => import('./features/editor/editor.component').then(m => m.EditorComponent),
            // Switching documents only changes ?path=, so without this the guard
            // would never run and the HTML editor's unsaved work would vanish
            // on the next click in the file tree.
            runGuardsAndResolvers: 'paramsOrQueryParamsChange',
            canDeactivate: [unsavedChangesGuard]
          },
          {
            // Old per-space chat links; the assistant now lives at /ask.
            path: 'chat',
            loadComponent: () => import('./features/ask/space-chat-redirect.component').then(m => m.SpaceChatRedirectComponent)
          },
          {
            path: 'inbox',
            loadComponent: () => import('./features/inbox/inbox.component').then(m => m.InboxComponent)
          },
          {
            path: 'tasks',
            loadComponent: () => import('./features/tasks/space-tasks.component').then(m => m.SpaceTasksComponent)
          }
        ]
      },
      {
        path: ':path1/:path2/:path3',
        loadComponent: () => import('./features/space/space-router.component').then(m => m.SpaceRouterComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/space/space-overview.component').then(m => m.SpaceOverviewComponent)
          },
          {
            path: 'settings',
            loadComponent: () => import('./features/space/space-settings.component').then(m => m.SpaceSettingsComponent)
          },
          {
            path: 'doc',
            loadComponent: () => import('./features/editor/editor.component').then(m => m.EditorComponent),
            // Switching documents only changes ?path=, so without this the guard
            // would never run and the HTML editor's unsaved work would vanish
            // on the next click in the file tree.
            runGuardsAndResolvers: 'paramsOrQueryParamsChange',
            canDeactivate: [unsavedChangesGuard]
          },
          {
            // Old per-space chat links; the assistant now lives at /ask.
            path: 'chat',
            loadComponent: () => import('./features/ask/space-chat-redirect.component').then(m => m.SpaceChatRedirectComponent)
          },
          {
            path: 'inbox',
            loadComponent: () => import('./features/inbox/inbox.component').then(m => m.InboxComponent)
          },
          {
            path: 'tasks',
            loadComponent: () => import('./features/tasks/space-tasks.component').then(m => m.SpaceTasksComponent)
          }
        ]
      }
    ]
  },
  {
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () => import('./features/account/account.component').then(m => m.AccountComponent)
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin/admin.component').then(m => m.AdminComponent),
    children: [
      {
        path: '',
        redirectTo: 'users',
        pathMatch: 'full'
      },
      {
        path: 'users',
        loadComponent: () => import('./features/admin/users.component').then(m => m.UsersComponent)
      },
      {
        path: 'teams',
        loadComponent: () => import('./features/admin/teams.component').then(m => m.TeamsComponent)
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/admin/settings.component').then(m => m.SettingsComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
