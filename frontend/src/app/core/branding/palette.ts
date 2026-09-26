interface Hsl {
  h: number;
  /** 0-100 */
  s: number;
  /** 0-100 */
  l: number;
}

interface ThemeShades {
  primary: string;
  primaryDark: string;
  primaryLight: string;
}

export interface BrandPalette {
  light: ThemeShades;
  dark: ThemeShades;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The stock light-theme `--primary` from styles.scss, for controls that need a concrete value. */
export const DEFAULT_PRIMARY = '#6fb3b8';

/** WCAG contrast for large text and UI parts; the buttons carry white 14px labels. */
const MIN_BUTTON_CONTRAST = 3;

function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const channel = (n: number) => {
    const value = lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function relativeLuminance(hex: string): number {
  const linear = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/** Lowers the lightness until white button labels stay legible, but never below the floor. */
function readableOnWhiteText(color: Hsl, floor: number): Hsl {
  let l = color.l;
  while (l > floor && contrastWithWhite(hslToHex({ ...color, l })) < MIN_BUTTON_CONTRAST) {
    l -= 1;
  }
  return { ...color, l };
}

/**
 * Derives both themes' shades from a single brand colour, keeping the
 * relations of the stock palette: in light mode `--primary-dark` is the
 * darker text/hover shade and `--primary-light` a pale tint; in dark mode
 * the roles flip to a light text shade and a deep, muted tint.
 */
export function derivePalette(hex: string): BrandPalette {
  const base = hexToHsl(hex);

  const lightPrimary = readableOnWhiteText(base, 20);
  const darkPrimary = readableOnWhiteText({ ...base, s: base.s * 0.85, l: clamp(base.l, 42, 55) }, 30);

  return {
    light: {
      primary: hslToHex(lightPrimary),
      primaryDark: hslToHex({ ...lightPrimary, s: Math.min(lightPrimary.s + 8, 100), l: lightPrimary.l - Math.min(20, lightPrimary.l * 0.35) }),
      primaryLight: hslToHex({ ...base, s: Math.min(base.s, 60), l: 86 })
    },
    dark: {
      primary: hslToHex(darkPrimary),
      primaryDark: hslToHex({ ...base, s: Math.min(base.s, 55), l: 68 }),
      primaryLight: hslToHex({ ...base, s: Math.min(base.s * 0.6, 35), l: 23 })
    }
  };
}

function shadesCss(shades: ThemeShades): string {
  return `--primary:${shades.primary};--primary-dark:${shades.primaryDark};--primary-light:${shades.primaryLight};`;
}

/** Selectors match the theme rules in styles.scss, so a nested `data-theme` element gets its own shades too. */
export function paletteCss(palette: BrandPalette): string {
  return `:root,[data-theme="light"]{${shadesCss(palette.light)}}[data-theme="dark"]{${shadesCss(palette.dark)}}`;
}
