type Theme = 'light' | 'dark';

const STORAGE_KEY = 'xray-mirror.theme.v1';
const DEFAULT_THEME: Theme = 'dark';
const root = document.documentElement;
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const options = document.querySelectorAll<HTMLInputElement>('input[name="theme"]');

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: Theme): void {
  root.dataset.theme = theme;
  if (themeColor) {
    themeColor.content = getComputedStyle(root).getPropertyValue('--page-background').trim();
  }
  for (const option of options) {
    option.checked = option.value === theme;
  }
}

applyTheme(readTheme());

for (const option of options) {
  option.addEventListener('change', () => {
    if (!option.checked || !isTheme(option.value)) return;
    applyTheme(option.value);
    try {
      localStorage.setItem(STORAGE_KEY, option.value);
    } catch {
      // The theme still applies for the current page if storage is unavailable.
    }
  });
}
