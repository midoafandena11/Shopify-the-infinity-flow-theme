/* Infinity Flow — drag a product onto the floating cart to add it.
 * Real <form action="/cart/add"> + real submit button per card, so pixels and
 * apps that watch the add-to-cart request or the button click keep working. */
(() => {
  if (customElements.get('flow-dock')) return;

  const HOLD_MS = 220; // touch: press-and-hold time before the drag starts
  const MOVE_START = 6; // mouse: px before the drag starts
  const MAGNET = 40; // px around the dock that counts as "on target"
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const str = () => window.flowStrings || {};
  const fill = (tpl = '', map = {}) => Object.keys(map).reduce((s, k) => s.split(`[${k}]`).join(map[k]), tpl);
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {}
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    },
  };

  class FlowDock extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this.btn = this.querySelector('.flow-dock__btn');
      this.countEl = this.querySelector('.flow-dock__count');
      this.toastEl = this.querySelector('.flow-toast');
      this.hintEl = this.querySelector('.flow-hint');
      this.sheet = this.querySelector('.flow-sheet');
      this.afterDrop = this.dataset.afterDrop || 'stay';
      this.haptics = this.dataset.haptics === 'true';
      this.state = null;
      window.flowDock = this;

      this.btn.addEventListener('click', (e) => {
        const drawer = document.querySelector('cart-drawer');
        if (drawer) {
          e.preventDefault();
          drawer.open(this.btn);
        }
      });

      document.addEventListener('pointerdown', (e) => this.onDown(e));
      document.addEventListener('dragstart', (e) => {
        if (e.target.closest?.('[data-flow-card]')) e.preventDefault();
      });
      document.addEventListener(
        'submit',
        (e) => {
          const form = e.target.matches?.('form[data-flow-form]') ? e.target : null;
          if (!form) return;
          e.preventDefault();
          this.add(form);
        },
        true
      );
      document.addEventListener('click', (e) => {
        const trigger = e.target.closest?.('[data-flow-add]');
        if (!trigger) return;
        e.preventDefault();
        e.stopPropagation();
        this.choose(trigger.closest('[data-flow-card]'));
      });
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (this.state?.active) this.finish(false);
        else if (!this.sheet.hidden) this.closeSheet();
      });
      this.sheet.addEventListener('click', (e) => {
        if (e.target.closest('[data-flow-close]')) this.closeSheet();
      });
      this.sheet.querySelector('.flow-sheet__add').addEventListener('click', () => this.confirmSheet());
      this.hintEl.querySelector('.flow-hint__x').addEventListener('click', () => this.hideHint(true));

      if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
        subscribe(PUB_SUB_EVENTS.cartUpdate, () => this.refreshCount());
      }
      if (store.get('flow_learned')) document.documentElement.classList.add('flow-learned');
      this.showHintSoon();
    }

    /* ---------- drag lifecycle ---------- */

    onDown(e) {
      if (this.state || !e.isPrimary || e.button > 0) return;
      const card = e.target.closest?.('[data-flow-card]');
      if (!card || card.dataset.flowAvailable !== 'true') return;
      const blocked = e.target.closest('[data-flow-add], input, select, textarea, button, quick-add-modal, .fx-card__info');
      const pageImage = card.dataset.flowPage && !e.target.closest('.thumbnail, .slider-button, .fx-pdp-back, [data-flow-add]');
      if (blocked && !pageImage) return;

      const touch = e.pointerType !== 'mouse';
      const s = (this.state = {
        card,
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        touch,
        active: false,
        hot: false,
        timer: null,
      });
      this._move = (ev) => this.onMove(ev);
      this._up = (ev) => {
        if (ev.pointerId === s.id) this.finish(true);
      };
      this._cancel = (ev) => {
        if (ev.pointerId === s.id) this.finish(false);
      };
      window.addEventListener('pointermove', this._move, { passive: true });
      window.addEventListener('pointerup', this._up);
      window.addEventListener('pointercancel', this._cancel);
      if (touch) s.timer = setTimeout(() => this.activate(), HOLD_MS);
    }

    onMove(e) {
      const s = this.state;
      if (!s || e.pointerId !== s.id) return;
      s.x = e.clientX;
      s.y = e.clientY;
      const dist = Math.hypot(s.x - s.x0, s.y - s.y0);
      if (!s.active) {
        if (s.touch && dist > 10) this.teardown(); // the user is scrolling
        else if (!s.touch && dist > MOVE_START) this.activate();
        return;
      }
      this.place();
    }

    activate() {
      const s = this.state;
      if (!s || s.active) return;
      clearTimeout(s.timer);
      s.active = true;
      s.ghost = this.makeGhost(s.card);
      document.body.append(s.ghost);
      document.body.classList.add('flow-dragging');
      this.classList.add('is-ready');
      s.card.classList.add('is-lifted');
      this._noScroll = (ev) => ev.preventDefault();
      this._noMenu = (ev) => ev.preventDefault();
      document.addEventListener('touchmove', this._noScroll, { passive: false });
      window.addEventListener('contextmenu', this._noMenu);
      this.hideHint();
      this.buzz(12);
      const r = this.btn.getBoundingClientRect();
      this.target = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
      this.place();
    }

    place() {
      const s = this.state;
      const t = this.target;
      const dist = Math.hypot(s.x - t.x, s.y - t.y);
      const hot = dist <= t.r + MAGNET;
      if (hot !== s.hot) {
        s.hot = hot;
        this.classList.toggle('is-hot', hot);
        if (hot) this.buzz(8);
      }
      // gentle magnet: the ghost leans toward the dock when close
      const pull = hot ? 0.28 : 0;
      const gx = s.x + (t.x - s.x) * pull;
      const gy = s.y + (t.y - s.y) * pull;
      s.ghost.style.transform = `translate3d(${gx}px,${gy}px,0) translate(-50%,-58%) rotate(-4deg) scale(${hot ? 0.72 : 1})`;
    }

    finish(released) {
      const s = this.state;
      if (!s) return;
      if (!s.active) return this.teardown();
      const dropped = released && s.hot;
      const { ghost, card } = s;
      this.suppressClick();
      this.teardown();
      if (dropped) {
        this._viaDrag = true;
        store.set('flow_learned', '1');
        document.documentElement.classList.add('flow-learned');
        this.fly(ghost, this.target).then(() => ghost.remove());
        this.choose(card);
      } else {
        const m = card.querySelector('.fx-card__media, .card__media') || card;
        const r = m.getBoundingClientRect();
        this.fly(ghost, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, 0.6, 260).then(() => ghost.remove());
      }
    }

    teardown() {
      const s = this.state;
      if (!s) return;
      clearTimeout(s.timer);
      window.removeEventListener('pointermove', this._move);
      window.removeEventListener('pointerup', this._up);
      window.removeEventListener('pointercancel', this._cancel);
      if (s.active) {
        document.removeEventListener('touchmove', this._noScroll);
        window.removeEventListener('contextmenu', this._noMenu);
        document.body.classList.remove('flow-dragging');
        this.classList.remove('is-ready', 'is-hot');
        s.card.classList.remove('is-lifted');
      }
      this.state = null;
    }

    suppressClick() {
      // swallow only the *native* click that follows a drag; our own programmatic submit click must pass
      const stop = (ev) => {
        if (!ev.isTrusted) return;
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener('click', stop, true);
      };
      window.addEventListener('click', stop, true);
      setTimeout(() => window.removeEventListener('click', stop, true), 400);
    }

    makeGhost(card) {
      const ghost = document.createElement('div');
      ghost.className = 'flow-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      const img = card.querySelector('.fx-card__img, .card__media img, .product__media-item.is-active img, .product__media img, .product-media-container img');
      if (img) {
        const clone = document.createElement('img');
        clone.src = img.currentSrc || img.src;
        clone.alt = '';
        ghost.append(clone);
      } else {
        ghost.classList.add('flow-ghost--text');
        ghost.textContent = card.dataset.flowTitle || '';
      }
      return ghost;
    }

    fly(ghost, to, scale = 0.15, duration = 380) {
      if (reduceMotion.matches || !ghost.animate) return Promise.resolve();
      const anim = ghost.animate(
        [
          { transform: ghost.style.transform, opacity: 1 },
          { transform: `translate3d(${to.x}px,${to.y}px,0) translate(-50%,-50%) scale(${scale}) rotate(14deg)`, opacity: 0.15 },
        ],
        { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }
      );
      return anim.finished.catch(() => {});
    }

    /* ---------- choosing / submitting ---------- */

    choose(card) {
      if (!card) return;
      if (card.dataset.flowMulti === 'true') this.openSheet(card);
      else this.submit(card);
    }

    submit(card) {
      if (card.dataset.flowPage) {
        // product page: use the page's own form so the selected variant and quantity are respected
        const btn = document.querySelector('product-form button[name="add"], form[action*="/cart/add"] button[name="add"]');
        if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') this.fail(str().sheet_unavailable);
        else btn.click();
        return;
      }
      const form = card.querySelector('form[data-flow-form]');
      // A real click on a real submit button: pixels and apps listening for it still fire.
      form?.querySelector('[data-flow-submit]')?.click();
    }

    async add(form) {
      if (form.dataset.busy) return;
      form.dataset.busy = '1';
      this.classList.add('is-busy');
      const cart = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
      const config = fetchConfig('javascript');
      config.headers['X-Requested-With'] = 'XMLHttpRequest';
      delete config.headers['Content-Type'];
      const body = new FormData(form);
      if (cart) {
        body.append('sections', cart.getSectionsToRender().map((section) => section.id));
        body.append('sections_url', window.location.pathname);
        cart.setActiveElement?.(this.btn);
      }
      config.body = body;
      try {
        const res = await fetch(`${routes.cart_add_url}`, config);
        const json = await res.json();
        if (json.status) this.fail(json.description || json.message);
        else this.success(json, cart, body.get('id'));
      } catch (err) {
        console.error(err);
        this.fail();
      } finally {
        delete form.dataset.busy;
        this.classList.remove('is-busy');
      }
    }

    success(json, cart, variantId) {
      if (typeof publish === 'function') {
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'flow', productVariantId: variantId, cartData: json });
      }
      if (cart && cart.tagName === 'CART-DRAWER') {
        // update the drawer + header bubble silently so shoppers can keep dragging
        cart.classList.remove('is-empty');
        cart.querySelector('.drawer__inner')?.classList.remove('is-empty');
        cart.getSectionsToRender().forEach((sec) => {
          const el = sec.selector ? document.querySelector(sec.selector) : document.getElementById(sec.id);
          if (el && json.sections?.[sec.id]) el.innerHTML = cart.getSectionInnerHTML(json.sections[sec.id], sec.selector);
        });
        cart.querySelector('#CartDrawer-Overlay')?.addEventListener('click', cart.close.bind(cart));
        if (this.afterDrop === 'open') setTimeout(() => cart.open());
      } else if (cart) {
        cart.renderContents(json);
      }
      this.refreshCount();
      if (this._viaDrag) {
        store.set('flow_learned', '1'); // the shopper has got it: hint never shows again
        this._viaDrag = false;
      }
      this.hideHint();
      this.pop();
      this.toast(fill(str().added, { title: json.product_title || json.title || '' }));
      this.buzz([10, 40, 10]);
    }

    fail(message) {
      this.classList.add('is-shake');
      setTimeout(() => this.classList.remove('is-shake'), 600);
      this.toast(message || str().error, true);
    }

    /* ---------- dock feedback ---------- */

    pop() {
      this.classList.add('is-pop');
      if (!reduceMotion.matches) {
        for (let i = 0; i < 8; i++) {
          const spark = document.createElement('i');
          spark.className = 'flow-spark';
          spark.style.setProperty('--a', `${i * 45}deg`);
          this.btn.append(spark);
          setTimeout(() => spark.remove(), 700);
        }
      }
      setTimeout(() => this.classList.remove('is-pop'), 700);
    }

    async refreshCount() {
      try {
        const cart = await (await fetch(`${routes.cart_url}.js`)).json();
        this.countEl.textContent = cart.item_count;
        this.countEl.classList.toggle('hidden', cart.item_count === 0);
      } catch (e) {}
    }

    toast(message, isError = false) {
      if (!message) return;
      this.toastEl.textContent = message;
      this.toastEl.classList.toggle('is-error', isError);
      this.toastEl.classList.add('is-visible');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.toastEl.classList.remove('is-visible'), 2600);
    }

    buzz(pattern) {
      if (this.haptics && navigator.vibrate) navigator.vibrate(pattern);
    }

    showHintSoon() {
      const force = /[?&]flow_hint=1/.test(window.location.search) || (window.Shopify && Shopify.designMode);
      if (force) {
        store.del('flow_learned');
        document.documentElement.classList.remove('flow-learned');
        try {
          sessionStorage.removeItem('flow_hint_closed');
        } catch (e) {}
      }
      if (this.dataset.hint !== 'true' || store.get('flow_learned')) return;
      if (!document.querySelector('[data-flow-card]')) return;
      let counted = null;
      try {
        counted = sessionStorage.getItem('flow_session');
        if (sessionStorage.getItem('flow_hint_closed')) return;
      } catch (e) {}
      const visits = Number(store.get('flow_visits') || 0);
      if (!counted) {
        store.set('flow_visits', String(visits + 1));
        try {
          sessionStorage.setItem('flow_session', '1');
        } catch (e) {}
      }
      this._hintTimer = setTimeout(() => {
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        this.hintEl.querySelector('span').textContent = coarse ? str().hint_touch : str().hint_mouse;
        this.hintEl.hidden = false;
        this.classList.add('has-hint');
        requestAnimationFrame(() => this.hintEl.classList.add('is-visible'));
      }, 1200);
    }

    hideHint(closedByUser = false) {
      clearTimeout(this._hintTimer);
      if (closedByUser || this._viaDrag || this.state?.active) this._hintIO?.disconnect();
      this.hintEl.classList.remove('is-visible');
      this.hintEl.hidden = true;
      this.classList.remove('has-hint');
      if (closedByUser) {
        try {
          sessionStorage.setItem('flow_hint_closed', '1');
        } catch (e) {}
      }
    }

    /* ---------- variant sheet (products with options) ---------- */

    async openSheet(card) {
      this.sheetCard = card;
      this.lastFocus = document.activeElement;
      const sheet = this.sheet;
      sheet.querySelector('.flow-sheet__title').textContent = card.dataset.flowTitle || '';
      sheet.querySelector('.flow-sheet__options').innerHTML = '';
      sheet.classList.add('is-loading');
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('is-open'));
      document.body.classList.add('overflow-hidden');
      const panel = sheet.querySelector('.flow-sheet__panel');
      try {
        if (!card._flowProduct) {
          const root = window.Shopify?.routes?.root || '/';
          card._flowProduct = await (await fetch(`${root}products/${card.dataset.flowHandle}.js`)).json();
        }
      } catch (e) {
        this.closeSheet();
        this.fail();
        return;
      }
      const p = card._flowProduct;
      this.sel = (p.variants.find((v) => v.available) || p.variants[0]).options.slice();
      sheet.classList.remove('is-loading');
      this.renderSheet(p);
      if (typeof trapFocus === 'function') trapFocus(panel, panel);
      else panel.focus();
    }

    variantFor(p, sel) {
      return p.variants.find((v) => v.options.every((o, i) => o === sel[i]));
    }

    renderSheet(p) {
      const wrap = this.sheet.querySelector('.flow-sheet__options');
      wrap.innerHTML = '';
      p.options.forEach((opt, i) => {
        const name = typeof opt === 'string' ? opt : opt.name;
        const values = typeof opt === 'string' ? [...new Set(p.variants.map((v) => v.options[i]))] : opt.values;
        const set = document.createElement('fieldset');
        set.className = 'flow-sheet__group';
        const legend = document.createElement('legend');
        legend.textContent = name;
        set.append(legend);
        values.forEach((val) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'flow-pill';
          b.textContent = val;
          b.setAttribute('aria-pressed', String(this.sel[i] === val));
          const probe = this.sel.slice();
          probe[i] = val;
          const v = this.variantFor(p, probe);
          if (!v || !v.available) b.classList.add('is-soldout');
          b.addEventListener('click', () => {
            this.sel[i] = val;
            this.renderSheet(p);
            wrap.querySelector(`fieldset:nth-of-type(${i + 1}) [aria-pressed="true"]`)?.focus();
          });
          set.append(b);
        });
        wrap.append(set);
      });
      const v = this.variantFor(p, this.sel);
      const price = this.sheet.querySelector('.flow-sheet__price');
      const add = this.sheet.querySelector('.flow-sheet__add span');
      const cents = v ? v.price : p.price;
      let money = (cents / 100).toFixed(2);
      try {
        money = new Intl.NumberFormat(document.documentElement.lang || undefined, {
          style: 'currency',
          currency: window.Shopify?.currency?.active || 'USD',
        }).format(cents / 100);
      } catch (e) {}
      price.textContent = money;
      this.currentVariant = v && v.available ? v : null;
      add.textContent = this.currentVariant ? str().sheet_add : v ? str().sheet_sold_out : str().sheet_unavailable;
      this.sheet.querySelector('.flow-sheet__add').disabled = !this.currentVariant;
    }

    confirmSheet() {
      const card = this.sheetCard;
      if (!card || !this.currentVariant) return;
      const form = card.querySelector('form[data-flow-form]');
      form.querySelector('input[name="id"]').value = this.currentVariant.id;
      this.closeSheet(true);
      this.submit(card);
    }

    closeSheet(skipFocus) {
      const sheet = this.sheet;
      sheet.classList.remove('is-open');
      document.body.classList.remove('overflow-hidden');
      if (typeof removeTrapFocus === 'function') removeTrapFocus(skipFocus ? null : this.lastFocus);
      setTimeout(() => {
        if (!sheet.classList.contains('is-open')) sheet.hidden = true;
      }, reduceMotion.matches ? 0 : 260);
    }
  }

  customElements.define('flow-dock', FlowDock);
})();
