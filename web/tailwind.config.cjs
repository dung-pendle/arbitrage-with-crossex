/** Tailwind config — house "ink" palette + Inter / JetBrains Mono, copied from
 * boros-tools dashboards/_shared-frontend/tailwind-preset.cjs (no cross-repo imports). */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        ink: {
          950: '#08090b',
          900: '#0d0f13',
          800: '#13161c',
          700: '#1c2029',
          600: '#262b37',
          500: '#3a4150',
          400: '#5a6273',
          300: '#8a92a3',
          200: '#c8ccd6',
          100: '#e9ebf0',
        },
      },
    },
  },
  plugins: [],
};
