// Theme before first paint — external file so the CSP can stay strict (no inline scripts).
(function () {
  try {
    var t = localStorage.getItem('wos_theme') || 'auto'
    var dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  } catch (e) {}
})()
