import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CapabilitiesService } from './capabilities.service';

/** Without an AI key there is no assistant: a bookmarked /ask lands on the dashboard instead of an ask box that cannot answer. */
export const aiChatGuard: CanActivateFn = () =>
  inject(CapabilitiesService).aiChat() || inject(Router).createUrlTree(['/dashboard']);
