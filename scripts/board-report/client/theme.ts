// Light or dark: follows the system until the owner picks one with the header's toggle, which the browser remembers
// when it can. A browser that keeps nothing (or throws on storage) still gets a working toggle.
import { el } from './dom.ts';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'board-report-theme';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function rememberTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The browser keeps nothing here: the theme still applies until the page is closed.
  }
}

export function currentTheme(): Theme {
  const set = document.documentElement.getAttribute('data-theme');
  return set === 'light' || set === 'dark' ? set : systemTheme();
}

/** Applies a theme picked earlier, before anything is drawn. */
export function applyStoredTheme(): void {
  const theme = storedTheme();
  if (theme !== null) document.documentElement.setAttribute('data-theme', theme);
}

export function themeToggle(): HTMLButtonElement {
  const label = el('span', { class: 'theme-label' });
  const button = el(
    'button',
    { type: 'button', class: 'theme-toggle' },
    el('span', { class: 'theme-icon', 'aria-hidden': 'true' }),
    label,
  );
  const update = (): void => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    label.textContent = next === 'dark' ? 'Dark theme' : 'Light theme';
    button.setAttribute('aria-label', `Switch to the ${next} theme`);
    button.dataset['next'] = next;
  };
  button.addEventListener('click', () => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    rememberTheme(next);
    update();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', update);
  update();
  return button;
}
