/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        // Notehub Teal/Mint Palette
        primary: {
          50: '#f0fafb',
          100: '#d9f2f4',
          200: '#badfe7',
          300: '#9acfd9',
          400: '#6fb3b8',
          500: '#4a9da3',
          600: '#388087',
          700: '#2d6a70',
          800: '#275558',
          900: '#1a2e30',
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
        'sm': '0 1px 3px rgba(56, 128, 135, 0.08)',
        'DEFAULT': '0 4px 12px rgba(56, 128, 135, 0.12)',
        'lg': '0 8px 24px rgba(56, 128, 135, 0.16)',
        'xl': '0 16px 48px rgba(56, 128, 135, 0.2)',
      },
    },
  },
  plugins: [],
}
