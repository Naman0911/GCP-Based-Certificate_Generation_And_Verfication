import type { Config } from 'tailwindcss'

// Tailwind v4 reads this file through the `@config` directive in src/styles/index.css.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#0b1b3a', 900: '#10244d', 800: '#1a3366', 700: '#2b4a85', 600: '#43608f', 500: '#5f7aa6' },
        brand: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
} satisfies Config
