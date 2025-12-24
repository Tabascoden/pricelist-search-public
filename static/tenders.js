// static/tenders.js
(() => {
  const ROOT_ID = "tenders-demo";
  const MIN_SCORE = 0.3;

  const LS_SUPPLIERS_PREFIX = "tenders.selectedSuppliers.v1:";
  const LS_BLOCKED_PREFIX = "tenders.blockedMatches.v1:";

  const state = {
    view: "list",               // list | project
    projects: [],
    project: null,
    suppliers: [],
    selectedSupplierIds: [],
    matrix: {},                 // { [itemId]: { [supplierId]: match } }
    blocked: {},                // { ["itemId:supplierId"]: true }
    matchModal: { open: false, itemId: null, supplierId: null, rows: [], loading: false },
    suppliersDropdownOpen: false,
    loading: false,
    error: null,
  };

  // ---------- utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) => String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const fmtNum = (x, digits = 2) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return "";
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(n);
  };

  const fmtMoney = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return "";
    // Валюта может быть не всегда RUB — но визуально удобно.
    return `${fmtNum(n, 2)} ₽`;
  };

  function parsePath() {
    const p = (location.pathname || "").replace(/\/+$/, "");
    const m = p.match(/^\/tenders(?:\/(\d+))?$/);
    return { ok: !!m, projectId: m && m[1] ? Number(m[1]) : null };
  }

  async function apiJson(url, opts = {}) {
    const r = await fetch(url, opts);
    let j = null;
    try { j = await r.json(); } catch { /* ignore */ }
    if (!r.ok) {
      const msg = (j && (j.error || j.details)) ? `${j.error || "error"}: ${j.details || ""}` : `HTTP ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      e.payload = j;
      throw e;
    }
    return j;
  }

  function lsKeySuppliers(projectId) { return `${LS_SUPPLIERS_PREFIX}${projectId}`; }
  function lsKeyBlocked(projectId) { return `${LS_BLOCKED_PREFIX}${projectId}`; }

  function loadSelectedSuppliersLS(projectId) {
    try {
      const raw = localStorage.getItem(lsKeySuppliers(projectId));
      const ids = JSON.parse(raw || "[]");
      return Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
    } catch { return []; }
  }

  function saveSelectedSuppliersLS(projectId, ids) {
    localStorage.setItem(lsKeySuppliers(projectId), JSON.stringify(ids || []));
  }

  function loadBlockedLS(projectId) {
    try {
      const raw = localStorage.getItem(lsKeyBlocked(projectId));
      const obj = JSON.parse(raw || "{}");
      return obj && typeof obj === "object" ? obj : {};
    } catch { return {}; }
  }

  function saveBlockedLS(projectId, blocked) {
    localStorage.setItem(lsKeyBlocked(projectId), JSON.stringify(blocked || {}));
  }

  function calcTotals(offer, tenderQty) {
    // Логика как в app.py (_calc_offer_totals), но на клиенте
    const qty = Number(tenderQty);
    const baseQty = offer && offer.base_qty != null ? Number(offer.base_qty) : null;
    const ppu = offer && offer.price_per_unit != null ? Number(offer.price_per_unit) : null;
    const price = offer && offer.price != null ? Number(offer.price) : null;

    let packsNeeded = null;
    let totalPrice = null;

    if (Number.isFinite(qty) && Number.isFinite(baseQty) && baseQty > 0) {
      packsNeeded = Math.ceil(qty / baseQty);
    }
    if (Number.isFinite(qty) && Number.isFinite(ppu)) {
      totalPrice = ppu * qty;
    } else if (Number.isFinite(packsNeeded) && Number.isFinite(price)) {
      totalPrice = packsNeeded * price;
    }
    return { totalPrice, packsNeeded };
  }

  function getSupplierName(supplierId) {
    const s = state.suppliers.find(x => Number(x.id) === Number(supplierId));
    return s ? (s.name || `Поставщик #${supplierId}`) : `Поставщик #${supplierId}`;
  }

  function getMatch(itemId, supplierId) {
    const row = state.matrix?.[String(itemId)];
    if (!row) return null;
    return row[String(supplierId)] || null;
  }

  function isBlocked(itemId, supplierId) {
    return !!state.blocked?.[`${itemId}:${supplierId}`];
  }

  // ---------- data loading ----------
  async function loadProjects() {
    const j = await apiJson("/api/tenders");
    state.projects = j.projects || [];
  }

  async function loadSuppliers() {
    const j = await apiJson("/api/suppliers");
    state.suppliers = j.suppliers || [];
  }

  async function loadProject(projectId) {
    const j = await apiJson(`/api/tenders/${projectId}`);
    state.project = j.project || null;
  }

  async function loadSelectedSuppliers(projectId) {
    // пробуем серверное хранение, если нет — localStorage
    try {
      const j = await apiJson(`/api/tenders/${projectId}/suppliers`);
      const ids = (j.supplier_ids || []).map(Number).filter(Number.isFinite);
      state.selectedSupplierIds = ids;
      saveSelectedSuppliersLS(projectId, ids);
    } catch (e) {
      state.selectedSupplierIds = loadSelectedSuppliersLS(projectId);
    }
  }

  async function saveSelectedSuppliers(projectId, ids) {
    // пробуем сохранить на сервер, если нет — localStorage
    try {
      await apiJson(`/api/tenders/${projectId}/suppliers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier_ids: ids }),
      });
    } catch { /* ignore */ }
    saveSelectedSuppliersLS(projectId, ids);
    state.selectedSupplierIds = ids;
  }

  async function loadMatrix(projectId) {
    state.matrix = {};
    const ids = (state.selectedSupplierIds || []).map(Number).filter(Number.isFinite);
    if (!ids.length) return;

    try {
      const qs = `supplier_ids=${encodeURIComponent(ids.join(","))}&min_score=0`;
      const j = await apiJson(`/api/tenders/${projectId}/matrix?${qs}`);
      state.matrix = j.matrix || {};
    } catch (e) {
      // если нет эндпойнта — просто оставим пусто (таблица будет без матчей)
      state.matrix = {};
    }
  }

  // ---------- UI: dropdowns ----------
  function openSuppliersDropdown() {
    state.suppliersDropdownOpen = true;
    $("#tenders-suppliers-dropdown").classList.remove("hidden");
    renderSuppliersDropdown();
  }

  function closeSuppliersDropdown() {
    state.suppliersDropdownOpen = false;
    $("#tenders-suppliers-dropdown").classList.add("hidden");
  }

  function renderSuppliersDropdown() {
    const list = $("#tenders-suppliers-list");
    const q = ($("#tenders-suppliers-search").value || "").trim().toLowerCase();

    const selected = new Set(state.selectedSupplierIds.map(Number));
    const rows = state.suppliers
      .filter(s => {
        const name = String(s.name || "").toLowerCase();
        return !q || name.includes(q);
      })
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"))
      .map(s => {
        const checked = selected.has(Number(s.id)) ? "checked" : "";
        return `
          <label class="suppliersItem">
            <input type="checkbox" data-supplier-id="${esc(s.id)}" ${checked} />
            <div>
              <div style="font-weight:800;">${esc(s.name || ("Поставщик #" + s.id))}</div>
              <div class="tender-hint">id: ${esc(s.id)} • строк в прайсе: ${esc(s.rows_imported ?? "")}</div>
            </div>
          </label>
        `;
      }).join("");

    list.innerHTML = rows || `<div class="tender-hint">Поставщики не найдены.</div>`;
  }

  function openMatchModal(itemId, supplierId) {
    state.matchModal = { open: true, itemId, supplierId, rows: [], loading: true };
    $("#tenders-match-modal").classList.remove("hidden");

    const item = state.project?.items?.find(x => Number(x.id) === Number(itemId));
    $("#tenders-match-title").textContent = `${getSupplierName(supplierId)} — подбор`;
    $("#tenders-match-sub").textContent = item ? `Нужно: ${item.name_input} (кол-во: ${item.qty ?? "—"} ${item.unit_input ?? ""})` : "";

    loadMatches(itemId, supplierId).catch(() => {}).finally(() => {
      state.matchModal.loading = false;
      renderMatchModal();
    });
    renderMatchModal();
  }

  function closeMatchModal() {
    state.matchModal = { open: false, itemId: null, supplierId: null, rows: [], loading: false };
    $("#tenders-match-modal").classList.add("hidden");
  }

  async function loadMatches(itemId, supplierId) {
    const j = await apiJson(`/api/tenders/items/${itemId}/matches?supplier_id=${encodeURIComponent(supplierId)}&limit=25`);
    state.matchModal.rows = j.matches || [];
  }

  function renderMatchModal() {
    const body = $("#tenders-match-body");
    if (state.matchModal.loading) {
      body.innerHTML = `<tr><td colspan="5" class="tender-hint">Загрузка…</td></tr>`;
      return;
    }
    const item = state.project?.items?.find(x => Number(x.id) === Number(state.matchModal.itemId));
    const qty = item?.qty;

    const rows = (state.matchModal.rows || [])
      .map(m => {
        const { totalPrice } = calcTotals(m, qty);
        const score = Number(m.score);
        const scoreTxt = Number.isFinite(score) ? fmtNum(score, 3) : "";
        const disabled = (Number.isFinite(score) && score < MIN_SCORE) ? "disabled" : "";
        return `
          <tr>
            <td><b>${esc(scoreTxt)}</b></td>
            <td>${esc(m.name_raw || "")}</td>
            <td>${esc(fmtMoney(m.price_per_unit ?? m.price))}</td>
            <td>${esc(fmtMoney(totalPrice))}</td>
            <td>
              <button class="btn primary" data-pick="1" data-supplier-item-id="${esc(m.supplier_item_id)}" ${disabled}>★ Выбрать</button>
            </td>
          </tr>
        `;
      }).join("");

    body.innerHTML = rows || `<tr><td colspan="5" class="tender-hint">Ничего не найдено.</td></tr>`;

    // bind picks
    $$("button[data-pick]", body).forEach(btn => {
      btn.onclick = async () => {
        const supplierItemId = Number(btn.getAttribute("data-supplier-item-id"));
        await pickToCart(state.matchModal.itemId, supplierItemId);
        closeMatchModal();
      };
    });
  }

  // ---------- actions ----------
  async function pickToCart(itemId, supplierItemId) {
    const pid = state.project?.id;
    if (!pid) return;

    await apiJson(`/api/tenders/items/${itemId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tender_item_id: itemId,
        supplier_item_id: supplierItemId,
        project_id: pid
      }),
    });

    await reloadProjectHard();
  }

  async function clearFromCart(itemId) {
    const pid = state.project?.id;
    if (!pid) return;

    try {
      await apiJson(`/api/tenders/items/${itemId}/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: pid }),
      });
    } catch {
      // если нет API — просто перезагрузим проект (состояние могло не измениться)
    }
    await reloadProjectHard();
  }

  async function buildOrders() {
    const pid = state.project?.id;
    if (!pid) return;

    const box = $("#tenders-orders");
    box.innerHTML = `<div class="tender-hint">Собираю заказы…</div>`;

    try {
      const j = await apiJson(`/api/tenders/${pid}/orders`, { method: "POST" });
      const orders = j.orders || [];
      if (!orders.length) {
        box.innerHTML = `<div class="tender-hint">Не получилось собрать заказы: корзина пустая.</div>`;
        return;
      }
      const html = orders.map(o => `
        <div class="orderBlock">
          <div class="orderHead">
            <div>
              <div class="orderTitle">Заказ #${esc(o.order_id)}</div>
              <div class="orderMeta">${esc(o.supplier_name || "")} • позиций: ${esc(o.items_count)} • сумма: <b>${esc(fmtMoney(o.total_price))}</b></div>
            </div>
          </div>
        </div>
      `).join("");
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = `<div class="tender-hint">Эндпойнт /api/tenders/&lt;id&gt;/orders пока не добавлен (см. пункт 3 ниже).</div>`;
    }
  }

  async function reloadProjectHard() {
    const pid = state.project?.id;
    if (!pid) return;

    state.blocked = loadBlockedLS(pid);
    await loadProject(pid);
    await loadMatrix(pid);
    renderProject();
  }

  // ---------- rendering ----------
  function renderList() {
    const listBox = $("#tenders-view-list");
    const projectBox = $("#tenders-view-project");
    listBox.classList.remove("hidden");
    projectBox.classList.add("hidden");

    const tb = $("#tenders-list-body");
    tb.innerHTML = (state.projects || []).map(p => `
      <tr>
        <td>${esc(p.id)}</td>
        <td><b>${esc(p.title || ("Тендер #" + p.id))}</b></td>
        <td>${esc(p.items_count ?? "")}</td>
        <td class="tender-actions-col">
          <button class="btn" data-open="${esc(p.id)}">Открыть</button>
          <button class="btn danger" data-del="${esc(p.id)}">Удалить</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="tender-hint">Пока нет тендеров. Загрузите Excel.</td></tr>`;

    $$("button[data-open]", tb).forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute("data-open"));
        location.href = `/tenders/${id}`;
      };
    });

    $$("button[data-del]", tb).forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute("data-del"));
        if (!confirm(`Удалить тендер #${id}?`)) return;
        await apiJson(`/api/tenders/${id}`, { method: "DELETE" });
        await loadProjects();
        renderList();
      };
    });
  }

  function renderSelectedSuppliersChipline() {
    const box = $("#tenders-selected-suppliers");
    const ids = state.selectedSupplierIds || [];
    if (!ids.length) {
      box.innerHTML = `<div class="tender-legend-title">Поставщики</div><div class="tender-hint">Не выбраны. Нажми «Выбрать поставщиков».</div>`;
      return;
    }
    const chips = ids.map(id => `<span class="tag">${esc(getSupplierName(id))}</span>`).join(" ");
    box.innerHTML = `<div class="tender-legend-title">Поставщики для сравнения (${ids.length})</div><div>${chips}</div>`;
  }

  function renderProject() {
    const listBox = $("#tenders-view-list");
    const projectBox = $("#tenders-view-project");
    listBox.classList.add("hidden");
    projectBox.classList.remove("hidden");

    const p = state.project;
    if (!p) return;

    $("#tenders-project-title").textContent = `Тендер #${p.id}: ${p.title || ""}`.trim();
    $("#tenders-project-meta").textContent =
      `Позиций: ${(p.items || []).length} • Минимальный score для показа: ${MIN_SCORE}`;

    renderSelectedSuppliersChipline();
    renderProjectTable();
    renderCart();
  }

  function renderProjectTable() {
    const tbl = $("#tenders-project-table");
    const items = state.project?.items || [];
    const supplierIds = (state.selectedSupplierIds || []).map(Number).filter(Number.isFinite);

    const thead = `
      <thead>
        <tr>
          <th style="width:70px;">№</th>
          <th style="min-width:260px;">Номенклатура</th>
          <th style="width:110px;">Кол-во</th>
          <th style="width:90px;">Ед.</th>
          ${supplierIds.map(id => `<th class="supplierTh">${esc(getSupplierName(id))}</th>`).join("")}
        </tr>
      </thead>
    `;

    const tbody = items.map(it => {
      // найти минимальную цену по строке (по totalPrice)
      const candidates = supplierIds
        .map(sid => {
          const m = getMatch(it.id, sid);
          if (!m) return null;
          const score = Number(m.score);
          if (!Number.isFinite(score) || score < MIN_SCORE) return null;
          if (isBlocked(it.id, sid)) return null;
          const { totalPrice } = calcTotals(m, it.qty);
          return { sid, totalPrice };
        })
        .filter(Boolean)
        .filter(x => Number.isFinite(x.totalPrice));

      let bestSid = null;
      if (candidates.length) {
        candidates.sort((a, b) => a.totalPrice - b.totalPrice);
        bestSid = candidates[0].sid;
      }

      const selectedOfferId = it.selected_offer_id ? Number(it.selected_offer_id) : null;
      const selectedOffer = selectedOfferId ? (it.offers || []).find(o => Number(o.id) === selectedOfferId) : null;
      const pickedSupplierId = selectedOffer?.supplier_id != null ? Number(selectedOffer.supplier_id) : null;

      const rowCells = supplierIds.map(sid => {
        const key = `${it.id}:${sid}`;
        const blocked = isBlocked(it.id, sid);

        // picked?
        const picked = pickedSupplierId != null && pickedSupplierId === sid;

        // match (best guess)
        const m = getMatch(it.id, sid);
        const score = m ? Number(m.score) : NaN;

        if (blocked) {
          return `
            <td class="supplierCell">
              <div class="tender-hint">Скрыто</div>
              <div class="iconRow">
                <button class="iconBtn" title="Вернуть" data-unblock="${esc(key)}">↩</button>
                <button class="iconBtn" title="Найти" data-find="1" data-item-id="${esc(it.id)}" data-supplier-id="${esc(sid)}">🔍</button>
              </div>
            </td>
          `;
        }

        if (!m || !Number.isFinite(score) || score < MIN_SCORE) {
          return `
            <td class="supplierCell">
              <div class="supEmpty"></div>
              <div class="iconRow">
                <button class="iconBtn" title="Найти" data-find="1" data-item-id="${esc(it.id)}" data-supplier-id="${esc(sid)}">🔍</button>
              </div>
            </td>
          `;
        }

        const { totalPrice } = calcTotals(m, it.qty);
        const cls = [
          "supplierCell",
          picked ? "picked" : "",
          (!picked && bestSid === sid) ? "best" : ""
        ].filter(Boolean).join(" ");

        return `
          <td class="${cls}">
            <div class="supName">${esc(m.name_raw || "")}</div>
            <div class="supMeta">
              <div class="supPrice">${esc(fmtMoney(totalPrice))}</div>
              <div class="supScore">score: ${esc(fmtNum(score, 3))} • цена/ед: ${esc(fmtMoney(m.price_per_unit ?? m.price))}</div>
            </div>
            <div class="iconRow">
              <button class="iconBtn" title="Скрыть" data-block="${esc(key)}">✕</button>
              <button class="iconBtn" title="Найти другой" data-find="1" data-item-id="${esc(it.id)}" data-supplier-id="${esc(sid)}">🔍</button>
              <button class="iconBtn" title="Выбрать в корзину" data-pick="1" data-item-id="${esc(it.id)}" data-supplier-item-id="${esc(m.supplier_item_id)}">★</button>
            </div>
          </td>
        `;
      }).join("");

      return `
        <tr>
          <td>${esc(it.row_no ?? "")}</td>
          <td><b>${esc(it.name_input || "")}</b></td>
          <td>${esc(fmtNum(it.qty, 3))}</td>
          <td>${esc(it.unit_input || "")}</td>
          ${rowCells}
        </tr>
      `;
    }).join("");

    tbl.innerHTML = `${thead}<tbody>${tbody}</tbody>`;

    // bind events
    $$("[data-block]", tbl).forEach(btn => {
      btn.onclick = () => {
        const key = btn.getAttribute("data-block");
        state.blocked[key] = true;
        saveBlockedLS(state.project.id, state.blocked);
        renderProjectTable();
      };
    });

    $$("[data-unblock]", tbl).forEach(btn => {
      btn.onclick = () => {
        const key = btn.getAttribute("data-unblock");
        delete state.blocked[key];
        saveBlockedLS(state.project.id, state.blocked);
        renderProjectTable();
      };
    });

    $$("[data-find]", tbl).forEach(btn => {
      btn.onclick = () => {
        const itemId = Number(btn.getAttribute("data-item-id"));
        const supplierId = Number(btn.getAttribute("data-supplier-id"));
        openMatchModal(itemId, supplierId);
      };
    });

    $$("[data-pick]", tbl).forEach(btn => {
      btn.onclick = async () => {
        const itemId = Number(btn.getAttribute("data-item-id"));
        const supplierItemId = Number(btn.getAttribute("data-supplier-item-id"));
        await pickToCart(itemId, supplierItemId);
      };
    });
  }

  function renderCart() {
    const box = $("#tenders-cart");
    const totalsBox = $("#tenders-totals");
    const actionsBox = $("#tenders-cart-actions");

    const items = state.project?.items || [];
    const cart = [];

    for (const it of items) {
      const selId = it.selected_offer_id != null ? Number(it.selected_offer_id) : null;
      if (!selId) continue;

      const offer = (it.offers || []).find(o => Number(o.id) === selId);
      if (!offer) continue;

      const { totalPrice } = calcTotals(offer, it.qty);
      cart.push({
        item_id: it.id,
        row_no: it.row_no,
        name_input: it.name_input,
        qty: it.qty,
        unit_input: it.unit_input,
        supplier_id: offer.supplier_id,
        supplier_name: offer.supplier_name,
        supplier_item_id: offer.supplier_item_id,
        name_raw: offer.name_raw,
        price_per_unit: offer.price_per_unit ?? offer.price,
        total_price: offer.total_price ?? totalPrice,
      });
    }

    if (!cart.length) {
      actionsBox.innerHTML = "";
      box.innerHTML = `<div class="tender-hint" style="margin-top:10px;">Корзина пуста. Нажимай ★ в ячейках поставщиков.</div>`;
      totalsBox.innerHTML = "";
      return;
    }

    // actions
    const suppliersInCart = Array.from(new Set(cart.map(x => Number(x.supplier_id)).filter(Number.isFinite)));
    actionsBox.innerHTML = `
      <div class="tender-hint">Поставщиков в корзине: <b>${suppliersInCart.length}</b></div>
    `;

    // cart table with qty column
    box.innerHTML = `
      <table class="cartTable">
        <thead>
          <tr>
            <th style="width:70px;">№</th>
            <th>Позиция</th>
            <th style="width:120px;">Количество</th>
            <th style="width:90px;">Ед.</th>
            <th style="width:200px;">Поставщик</th>
            <th>Товар у поставщика</th>
            <th style="width:120px;">Цена/ед.</th>
            <th style="width:120px;">Сумма</th>
            <th style="width:90px;"></th>
          </tr>
        </thead>
        <tbody>
          ${cart.map(r => `
            <tr>
              <td>${esc(r.row_no ?? "")}</td>
              <td><b>${esc(r.name_input || "")}</b></td>
              <td>${esc(fmtNum(r.qty, 3))}</td>
              <td>${esc(r.unit_input || "")}</td>
              <td>${esc(r.supplier_name || ("#" + r.supplier_id))}</td>
              <td>${esc(r.name_raw || "")}</td>
              <td>${esc(fmtMoney(r.price_per_unit))}</td>
              <td><b>${esc(fmtMoney(r.total_price))}</b></td>
              <td><button class="btn danger" data-cart-del="${esc(r.item_id)}">Убрать</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    $$("[data-cart-del]", box).forEach(btn => {
      btn.onclick = async () => {
        const itemId = Number(btn.getAttribute("data-cart-del"));
        await clearFromCart(itemId);
      };
    });

    // totals by supplier
    const bySup = new Map();
    for (const r of cart) {
      const sid = Number(r.supplier_id);
      const sname = r.supplier_name || getSupplierName(sid);
      const prev = bySup.get(sid) || { supplier_id: sid, supplier_name: sname, items: 0, total: 0 };
      prev.items += 1;
      prev.total += Number(r.total_price) || 0;
      bySup.set(sid, prev);
    }
    const totals = Array.from(bySup.values()).sort((a, b) => b.total - a.total);
    const grand = totals.reduce((acc, x) => acc + (Number(x.total) || 0), 0);

    totalsBox.innerHTML = `
      <div class="totalsGrid">
        <table>
          <thead>
            <tr>
              <th>Итого по поставщику</th>
              <th style="width:120px;">Позиций</th>
              <th style="width:160px;">Сумма</th>
            </tr>
          </thead>
          <tbody>
            ${totals.map(t => `
              <tr>
                <td><b>${esc(t.supplier_name)}</b></td>
                <td>${esc(t.items)}</td>
                <td><b>${esc(fmtMoney(t.total))}</b></td>
              </tr>
            `).join("")}
            <tr>
              <td><b>ИТОГО</b></td>
              <td><b>${esc(cart.length)}</b></td>
              <td><b>${esc(fmtMoney(grand))}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // ---------- bind top controls ----------
  function bindStaticHandlers() {
    const createForm = $("#tenders-create-form");
    if (createForm) {
      createForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(createForm);
        const j = await apiJson("/api/tenders", { method: "POST", body: fd });
        const id = j?.project?.id;
        if (id) location.href = `/tenders/${id}`;
      };
    }

    const uploadForm = $("#tenders-upload-form");
    if (uploadForm) {
      uploadForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(uploadForm);
        const j = await apiJson("/api/tenders", { method: "POST", body: fd });
        const id = j?.project?.id;
        if (id) location.href = `/tenders/${id}`;
      };
    }

    $("#tenders-export-btn")?.addEventListener("click", async () => {
      const pid = state.project?.id;
      if (!pid) return;
      // экспорт как есть (backend уже умеет)
      const r = await fetch(`/api/tenders/${pid}/export`, { method: "POST" });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tender_${pid}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    $("#tenders-delete-btn")?.addEventListener("click", async () => {
      const pid = state.project?.id;
      if (!pid) return;
      if (!confirm(`Удалить тендер #${pid}?`)) return;
      await apiJson(`/api/tenders/${pid}`, { method: "DELETE" });
      location.href = "/tenders";
    });

    const pickSuppliersBtn = $("#tenders-pick-suppliers-btn");
    pickSuppliersBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.suppliersDropdownOpen) {
        closeSuppliersDropdown();
      } else {
        openSuppliersDropdown();
      }
    });
    $("#tenders-build-orders-btn")?.addEventListener("click", () => buildOrders());

    $("#tenders-suppliers-close")?.addEventListener("click", () => closeSuppliersDropdown());
    $("#tenders-suppliers-search")?.addEventListener("input", () => renderSuppliersDropdown());

    $("#tenders-suppliers-clear")?.addEventListener("click", () => {
      const pid = state.project?.id;
      if (!pid) return;
      saveSelectedSuppliers(pid, []).then(async () => {
        await loadMatrix(pid);
        renderProject();
      });
    });

    $("#tenders-suppliers-apply")?.addEventListener("click", async () => {
      const pid = state.project?.id;
      if (!pid) return;

      const ids = $$("input[data-supplier-id]", $("#tenders-suppliers-list"))
        .filter(i => i.checked)
        .map(i => Number(i.getAttribute("data-supplier-id")))
        .filter(Number.isFinite);

      await saveSelectedSuppliers(pid, ids);
      await loadMatrix(pid);
      closeSuppliersDropdown();
      renderProject();
    });

    $("#tenders-match-close")?.addEventListener("click", () => closeMatchModal());

    document.addEventListener("click", (e) => {
      if (!state.suppliersDropdownOpen) return;
      const dropdown = $("#tenders-suppliers-dropdown");
      const trigger = $("#tenders-pick-suppliers-btn");
      if (!dropdown || !trigger) return;
      if (dropdown.contains(e.target) || trigger.contains(e.target)) return;
      closeSuppliersDropdown();
    });
  }

  // ---------- boot ----------
  async function boot() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    bindStaticHandlers();

    const { ok, projectId } = parsePath();
    if (!ok) return;

    if (!projectId) {
      state.view = "list";
      await loadProjects();
      renderList();
      return;
    }

    state.view = "project";
    state.blocked = loadBlockedLS(projectId);

    await loadSuppliers();
    await loadProject(projectId);
    await loadSelectedSuppliers(projectId);
    await loadMatrix(projectId);

    renderProject();
  }

  boot().catch((e) => {
    console.error(e);
    const root = document.getElementById(ROOT_ID);
    if (root) {
      root.innerHTML = `<div class="card"><b>Ошибка:</b> ${esc(e.message || e)}</div>`;
    }
  });
})();
