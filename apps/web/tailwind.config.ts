/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0f1724',
          900: '#152033',
          700: '#3d4f66',
        },
        primary: {
          50: '#eef3f8',
          500: '#2f5a8a',
          700: '#1e3a5f',
          800: '#17304f',
          900: '#12263f',
        },
        teal: {
          50: '#f0fdfa',
          600: '#0f766e',
          800: '#115e59',
        },
        mist: {
          50: '#f4f7fb',
          100: '#e8eef5',
        },
        muted: '#3d4f66',
        rail: {
          500: '#0f766e',
          600: '#0d9488',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'collapsible-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-collapsible-content-height)' },
        },
        'collapsible-up': {
          from: { height: 'var(--radix-collapsible-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'cot-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'collapsible-down': 'collapsible-down 0.2s ease-out',
        'collapsible-up': 'collapsible-up 0.2s ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
        'cot-in': 'cot-in 0.35s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
