/* Inkflow: apply the persisted appearance before the app boots (keep in sync with ThemeProvider). */
(function () {
  var root = document.documentElement;
  var appearance = { theme: 'system', highContrast: false, reduceMotion: false };
  try {
    var raw = window.localStorage.getItem('inkflow:appearance');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system') appearance.theme = parsed.theme;
        appearance.highContrast = parsed.highContrast === true;
        appearance.reduceMotion = parsed.reduceMotion === true;
      }
    }
  } catch (_e) {
    /* storage unavailable */
  }
  var dark =
    appearance.theme === 'dark' ||
    (appearance.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) root.classList.add('dark');
  root.style.colorScheme = dark ? 'dark' : 'light';
  if (appearance.highContrast) root.setAttribute('data-contrast', 'high');
  if (appearance.reduceMotion) root.setAttribute('data-reduce-motion', 'true');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? (appearance.highContrast ? '#000000' : '#131316') : '#ffffff');
})();
