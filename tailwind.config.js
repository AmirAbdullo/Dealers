/**
 * Tailwind build for CarFox (replaces the cdn.tailwindcss.com runtime).
 *
 *   npm run build:css   ->  css/app.css (minified, committed; Render serves it as a static file)
 *   npm run watch:css   ->  rebuild on change while developing
 *
 * Re-run the build after adding or changing Tailwind classes in any page or script, and commit css/app.css.
 * The scanner reads every page and script as plain text, so classes inside JS strings are picked up, but a
 * class name must appear whole in the source: never build one by concatenation (e.g. 'bg-' + color).
 */
module.exports = {
  content: [
    './*.html',
    './buyer/**/*.html',
    './dealer/**/*.html',
    './admin/**/*.html',
    './js/**/*.js',
    './server.js'
  ],
  theme: {
    extend: {
      // Merged from the per-page inline `tailwind.config` blocks the CDN pages used to carry.
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Nunito', 'Cairo', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      colors: {
        navy: { DEFAULT: '#0f1f3d', 700: '#162c57', 900: '#0b1830' }
      }
    }
  },
  plugins: []
};
