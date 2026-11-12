import type { Config } from 'tailwindcss';

// Palette and type match authentyc.ai (landing_page/tailwind.config.ts + globals.css).
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: { 950: '#0A0A0F', 900: '#0F0F17', 850: '#14141F', 800: '#1A1A27' },
        brand: { primary: { DEFAULT: '#10B981', hover: '#34D399' } },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
};

export default config;
