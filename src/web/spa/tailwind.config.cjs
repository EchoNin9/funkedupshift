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
        }
      }
    }
  },
  plugins: []
};

