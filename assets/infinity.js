/* Infinity Flow: small UI helpers (feed column switch). */
(() => {
  const KEY = 'fx_feed_cols';
  const read = () => {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  };
  const write = (v) => {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fx-view]');
    if (!btn) return;
    const section = btn.closest('section');
    const feed = section && section.querySelector('[data-fx-feed]');
    if (!feed) return;
    const one = btn.dataset.fxView === '1';
    feed.classList.toggle('is-1', one);
    btn.parentElement.querySelectorAll('[data-fx-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    write(one ? '1' : '2');
  });
  const apply = () => {
    if (read() !== '1') return;
    document.querySelectorAll('[data-fx-toggle]').forEach((t) => {
      const feed = t.closest('section')?.querySelector('[data-fx-feed]');
      if (!feed) return;
      feed.classList.add('is-1');
      t.querySelectorAll('[data-fx-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fxView === '1')));
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  document.addEventListener('shopify:section:load', apply);
})();
