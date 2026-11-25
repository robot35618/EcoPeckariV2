(function () {
  'use strict';

  /* ================= Константы ================= */
  const KEYS = {
    products: 'ecopekary_products',
    orders: 'ecopekary_orders',
    cart: 'ecopekary_cart',
    settings: 'ecopekary_settings'
  };
  const STATUSES = ['Новая', 'Обработана', 'Доставляется', 'Выполнена', 'Отменена'];
  const REVENUE_STATUSES = ['Обработана', 'Выполнена'];
  const LOW_STOCK = 500;
  const PHONE_RE = /^\+?\d[\d\s\-()]{9,17}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Резервные данные, если data/products.json недоступен (например, открытие через file://)
  const SEED = {
    products: [
      { id: 1, name: 'Мука пшеничная хлебопекарная «Экопекарь» высший сорт', type: 'Мука', gost: 'ГОСТ 26574-2017', pack: [50], price: 32, stock: 12000 },
      { id: 2, name: 'Отруби пшеничные пушистые (кормовые)', type: 'Отруби', gost: '', pack: [22], price: 12, stock: 3000 }
    ],
    settings: { cityDeliveryCost: 500, freeDeliveryFrom: 20000 }
  };

  /* ================= Вспомогательное ================= */
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => n.toLocaleString('ru-RU') + ' ₽';
  const isPosInt = (n) => Number.isInteger(n) && n > 0;

  function notify(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ================= Слой данных (JSON в localStorage) ================= */
  const Db = {
    read(name, def) {
      try {
        const raw = localStorage.getItem(KEYS[name]);
        return raw ? JSON.parse(raw) : def;
      } catch (e) { return def; }
    },
    write(name, value) { localStorage.setItem(KEYS[name], JSON.stringify(value)); },

    async init() {
      if (!this.read('products')) {
        let data;
        try {
          const r = await fetch('data/products.json');
          if (!r.ok) throw new Error('http');
          data = await r.json();
        } catch (e) { data = SEED; }
        this.validateProducts(data.products);
        this.write('products', data.products);
        this.write('settings', data.settings);
      }
      if (!this.read('orders')) this.write('orders', []);
      if (!this.read('cart')) this.write('cart', { items: [], total: 0 });
    },

    // Правила целостности
    validateProducts(list) {
      const ids = new Set();
      list.forEach((p) => {
        if (ids.has(p.id)) throw new Error('Дублирующийся id товара: ' + p.id);
        ids.add(p.id);
        if (!Number.isInteger(p.stock) || p.stock < 0) throw new Error('Некорректный остаток: ' + p.name);
      });
    },
    validateOrder(o) {
      if (this.read('orders', []).some((x) => x.id === o.id)) throw new Error('Номер заявки не уникален');
      if (!STATUSES.includes(o.status)) throw new Error('Недопустимый статус');
      const prods = this.read('products', []);
      let sum = 0;
      o.items.forEach((i) => {
        if (!prods.some((p) => p.id === i.productId)) throw new Error('Товар не найден в каталоге');
        if (!isPosInt(i.qty)) throw new Error('Количество должно быть целым положительным');
        sum += i.qty * i.price;
      });
      if (o.total !== sum + o.delivery.cost) throw new Error('Итоговая сумма вычислена неверно');
    }
  };

  const products = () => Db.read('products', []);
  const prodById = (id) => products().find((p) => p.id === id);

  /* ================= Корзина ================= */
  const loadCart = () => Db.read('cart', { items: [], total: 0 });
  function recalcCart(c) { c.total = c.items.reduce((s, i) => s + i.qty * i.price, 0); return c; }
  function saveCart(c) { Db.write('cart', recalcCart(c)); updateBadge(); }
  function updateBadge() { const el = $('#cartCount'); if (el) el.textContent = loadCart().items.length; }

  function deliveryCost(c, method) {
    const s = Db.read('settings', SEED.settings);
    if (method !== 'city') return 0;
    return c.total >= s.freeDeliveryFrom ? 0 : s.cityDeliveryCost;
  }

  // Возвращает текст ошибки или '' при успехе
  function addToCart(id, qty) {
    const p = prodById(id);
    if (!p || !isPosInt(qty)) return 'Укажите количество';
    const c = loadCart();
    const it = c.items.find((i) => i.productId === id);
    const left = p.stock - (it ? it.qty : 0);
    if (qty > left) return 'В наличии только ' + left + ' кг';
    if (it) it.qty += qty; else c.items.push({ productId: id, qty: qty, price: p.price });
    saveCart(c);
    return '';
  }

  /* ================= Каталог ================= */
  // Блоки покупки внутри карточек «Мука» и «Отруби» (data-buy = id товара)
  function renderCatalog() {
    document.querySelectorAll('[data-buy]').forEach((box) => {
      const p = prodById(Number(box.dataset.buy));
      if (!p) { box.innerHTML = ''; return; }
      const ok = p.stock > 0;
      box.innerHTML = `<p class="card__price">${money(p.price)} / кг</p>
        <p class="card__stock">${ok ? 'В наличии: ' + p.stock + ' кг' : ''}</p>
        <div class="card__row">
          <select data-pack="${p.id}">${p.pack.map((k) => `<option value="${k}">Мешок ${k} кг</option>`).join('')}</select>
          <input type="number" min="1" step="1" value="1" data-count="${p.id}" aria-label="Количество мешков">
        </div>
        <button type="button" class="btn" data-add="${p.id}" ${ok ? '' : 'disabled'}>${ok ? 'В корзину' : 'Нет в наличии'}</button>`;
    });
  }

  /* ================= Корзина / оформление ================= */
  const modal = () => $('#modal');
  const draft = { fio: '', phone: '', email: '', address: '', method: 'pickup' };

  function openCart() {
    const c = loadCart();
    const cost = deliveryCost(c, draft.method);
    let html = '<button type="button" class="modal__close" data-close>×</button><h2>Корзина</h2>';
    if (!c.items.length) {
      html += '<p>Корзина пуста</p>';
    } else {
      html += '<div class="tbl"><table><tr><th>Товар</th><th>Цена/кг</th><th>Количество</th><th>Сумма</th><th></th></tr>' +
        c.items.map((i) => {
          const p = prodById(i.productId);
          return `<tr><td>${esc(p.name)}</td><td>${money(i.price)}</td>
            <td><input type="number" min="1" step="1" value="${i.qty}" data-qty="${i.productId}"> кг</td>
            <td>${money(i.qty * i.price)}</td><td><button type="button" class="link" data-del="${i.productId}">Удалить</button></td></tr>`;
        }).join('') + '</table></div>' +
        `<div class="form">
          <input data-f="fio" placeholder="ФИО получателя" value="${esc(draft.fio)}">
          <input data-f="phone" placeholder="Телефон" value="${esc(draft.phone)}">
          <input data-f="email" placeholder="E-mail" value="${esc(draft.email)}">
          <select data-f="method">
            <option value="pickup"${draft.method === 'pickup' ? ' selected' : ''}>Самовывоз</option>
            <option value="city"${draft.method === 'city' ? ' selected' : ''}>Доставка по городу</option>
          </select>
          <input data-f="address" placeholder="Адрес доставки" value="${esc(draft.address)}">
        </div>
        <p>Товары: ${money(c.total)}<br>Доставка: ${cost ? money(cost) : 'бесплатно'}<br>
        <b>Итого: ${money(c.total + cost)}</b></p>
        <p class="form__err" id="formErr"></p>
        <button type="button" class="btn" data-submit>Оформить заявку</button>`;
    }
    modal().innerHTML = '<div class="modal__box">' + html + '</div>';
    modal().hidden = false;
  }

  function validateCustomer(d) {
    if (d.fio.trim().length < 2) return 'Укажите ФИО';
    if (!PHONE_RE.test(d.phone.trim())) return 'Некорректный телефон';
    if (!EMAIL_RE.test(d.email.trim())) return 'Некорректный e-mail';
    if (d.method === 'city' && !d.address.trim()) return 'Укажите адрес доставки';
    return '';
  }

  function submitOrder() {
    const fail = (m) => { const e = $('#formErr'); if (e) e.textContent = m; notify(m); };
    const c = loadCart();
    if (!c.items.length) return fail('Корзина пуста');
    const err = validateCustomer(draft);
    if (err) return fail(err);

    const prods = products();
    for (const i of c.items) {
      const p = prods.find((x) => x.id === i.productId);
      if (!p || i.qty > p.stock) return fail('Недостаточно товара «' + (p ? p.name : '?') + '» на складе');
    }
    const orders = Db.read('orders', []);
    const cost = deliveryCost(c, draft.method);
    const order = {
      id: orders.reduce((m, o) => Math.max(m, o.id), 0) + 1,
      datetime: new Date().toISOString(),
      customer: { fio: draft.fio.trim(), phone: draft.phone.trim(), email: draft.email.trim(), address: draft.address.trim() },
      items: c.items.map((i) => ({
        productId: i.productId, name: prods.find((p) => p.id === i.productId).name,
        qty: i.qty, price: i.price, sum: i.qty * i.price
      })),
      delivery: { method: draft.method, cost: cost },
      total: c.total + cost,
      status: 'Новая'
    };
    try { Db.validateOrder(order); } catch (e) { return fail(e.message); }

    c.items.forEach((i) => { prods.find((p) => p.id === i.productId).stock -= i.qty; });
    Db.write('products', prods);
    orders.push(order);
    Db.write('orders', orders);
    saveCart({ items: [], total: 0 });
    Object.assign(draft, { fio: '', phone: '', email: '', address: '', method: 'pickup' });

    modal().innerHTML = `<div class="modal__box"><button type="button" class="modal__close" data-close>×</button>
      <h2>Заявка №${order.id} принята</h2>
      <p>Статус: ${order.status}<br>Сумма: ${money(order.total)}<br>Менеджер свяжется с вами.</p></div>`;
    renderCatalog(); renderAdmin();
  }

  /* ================= Админ-панель ================= */
  function renderAdmin() {
    const box = $('#admin');
    if (!box || box.hidden) return;
    const orders = Db.read('orders', []).slice().sort((a, b) => b.id - a.id);
    const today = new Date().toDateString();
    const countToday = orders.filter((o) => new Date(o.datetime).toDateString() === today).length;
    const revenue = orders.filter((o) => REVENUE_STATUSES.includes(o.status)).reduce((s, o) => s + o.total, 0);
    const low = products().filter((p) => p.stock < LOW_STOCK);

    box.innerHTML = `<h1 class="Outliner">Админ-панель</h1>
      <div class="admin__sum">
        <div>Заявок за сегодня: <b>${countToday}</b></div>
        <div>Выручка (обработанные и выполненные): <b>${money(revenue)}</b></div>
        <div>Низкий остаток (&lt; ${LOW_STOCK} кг): <b>${low.length ? low.map((p) => esc(p.name) + ' — ' + p.stock + ' кг').join('; ') : 'нет'}</b></div>
      </div>
      <h2 class="Outliner__smaller">Журнал заявок</h2>
      <div class="tbl"><table><tr><th>№</th><th>Дата</th><th>Покупатель</th><th>Состав</th><th>Сумма</th><th>Статус</th></tr>` +
      (orders.length ? orders.map((o) => `<tr>
        <td>${o.id}</td><td>${new Date(o.datetime).toLocaleString('ru-RU')}</td>
        <td>${esc(o.customer.fio)}<br>${esc(o.customer.phone)}</td>
        <td>${o.items.map((i) => esc(i.name) + ' × ' + i.qty + ' кг').join('<br>')}</td>
        <td>${money(o.total)}</td>
        <td><select data-status="${o.id}">${STATUSES.map((s) => `<option${s === o.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
      </tr>`).join('') : '<tr><td colspan="6">Заявок пока нет</td></tr>') +
      `</table></div>
      <h2 class="Outliner__smaller">Склад</h2>
      <div class="tbl"><table>${products().map((p) => `<tr><td>${esc(p.name)}</td>
        <td><input type="number" min="0" step="1" value="${p.stock}" data-stockinput="${p.id}"> кг</td>
        <td><button type="button" class="btn btn--small" data-stocksave="${p.id}">Сохранить</button></td></tr>`).join('')}</table></div>`;
  }

  /* ================= События ================= */
  function bind() {
    // Навигация по разделам
    document.querySelectorAll('[data-go]').forEach((el) =>
      el.addEventListener('click', () => { const t = document.getElementById(el.dataset.go); if (t) t.scrollIntoView({ behavior: 'smooth' }); }));

    // Кнопки «В корзину»
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]'); if (!b) return;
      const id = Number(b.dataset.add);
      const pack = Number($('[data-pack="' + id + '"]').value);
      const cnt = Number($('[data-count="' + id + '"]').value);
      const err = addToCart(id, pack * cnt);
      notify(err || 'Добавлено в корзину');
    });
    $('#cartBtn').addEventListener('click', openCart);

    // Модальное окно корзины
    const m = modal();
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('[data-close]')) { m.hidden = true; return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        const c = loadCart();
        c.items = c.items.filter((i) => i.productId !== Number(del.dataset.del));
        saveCart(c); openCart(); return;
      }
      if (e.target.closest('[data-submit]')) submitOrder();
    });
    m.addEventListener('input', (e) => { const f = e.target.dataset.f; if (f && f !== 'method') draft[f] = e.target.value; });
    m.addEventListener('change', (e) => {
      if (e.target.dataset.f === 'method') { draft.method = e.target.value; openCart(); return; }
      const id = e.target.dataset.qty;
      if (id) {
        const qty = Number(e.target.value), p = prodById(Number(id)), c = loadCart();
        const it = c.items.find((i) => i.productId === Number(id));
        if (!isPosInt(qty)) notify('Количество должно быть целым положительным');
        else if (qty > p.stock) notify('В наличии только ' + p.stock + ' кг');
        else { it.qty = qty; saveCart(c); }
        openCart();
      }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.hidden = true; });

    // Админ-панель
    $('#adminLink').addEventListener('click', (e) => {
      e.preventDefault();
      const box = $('#admin'); box.hidden = !box.hidden;
      renderAdmin();
      if (!box.hidden) box.scrollIntoView({ behavior: 'smooth' });
    });
    $('#admin').addEventListener('change', (e) => {
      const id = e.target.dataset.status;
      if (!id) return;
      if (!STATUSES.includes(e.target.value)) return notify('Недопустимый статус');
      const orders = Db.read('orders', []);
      orders.find((o) => o.id === Number(id)).status = e.target.value;
      Db.write('orders', orders);
      renderAdmin();
    });
    $('#admin').addEventListener('click', (e) => {
      const b = e.target.closest('[data-stocksave]'); if (!b) return;
      const id = Number(b.dataset.stocksave);
      const val = Number($('[data-stockinput="' + id + '"]').value);
      if (!Number.isInteger(val) || val < 0) return notify('Остаток — целое неотрицательное число');
      const list = products();
      list.find((p) => p.id === id).stock = val;
      Db.write('products', list);
      renderCatalog(); renderAdmin(); notify('Остаток сохранён');
    });

    // Синхронизация между вкладками
    window.addEventListener('storage', () => { updateBadge(); renderCatalog(); renderAdmin(); });
  }

  /* ================= Запуск ================= */
  Db.init().then(() => {
    bind(); renderCatalog(); updateBadge();
    if (location.hash === '#admin') $('#adminLink').click();
  });
})();
