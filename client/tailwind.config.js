/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      boxShadow: {
        card: '0 1px 2px rgb(28 25 23 / 0.06), 0 4px 12px rgb(28 25 23 / 0.04)',
        'card-hover': '0 2px 4px rgb(28 25 23 / 0.08), 0 12px 24px rgb(28 25 23 / 0.08)',
        glow: '0 0 0 4px rgb(124 58 237 / 0.12)',
      },
      animation: {
        float: 'float 3s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-2px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  plugins: [],
}
