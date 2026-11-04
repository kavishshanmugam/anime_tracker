import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          0: '#0F1113',
          1: '#16191C',
          2: '#1D2125',
        },
        border: '#262B30',
        text: {
          1: '#ECEEF0',
          2: '#A2ACB4',
          3: '#6B767E',
        },
        accent: {
          DEFAULT: '#7E7BF2',
          hover: '#9492F5',
        },
        status: {
          watching: '#7E7BF2',
          completed: '#4FD1A1',
          planned: '#A2ACB4',
          'plan_to_watch': '#A2ACB4',
          onhold: '#E0A46B',
          'on_hold': '#E0A46B',
          dropped: '#E06B6B',
        },
      },
      fontFamily: {
        display: ['"General Sans"', 'system-ui', 'sans-serif'],
        body: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
} satisfies Config
