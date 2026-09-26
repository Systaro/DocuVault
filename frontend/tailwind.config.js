/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        // Follows the instance's brand colour (see core/branding), not a fixed teal.
        primary: {
          50: 'color-mix(in srgb, var(--primary-light) 30%, white)',
          100: 'color-mix(in srgb, var(--primary-light) 60%, white)',
          200: 'var(--primary-light)',
          300: 'color-mix(in srgb, var(--primary) 50%, var(--primary-light))',
          400: 'var(--primary)',
          500: 'color-mix(in srgb, var(--primary) 60%, var(--primary-dark))',
          600: 'var(--primary-dark)',
          700: 'color-mix(in srgb, var(--primary-dark) 80%, black)',
          800: 'color-mix(in srgb, var(--primary-dark) 65%, black)',
          900: 'color-mix(in srgb, var(--primary-dark) 40%, black)',
        },
        accent: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#c2edce',
          300: '#a7e3b7',
          400: '#7dd39e',
          500: '#4ade80',
        },
        surface: '#ffffff',
        background: {
          DEFAULT: '#F6F6F2',
          darker: '#e8f0f1',
        },
        border: {
          DEFAULT: '#d4e5e7',
          light: '#e8f4f5',
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Monaco', 'Menlo', 'monospace'],
      },
      fontSize: {
        'xs': '11px',
        'sm': '13px',
        'base': '15px',
        'lg': '17px',
        'xl': '22px',
        '2xl': '28px',
        '3xl': '36px',
      },
      borderRadius: {
        'sm': '6px',
        'DEFAULT': '10px',
        'lg': '14px',
        'xl': '20px',
      },
      boxShadow: {
        'sm': '0 1px 3px color-mix(in srgb, var(--primary-dark) 8%, transparent)',
        'DEFAULT': '0 4px 12px color-mix(in srgb, var(--primary-dark) 12%, transparent)',
        'lg': '0 8px 24px color-mix(in srgb, var(--primary-dark) 16%, transparent)',
        'xl': '0 16px 48px color-mix(in srgb, var(--primary-dark) 20%, transparent)',
      },
    },
  },
  plugins: [],
}
