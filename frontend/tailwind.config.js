/** Brand-true tokens from muskokabranding.com (hex + PMS):
 *  Muskoka Blue #1E5A64 · Blue Dark #1B4849 · Green #A3CD42 · Green Dark #1F6331
 *  Summer Camp #30A059 · Schools & Groups #C26628 · Leadership #1B5470 · Alumni #1087A3
 *  Theme colors run through RGB-triplet CSS variables so dark mode is one attribute flip.
 */
const v = name => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('c-bg'),
        surface: v('c-surface'),
        sunken: v('c-sunken'),
        line: v('c-line'),
        ink: v('c-ink'),
        dim: v('c-dim'),
        faint: v('c-faint'),
        brand: v('c-brand'),          // Muskoka Blue
        'brand-deep': v('c-brand-deep'),
        accent: v('c-accent'),        // page-scoped module accent
        green: v('c-green'),          // Muskoka Green (bright)
        'green-dark': v('c-green-dark'),
        summer: v('c-summer'),
        ember: v('c-ember'),          // Schools & Groups orange
        lake: v('c-lake'),            // Alumni teal
        leadership: v('c-leadership'),
        danger: v('c-danger'),
        panel: v('c-panel'),          // sidebar deep teal
        'panel-ink': v('c-panel-ink'),
      },
      fontFamily: {
        display: ['"League Gothic"', 'Oswald', '"Arial Narrow"', 'Impact', 'sans-serif'],
        head: ['Montserrat', 'system-ui', 'sans-serif'],
        sans: ['"Nunito Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(19,59,64,0.05), 0 4px 16px rgba(19,59,64,0.06)',
        lift: '0 2px 6px rgba(19,59,64,0.08), 0 14px 34px rgba(19,59,64,0.12)',
        pop: '0 10px 38px rgba(10,30,34,0.18), 0 2px 8px rgba(10,30,34,0.10)',
        sheet: '0 -12px 40px rgba(10,30,34,0.22)',
      },
      borderRadius: {
        xl2: '1.125rem',
      },
      screens: {
        xs: '475px',
      },
    },
  },
  plugins: [],
}
