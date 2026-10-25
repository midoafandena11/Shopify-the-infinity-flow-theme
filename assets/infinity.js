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

/* Free-shipping bar in the header: keep it in sync with the cart. */
(() => {
  const bar = () => document.querySelector('[data-fx-shipbar]');
  const money = (cents) => {
    const v = cents / 100;
    try {
      return new Intl.NumberFormat(document.documentElement.lang || undefined, {
        style: 'currency',
        currency: (window.Shopify && Shopify.currency && Shopify.currency.active) || 'USD',
        maximumFractionDigits: v % 1 ? 2 : 0,
      }).format(v);
    } catch (e) {
      return String(v);
    }
  };
  const update = async () => {
    const el = bar();
    if (!el) return;
    try {
      const res = await fetch(`${(window.routes && routes.cart_url) || '/cart'}.js`);
      const cart = await res.json();
      const goal = Number(el.dataset.goal);
      const left = goal - cart.total_price;
      const pct = Math.max(0, Math.min(100, Math.floor((cart.total_price * 100) / goal)));
      const text = el.querySelector('[data-fx-shipbar-text]');
      if (left <= 0) text.textContent = el.dataset.tDone;
      else if (cart.item_count === 0) text.textContent = el.dataset.tIntro.replace('[amount]', money(goal));
      else text.textContent = el.dataset.tMore.replace('[amount]', money(left));
      el.classList.toggle('is-done', left <= 0);
      el.querySelector('.fx-shipbar__bar i').style.setProperty('--p', `${pct}%`);
      el.querySelector('.fx-shipbar__bar').setAttribute('aria-valuenow', pct);
      el.querySelector('[data-fx-shipbar-pct]').textContent = `${pct}%`;
    } catch (e) {}
  };
  const hook = () => {
    if (typeof subscribe === 'function' && window.PUB_SUB_EVENTS) subscribe(PUB_SUB_EVENTS.cartUpdate, update);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
