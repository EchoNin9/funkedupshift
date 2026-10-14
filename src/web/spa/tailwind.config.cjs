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
        "accent-text": "rgb(var(--color-accent-text) / <alpha-value>)",
        "danger": "rgb(var(--color-danger) / <alpha-value>)",
        "warning": "rgb(var(--color-warning) / <alpha-value>)",
        "success": "rgb(var(--color-success) / <alpha-value>)",
        "on-danger": "rgb(var(--color-on-danger) / <alpha-value>)",
        "on-warning": "rgb(var(--color-on-warning) / <alpha-value>)",
        "on-success": "rgb(var(--color-on-success) / <alpha-value>)",
        "on-accent": "rgb(var(--color-on-accent) / <alpha-value>)",
        /* Design-system category hues (Discover / Tools / Modules / Admin) */
        "hue-teal": "rgb(var(--color-hue-teal) / <alpha-value>)",
        "hue-violet": "rgb(var(--color-hue-violet) / <alpha-value>)",
        "hue-coral": "rgb(var(--color-hue-coral) / <alpha-value>)",
        "hue-amber": "rgb(var(--color-hue-amber) / <alpha-value>)",
        /* Full-colour tokens (no alpha modifier) */
        divider: "var(--color-divider)",
        "border-strong": "var(--color-border-strong)",
        brand: "var(--color-brand)"
      },
      /* Named ds-* so the existing rounded and shadow utilities keep their meaning */
      borderRadius: {
        "ds-sm": "var(--radius-sm)",
        "ds-md": "var(--radius-md)",
        "ds-lg": "var(--radius-lg)"
      },
      boxShadow: {
        "ds-sm": "var(--shadow-sm)",
        "ds-md": "var(--shadow-md)",
        "ds-lg": "var(--shadow-lg)"
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        heading: ["Space Grotesk", "system-ui", "sans-serif"],
        brand: ["Syne", "system-ui", "sans-serif"],
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

