/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
  // Prevent Tailwind from generating utility classes that conflict with
  // App.css component class names (e.g. .list-item display utility vs
  // .list-item flex component).
  blocklist: ['list-item'],
}

