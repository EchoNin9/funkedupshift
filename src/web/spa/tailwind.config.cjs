/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "rgb(var(--color-surface-0) / <alpha-value>)",
          1: "rgb(var(--color-surface-1) / <alpha-value>)",
          2: "rgb(var(--color-surface-2) / <alpha-value>)",
          3: "rgb(var(--color-surface-3) / <alpha-value>)",
        },
        "border-default": "rgb(var(--color-border-default) / <alpha-value>)",
        "border-subtle": "rgb(var(--color-border-subtle) / <alpha-value>)",
        "border-hover": "rgb(var(--color-border-hover) / <alpha-value>)",
        "text-primary": "rgb(var(--color-text-primary) / <alpha-value>)",
        "text-secondary": "rgb(var(--color-text-secondary) / <alpha-value>)",
        "text-tertiary": "rgb(var(--color-text-tertiary) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          400: "rgb(var(--color-accent-light) / <alpha-value>)",
          500: "rgb(var(--color-accent) / <alpha-value>)",
          600: "rgb(var(--color-accent-hover) / <alpha-value>)",
        },
        /* Neon Pop accents */
        n1: "rgb(var(--color-n1) / <alpha-value>)",
        n2: "rgb(var(--color-n2) / <alpha-value>)",
        n3: "rgb(var(--color-n3) / <alpha-value>)",
        n4: "rgb(var(--color-n4) / <alpha-value>)",
        nav: "rgb(var(--color-nav) / <alpha-value>)",
        "n1-text": "rgb(var(--color-n1-text) / <alpha-value>)",
        "n2-text": "rgb(var(--color-n2-text) / <alpha-value>)",
        "n3-text": "rgb(var(--color-n3-text) / <alpha-value>)",
        "n4-text": "rgb(var(--color-n4-text) / <alpha-value>)",
        "nav-text": "rgb(var(--color-nav-text) / <alpha-value>)",
        "accent-text": "rgb(var(--color-accent-text) / <alpha-value>)",
        "danger": "rgb(var(--color-danger) / <alpha-value>)",
        "warning": "rgb(var(--color-warning) / <alpha-value>)",
        "success": "rgb(var(--color-success) / <alpha-value>)",
        "on-danger": "rgb(var(--color-on-danger) / <alpha-value>)",
        "on-warning": "rgb(var(--color-on-warning) / <alpha-value>)",
        "on-success": "rgb(var(--color-on-success) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)"
      },
      fontFamily: {
        sans: ["Space Grotesk", "system-ui", "sans-serif"],
        display: ["Syne", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 150ms ease-out forwards",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    }
  },
  plugins: []
};

