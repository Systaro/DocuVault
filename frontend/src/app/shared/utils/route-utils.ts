/**
 * Builds a router link array for space routes, properly splitting
 * the fullPath into individual segments so Angular doesn't encode
 * slashes as %2F.
 *
 * Example: spaceRoute('acme/handbook', 'doc')
 *   => ['/spaces', 'acme', 'handbook', 'doc']
 */
export function spaceRoute(fullPath: string, ...suffix: string[]): string[] {
  return ['/spaces', ...fullPath.split('/'), ...suffix];
}
