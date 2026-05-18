/** Minimal Tailwind config shape so this package does not depend on tailwindcss */
interface TailwindConfig {
  content: string[];
  darkMode?: string;
  theme?: { extend?: Record<string, unknown> };
  plugins?: unknown[];
}
const config: TailwindConfig = {
  content: [],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /** Semantic UI tokens — set per theme via `[data-app-theme]` in apps/web/app/tailwind.css */
        app: {
          canvas: 'rgb(var(--app-canvas) / <alpha-value>)',
          elevated: 'rgb(var(--app-elevated) / <alpha-value>)',
          border: 'rgb(var(--app-border) / <alpha-value>)',
          'border-strong': 'rgb(var(--app-border-strong) / <alpha-value>)',
          fg: 'rgb(var(--app-fg) / <alpha-value>)',
          'fg-muted': 'rgb(var(--app-fg-muted) / <alpha-value>)',
          hover: 'rgb(var(--app-hover) / <alpha-value>)',
          'logo-strip-bg': 'rgb(var(--app-logo-strip-bg) / <alpha-value>)',
          'logo-strip-border': 'rgb(var(--app-logo-strip-border) / <alpha-value>)',
        },
        // Yannis brand blue — extracted from logo
        brand: {
          50: '#e8f0fe',
          100: '#c5d9fc',
          200: '#9ebff9',
          300: '#74a4f5',
          400: '#4d8bf1',
          500: '#1565C0', // Primary — logo blue
          600: '#0d47a1', // Deep — logo blue dark
          700: '#0a3a85',
          800: '#072d69',
          900: '#041e4c',
          950: '#021230',
        },
        // Sidebar/dark surfaces
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        // Semantic colors — full scales (Tailwind red/amber/emerald/blue) so utilities like
        // `text-danger-400`, `bg-warning-900/20`, `border-success-200` generate valid CSS.
        success: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
          950: '#450a0a',
        },
        info: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        // Compact font scale: base 14px
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.8125rem', { lineHeight: '1.25rem' }],
        'base': ['0.875rem', { lineHeight: '1.375rem' }],  // 14px
        'lg': ['1rem', { lineHeight: '1.5rem' }],           // 16px
        'xl': ['1.125rem', { lineHeight: '1.75rem' }],      // 18px
        '2xl': ['1.5rem', { lineHeight: '2rem' }],          // 24px
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'sidebar': '2px 0 8px 0 rgba(0, 0, 0, 0.05)',
        'card': '0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.08)',
        'card-hover': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
      },
      animation: {
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
