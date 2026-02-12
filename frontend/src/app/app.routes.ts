import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

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
    path: 'share/:token',
    loadComponent: () => import('./features/public/public-viewer.component').then(m => m.PublicViewerComponent)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
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
            loadComponent: () => import('./features/editor/editor.component').then(m => m.EditorComponent)
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
            loadComponent: () => import('./features/editor/editor.component').then(m => m.EditorComponent)
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
            loadComponent: () => import('./features/editor/editor.component').then(m => m.EditorComponent)
          }
        ]
      }
    ]
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
