import typography from '@tailwindcss/typography';
import containerQueries from '@tailwindcss/container-queries';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        shimmer: 'shimmer 2.5s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '100% 0' },
          '100%': { backgroundPosition: '-100% 0' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"Atkinson Hyperlegible Mono"', 'monospace'],
      },
      typography: {
        DEFAULT: {
          css: {
            // Compact heading sizes
            h1: {
              fontSize: '1.125rem',
              fontWeight: '600',
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
              marginTop: '1em',
              marginBottom: '0.5em',
            },
            h2: {
              fontSize: '1rem',
              fontWeight: '600',
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
              marginTop: '1em',
              marginBottom: '0.5em',
            },
            h3: {
              fontSize: '0.9375rem',
              fontWeight: '600',
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
              marginTop: '0.75em',
              marginBottom: '0.375em',
            },
            h4: {
              fontSize: '0.875rem',
              fontWeight: '600',
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
              marginTop: '0.75em',
              marginBottom: '0.25em',
            },
            h5: {
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
            },
            h6: {
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
            },
            // Compact paragraph and list spacing
            p: {
              marginTop: '0.5em',
              marginBottom: '0.5em',
              lineHeight: '1.5',
            },
            ul: {
              marginTop: '0.5em',
              marginBottom: '0.5em',
              paddingLeft: '1.25em',
            },
            ol: {
              marginTop: '0.5em',
              marginBottom: '0.5em',
              paddingLeft: '1.25em',
            },
            li: {
              marginTop: '0.25em',
              marginBottom: '0.25em',
            },
            'li > p': {
              marginTop: '0.25em',
              marginBottom: '0.25em',
            },
            // Compact blockquote spacing
            blockquote: {
              marginTop: '0.75em',
              marginBottom: '0.75em',
              paddingLeft: '0.75em',
            },
            // Remove excessive spacing at content boundaries
            '> :first-child': {
              marginTop: '0',
            },
            '> :last-child': {
              marginBottom: '0',
            },
          },
        },
      },
      colors: {
        // Core background scale (subtle green undertone, high contrast)
        surface: {
          50: '#f7f8f7',   // near white
          100: '#eeefee',
          200: '#dcdedd',
          300: '#c4c6c4',
          400: '#b4b6b4',  // muted text - pushed lighter for readability
          500: '#8a8c8a',  // secondary muted text
          600: '#505250',  // border on dark bg - pushed lighter
          700: '#3a3c3a',  // border on darker bg - pushed lighter
          800: '#1e201e',  // card/panel bg
          900: '#141514',  // main bg
          950: '#0b0c0b',  // deepest bg
        },
        // Primary accent (near-white CTAs - use dark text for contrast)
        accent: {
          50: '#ffffff',
          100: '#fafafa',
          200: '#f5f5f5',
          300: '#e8e8e8',
          400: '#d4d4d4',
          500: '#f0f0f0',  // primary CTA bg
          600: '#e0e0e0',  // hover state
          700: '#c0c0c0',  // pressed state
          800: '#0a0a0a',  // text on light accent
          900: '#000000',  // black text on light accent
        },
        // Secondary (muted teal for AI/assistant elements)
        secondary: {
          50: '#f4f9f8',
          100: '#e4edec',
          200: '#c8d9d6',
          300: '#a3bfba',
          400: '#7aa19b',
          500: '#5c857e',  // muted teal
          600: '#4a6d67',
          700: '#3d5854',
          800: '#334845',
          900: '#2a3b39',
        },
        // Semantic colors for status/feedback
        success: {
          500: '#22c55e',  // semantic green
          600: '#16a34a',
        },
        warning: {
          500: '#eab308',
          600: '#ca8a04',
        },
        error: {
          500: '#ef4444',
          600: '#dc2626',
        },
      },
    },
  },
  plugins: [typography, containerQueries],
}
