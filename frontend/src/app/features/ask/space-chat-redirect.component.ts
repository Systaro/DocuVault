import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SpacesService } from '../../core/api/spaces.service';

/** Sends an old /spaces/.../chat link to the assistant with that space chosen. */
@Component({
  selector: 'app-space-chat-redirect',
  standalone: true,
  template: ''
})
export class SpaceChatRedirectComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private spaces = inject(SpacesService);

  ngOnInit(): void {
    const params = this.route.parent?.snapshot.params ?? {};
    const fullPath = [params['path1'], params['path2'], params['path3']].filter(Boolean).join('/');
    this.spaces.getSpaceByPath(fullPath).subscribe({
      next: space => this.router.navigate(['/ask'], { queryParams: { space: space.id }, replaceUrl: true }),
      error: () => this.router.navigate(['/ask'], { replaceUrl: true })
    });
  }
}
