import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Atkinson Hyperlegible Mono"', "monospace"],
      },
      colors: {
        surface: {
          50: "#f7f8f7",
          100: "#eeefee",
          200: "#dcdedd",
          300: "#c4c6c4",
          400: "#b4b6b4",
          500: "#8a8c8a",
          600: "#505250",
          700: "#3a3c3a",
          800: "#1e201e",
          900: "#141514",
          950: "#0b0c0b",
        },
      },
      typography: {
        DEFAULT: {
          css: {
            "--tw-prose-body": "#c4c6c4",
            "--tw-prose-headings": "#f7f8f7",
            "--tw-prose-links": "#f7f8f7",
            "--tw-prose-bold": "#f7f8f7",
            "--tw-prose-code": "#f7f8f7",
            "--tw-prose-hr": "#3a3c3a",
            "--tw-prose-bullets": "#8a8c8a",
            "--tw-prose-counters": "#8a8c8a",
            h1: {
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
              fontWeight: "700",
            },
            h2: {
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
              fontWeight: "600",
            },
            h3: {
              fontFamily: '"Atkinson Hyperlegible Mono", monospace',
              fontWeight: "600",
            },
            a: {
              textDecoration: "underline",
              textUnderlineOffset: "3px",
              "&:hover": { color: "#fff" },
            },
            code: {
              backgroundColor: "#1e201e",
              padding: "0.15em 0.35em",
              borderRadius: "0.25rem",
              fontWeight: "400",
            },
            "code::before": { content: "none" },
            "code::after": { content: "none" },
          },
        },
      },
    },
  },
  plugins: [typography],
};
