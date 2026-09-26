import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { APP_INITIALIZER } from '@angular/core';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/core/interceptors/auth.interceptor';
import { NativeTokenStore } from './app/core/auth/native-token.store';
import { PlatformService } from './app/core/platform/platform.service';
import { CapabilitiesService } from './app/core/capabilities/capabilities.service';
import { BrandingService } from './app/core/branding/branding.service';
import { PageTitleService } from './app/core/branding/page-title.service';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([authInterceptor])
    ),
    provideAnimations(),
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [PlatformService, NativeTokenStore],
      useFactory: (platform: PlatformService, tokenStore: NativeTokenStore) => () => {
        if (platform.isNative()) {
          return tokenStore.load();
        }
        return Promise.resolve();
      }
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [CapabilitiesService],
      useFactory: (caps: CapabilitiesService) => () => caps.load()
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      // PageTitleService is a dependency only so the app name reaches the tab from the start.
      deps: [BrandingService, PageTitleService],
      useFactory: (branding: BrandingService) => () => branding.load()
    }
  ]
}).catch(err => console.error(err));
