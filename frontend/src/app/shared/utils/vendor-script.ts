const loaders = new Map<string, Promise<any>>();

/**
 * Load a UMD bundle from our own `/vendor` assets, once, and resolve the global
 * it defines. Used for parsers that are too large for the Angular bundle
 * (SheetJS, docx-preview): the production build's optimiser never sees them and
 * only clients that open such a file download them. See the `vendor` globs in
 * angular.json.
 */
export function loadVendorScript<T = any>(src: string, globalName: string): Promise<T> {
  const existing = (window as any)[globalName];
  if (existing) return Promise.resolve(existing);
  const pending = loaders.get(src);
  if (pending) return pending;

  const loader = new Promise<T>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      const lib = (window as any)[globalName];
      lib ? resolve(lib) : reject(new Error(`${globalName} failed to initialise`));
    };
    script.onerror = () => {
      loaders.delete(src);
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
  loaders.set(src, loader);
  return loader;
}
