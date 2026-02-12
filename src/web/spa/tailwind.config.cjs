/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: "#ff6b35",
          navy: "#004e89",
          teal: "#06d6a0"
        },
        rasta: {
          red: "#e50203",
          yellow: "#fdde13",
          green: "#14a113",
          "soft-green": "#3d7a3d"
        }
      }
    }
  },
  plugins: []
};

