const STORAGE_KEY = 'sca-theme-mode';

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const preferred = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(preferred);
}

export function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem(STORAGE_KEY, mode);

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', mode === 'dark' ? '#121212' : '#1976d2');
  }
}
