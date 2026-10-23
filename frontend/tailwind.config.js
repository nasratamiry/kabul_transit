/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0C514C',
          dark: '#083D39',
          light: '#E6F0EF',
        },
        accent: {
          DEFAULT: '#F97316',
          dark: '#C2410C',
        },
      },
      fontFamily: {
        fa: ['Vazirmatn', 'system-ui', 'sans-serif'],
        ps: ['Vazirmatn', 'system-ui', 'sans-serif'],
        en: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
