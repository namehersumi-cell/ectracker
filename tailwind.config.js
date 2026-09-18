/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5dae3',
          300: '#b0bac9',
          400: '#8494a9',
          500: '#64758d',
          600: '#4f5d73',
          700: '#414c5e',
          800: '#38414f',
          900: '#313944',
          950: '#1e242c',
        },
        brand: {
          50: '#eefbfa',
          100: '#d5f5f2',
          200: '#aeeae7',
          300: '#78d9d6',
          400: '#43bfbe',
          500: '#26a3a4',
          600: '#1c8386',
          700: '#1a686b',
          800: '#195356',
          900: '#184549',
          950: '#08282c',
        },
        sand: {
          50: '#fbf8f3',
          100: '#f5efe3',
          200: '#e9dcc5',
          300: '#dbc39f',
          400: '#caa477',
          500: '#bd8d58',
          600: '#b07a4c',
          700: '#926140',
          800: '#774f39',
          900: '#614231',
          950: '#342117',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(30, 36, 44, 0.04), 0 4px 16px -6px rgba(30, 36, 44, 0.10)',
        lift: '0 2px 4px rgba(30, 36, 44, 0.05), 0 12px 28px -10px rgba(30, 36, 44, 0.18)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in': 'slide-in 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}