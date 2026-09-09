const storageKey = 'arkiv-files-theme';
export function initTheme(button: HTMLButtonElement) {
  let theme = 'dark';
  try { theme = localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark'; } catch { /* Dark default with storage unavailable. */ }
  function render() {
    document.documentElement.dataset.theme = theme;
    const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark'; render();
    try { localStorage.setItem(storageKey, theme); } catch { /* Toggle still works in this session. */ }
  });
  render();
}
