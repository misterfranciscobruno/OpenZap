/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      keyframes: {
        'reply-jump-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 transparent' },
          '10%': {
            boxShadow:
              '0 0 0 2px rgba(34, 197, 94, 0.75), 0 0 22px rgba(34, 197, 94, 0.25)',
          },
          '20%': { boxShadow: '0 0 0 0 transparent' },
          '30%': {
            boxShadow:
              '0 0 0 2px rgba(34, 197, 94, 0.75), 0 0 22px rgba(34, 197, 94, 0.25)',
          },
          '40%': { boxShadow: '0 0 0 0 transparent' },
          '41%, 100%': { boxShadow: '0 0 0 0 transparent' },
        },
      },
      animation: {
        'reply-jump-pulse': 'reply-jump-pulse 1.25s ease-in-out forwards',
      },
      colors: {
        whatsapp: {
          base: '#020202',
          dark: '#030303',
          sidebar: '#0a0a0c',
          chat: '#030303',
          input: '#131316',
          header: '#0a0a0c',
          green: '#22c55e',
          'green-hover': '#4ade80',
          'green-muted': '#16a34a',
          secondary: '#a78bfa',
          cta: '#facc15',
          light: '#D1FAE5',
          hover: '#1c1c21',
          border: '#27272a',
          text: '#fafafa',
          'text-secondary': '#a1a1aa',
          outgoing: '#14532d',
          incoming: '#18181b',
          'on-primary': '#030303',
        },
      },
    },
  },
  plugins: [],
};
