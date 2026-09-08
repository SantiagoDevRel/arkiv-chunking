const storageKey = 'arkiv-files-theme';
export function initTheme(button: HTMLButtonElement) {
  let theme = 'dark';
  try { theme = localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark'; } catch { /* Dark default with storage unavailable. */ }
  function render() {
    document.documentElement.dataset.theme = theme;
    button.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  }
  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark'; render();
    try { localStorage.setItem(storageKey, theme); } catch { /* Toggle still works in this session. */ }
  });
  render();
}
