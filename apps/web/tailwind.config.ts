/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0f1419',
          900: '#1a2332',
          700: '#3d4f66',
        },
        rail: {
          500: '#c45c26',
          600: '#a34a1c',
        },
        mist: {
          50: '#f3f6f9',
          100: '#e8eef4',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
