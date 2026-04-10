import { Pipe, PipeTransform } from '@angular/core';
import { spaceRoute } from '../utils/route-utils';

/**
 * Pipe that converts a space fullPath into a proper router link array.
 *
 * Usage:
 *   [routerLink]="space.fullPath | spaceRoute"
 *   [routerLink]="space.fullPath | spaceRoute:'doc'"
 *   [routerLink]="space.fullPath | spaceRoute:'doc':'edit'"
 */
@Pipe({ name: 'spaceRoute', standalone: true })
export class SpaceRoutePipe implements PipeTransform {
  transform(fullPath: string | undefined | null, ...suffix: string[]): string[] {
    if (!fullPath) return ['/spaces'];
    return spaceRoute(fullPath, ...suffix);
  }
}
