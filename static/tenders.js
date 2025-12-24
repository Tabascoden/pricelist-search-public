// static/tenders.js
(() => {
  const ROOT_ID = "tenders-demo";
  const LS_KEY = "tendersDemoStateV4";
  const MIN_SCORE = 0.3;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const encKey = (s) => encodeURIComponent(String(s ?? ""));
  const decKey = (s) => decodeURIComponent(String(s ?? ""));

  const fmtNum = (v, digits = 2) => {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(n);
  };

  function nowISO() {
    return new Date().toISOString();
  }

  function ensureStyles() {
    if (document.getElementById("tenders-ux-styles")) return;
    const st = document.createElement("style");
    st.id = "tenders-ux-styles";
    st.textContent = `
      /* Horizontal scroll for many suppliers */
      #tenders-demo .tender-grid { overflow-x:auto; overflow-y:hidden; }
      #tenders-demo .tender-grid table {
        width: max-content;
        min-width: 100%;
      }

      #tenders-demo .supplierTh { width: 260px; }
      #tenders-demo .supplierCell {
        position: relative;
        min-width: 240px;
        max-width: 340px;
      }
      #tenders-demo .supplierCell .supName { font-weight: 700; line-height: 1.25; }
      #tenders-demo .supplierCell .supMeta { margin-top: 4px; display:flex; gap:10px; flex-wrap:wrap; align-items:baseline; }
      #tenders-demo .supplierCell .supPrice { font-weight: 800; }
      #tenders-demo .supplierCell .supScore { color:#64748b; font-size: 12px; }
      #tenders-demo .supplierCell .supEmpty { height: 18px; }

      #tenders-demo .iconRow { display:flex; gap:8px; margin-top: 8px; }
      #tenders-demo .iconBtn {
        display:inline-flex; align-items:center; justify-content:center;
        width: 30px; height: 30px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: #fff;
        cursor: pointer;
        user-select:none;
      }
      #tenders-demo .iconBtn:hover { background:#f8fafc; }
      #tenders-demo .iconBtn:disabled { opacity: .45; cursor: not-allowed; }

      /* Smart highlights */
      #tenders-demo .supplierCell.picked {
        background: #ecfdf5;
        box-shadow: inset 0 0 0 2px #10b981;
      }
      #tenders-demo .supplierCell.best:not(.picked) {
        background: #f0f9ff;
        box-shadow: inset 0 0 0 2px #38bdf8;
      }

      /* Cart */
      #tenders-demo .cartBox {
        margin: 14px 0;
        padding: 12px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: #ffffff;
      }
      #tenders-demo .cartTop { display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
      #tenders-demo .cartTitle { font-weight: 900; }
      #tenders-demo .cartSub { color:#64748b; font-size: 13px; }
      #tenders-demo .cartActions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      #tenders-demo .cartTable { width:100%; border-collapse: collapse; margin-top: 10px; }
      #tenders-demo .cartTable th, #tenders-demo .cartTable td {
        padding: 8px 10px;
        border-bottom: 1px solid var(--border);
        font-size: 13px;
        vertical-align: top;
        text-align: left;
      }
      #tenders-demo .cartTable th { background:#f8fafc; font-size: 12px; text-transform: uppercase; color:#475569; }

      /* Supplier totals mini-block */
      #tenders-demo .totalsGrid {
        margin-top: 10px;
        border: 1px solid var(--border);
        border-radius: 14px;
        overflow: hidden;
      }
      #tenders-demo .totalsGrid table { width:100%; border-collapse: collapse; }
      #tenders-demo .totalsGrid th, #tenders-demo .totalsGrid td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        font-size: 13px;
        text-align:left;
      }
      #tenders-demo .totalsGrid th { background:#f8fafc; font-size: 12px; text-transform: uppercase; color:#475569; }

      /* Suppliers modal */
      #tenders-demo .suppliersList {
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 12px;
        margin-top: 10px;
      }
      #tenders-demo .suppliersItem {
        display:flex; align-items:center; gap:10px;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 10px 12px;
        background: #fff;
      }
      #tenders-demo .suppliersItem input { transform: translateY(1px); }
      #tenders-demo .suppliersActions { display:flex; gap:10px; justify-content:flex-end; margin-top: 12px; }

      /* Orders modal blocks */
      #tenders-demo .orderBlock {
        border: 1px solid var(--border);
        border-radius: 14px;
        overflow: hidden;
        margin-top: 12px;
        background: #fff;
      }
      #tenders-demo .orderHead {
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap: 12px;
        padding: 12px;
        background: #fbfcff;
        border-bottom: 1px solid var(--border);
        flex-wrap: wrap;
      }
      #tenders-demo .orderTitle { font-weight: 900; }
      #tenders-demo .orderMeta { color:#64748b; font-size: 13px; margin-top: 2px; }
      #tenders-demo .orderBtns { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }

      @media (max-width: 900px) {
        #tenders-demo .suppliersList { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(st);
  }

  function parseRoute() {
    const p = window.location.pathname.replace(/\/+$/, "");
    const m = p.match(/^\/tenders(?:\/(\d+))?$/);
    if (!m) return { page: "other" };
    const id = m[1] ? Number(m[1]) : null;
    return { page: id ? "project" : "list", projectId: id };
  }

  function navigate(path) {
    history.pushState({}, "", path);
    render();
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch {}
    const seeded = seedState();
    saveState(seeded);
    return normalizeState(seeded);
  }

  function saveState(st) {
    localStorage.setItem(LS_KEY, JSON.stringify(st));
  }

  function seedState() {
    const suppliers = ["Поставщик A", "Поставщик B", "Поставщик C", "Поставщик Г", "Поставщик Д"];
    const goods = [
      "Томаты тепличные",
      "Помидоры сливовидные",
      "Томатная паста 25%",
      "Лук репчатый",
      "Сулугуни 45%",
      "Сыр гауда",
      "Молоко 3.2%",
      "Огурцы",
      "Перец сладкий",
      "Зелень (укроп)"
    ];

    let offerId = 1000;
    const makeOffers = (hint) => {
      const base = goods.slice().sort(() => Math.random() - 0.5);
      return base.slice(0, 12).map((name, i) => {
        const supplier = suppliers[(i + Math.floor(Math.random() * 3)) % suppliers.length];
        const price = Math.round((80 + Math.random() * 160) * 100) / 100;
        const ppu = Math.round((price / (0.8 + Math.random() * 1.6)) * 100) / 100;
        const score = Math.round((0.15 + Math.random() * 0.55) * 100) / 100;
        return { id: offerId++, supplier, name: name + (Math.random() > 0.7 ? ` (${hint})` : ""), price, ppu, score };
      });
    };

    const mkProject = (id, title, items) => ({
      id,
      title,
      created_at: nowISO(),
      selectedSuppliers: suppliers.slice(0, 3),
      items
    });

    const mkItem = (id, rowNo, name, qty, unit) => ({
      id,
      rowNo,
      name,
      qty,
      unit,
      compareOffers: {}, // supplier -> offerId|null
      picked: null,      // { supplier, offerId } | null
      offers: makeOffers(name)
    });

    return {
      lastIds: { project: 24, item: 310 },
      projects: [
        mkProject(24, "Закупка на неделю", [
          mkItem(301, 1, "Томаты", 5, "кг"),
          mkItem(302, 2, "Сулугуни", 3, "кг"),
          mkItem(303, 3, "Лук репчатый", 10, "кг"),
        ]),
        mkProject(23, "Сыр/молочка", [
          mkItem(304, 1, "Молоко", 20, "л"),
          mkItem(305, 2, "Сыр гауда", 2, "кг"),
        ]),
        mkProject(22, "Овощи/фрукты", [
          mkItem(306, 1, "Огурцы", 6, "кг"),
        ]),
      ]
    };
  }

  // --- State helpers ---
  let state = null;

  function getProject(id) {
    return state.projects.find((p) => p.id === id) || null;
  }

  function getItem(project, itemId) {
    return project.items.find((it) => it.id === itemId) || null;
  }

  function getOffer(item, offerId) {
    return item.offers.find((o) => o.id === offerId) || null;
  }

  function listAllSuppliers(project) {
    const set = new Set();
    for (const it of project.items || []) {
      for (const o of it.offers || []) set.add(o.supplier);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }

  function autoPickOfferId(item, supplier) {
    const candidates = (item.offers || [])
      .filter((o) => o.supplier === supplier && Number(o.score) >= MIN_SCORE);

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
      return (a.ppu ?? 1e9) - (b.ppu ?? 1e9);
    });

    return candidates[0].id;
  }

  function normalizeState(st) {
    st = st && typeof st === "object" ? st : seedState();
    st.projects = Array.isArray(st.projects) ? st.projects : [];

    for (const p of st.projects) {
      p.items = Array.isArray(p.items) ? p.items : [];

      const allSuppliers = listAllSuppliers(p);
      if (!Array.isArray(p.selectedSuppliers) || !p.selectedSuppliers.length) {
        p.selectedSuppliers = allSuppliers.slice(0, 3);
      } else {
        p.selectedSuppliers = p.selectedSuppliers.filter((s) => allSuppliers.includes(s));
        if (!p.selectedSuppliers.length) p.selectedSuppliers = allSuppliers.slice(0, 3);
      }

      for (const it of p.items) {
        if (!it.compareOffers || typeof it.compareOffers !== "object") it.compareOffers = {};
        if (typeof it.picked !== "object") it.picked = null;

        for (const s of p.selectedSuppliers) {
          if (!(s in it.compareOffers)) it.compareOffers[s] = autoPickOfferId(it, s);
        }

        for (const [sup, oid] of Object.entries(it.compareOffers)) {
          if (!oid) continue;
          const off = getOffer(it, oid);
          if (!off || Number(off.score) < MIN_SCORE) it.compareOffers[sup] = null;
        }

        if (it.picked && it.picked.offerId) {
          const off = getOffer(it, it.picked.offerId);
          if (!off || Number(off.score) < MIN_SCORE) it.picked = null;
        } else {
          it.picked = null;
        }
      }
    }
    return st;
  }

  // --- Views ---
  function listView(root) {
    const listWrap = $("#tender-projects", root);
    const form = $("#tender-create-form", root);
    const input = $("#tender-title", root);
    if (!listWrap || !form) return;

    const projects = [...state.projects].sort((a, b) => b.id - a.id);

    let html = `
      <div class="tender-grid">
        <table>
          <thead>
            <tr>
              <th style="width:70px;">ID</th>
              <th>Название</th>
              <th style="width:220px;">Создан</th>
              <th style="width:110px;">Позиций</th>
              <th style="width:160px;">Действия</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const p of projects) {
      const created = p.created_at ? new Date(p.created_at).toLocaleString("ru-RU") : "";
      html += `
        <tr>
          <td>${esc(p.id)}</td>
          <td><b>${esc(p.title || "")}</b></td>
          <td>${esc(created)}</td>
          <td>${esc(p.items?.length ?? 0)}</td>
          <td>
            <div class="tender-actions-col">
              <button class="btn" data-action="open" data-id="${p.id}">Открыть</button>
              <button class="btn" style="border-color:#fecaca;color:#991b1b;" data-action="delete" data-id="${p.id}">Удалить</button>
            </div>
          </td>
        </tr>
      `;
    }

    html += `</tbody></table></div>`;
    listWrap.innerHTML = html;

    $$('button[data-action="open"]', listWrap).forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.id);
        if (!Number.isFinite(id)) return;
        navigate(`/tenders/${id}`);
      };
    });

    $$('button[data-action="delete"]', listWrap).forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.id);
        if (!Number.isFinite(id)) return;
        if (!confirm(`Удалить тендер #${id}? (в демо — удалит только в UI)`)) return;
        state.projects = state.projects.filter((p) => p.id !== id);
        saveState(state);
        render();
      };
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      const title = (input?.value || "").trim() || "Тендер";
      const maxId = Math.max(0, ...state.projects.map((p) => p.id));
      const newId = maxId + 1;

      const newProject = {
        id: newId,
        title,
        created_at: nowISO(),
        selectedSuppliers: ["Поставщик A", "Поставщик B", "Поставщик C"],
        items: [
          {
            id: state.lastIds.item + 1,
            rowNo: 1,
            name: "Позиция 1 (пример)",
            qty: 1,
            unit: "шт",
            compareOffers: {},
            picked: null,
            offers: seedState().projects[0].items[0].offers
          }
        ]
      };

      state.lastIds.item += 1;
      state.lastIds.project = newId;
      state.projects.unshift(newProject);
      state = normalizeState(state);
      saveState(state);

      navigate(`/tenders/${newId}`);
    };
  }

  function projectView(root, projectId) {
    const backBtn = $("#tender-back", root);
    const titleEl = $("#tender-project-title", root);
    const itemsWrap = $("#tender-items", root);

    const uploadBtn = $("#tender-upload-btn", root);
    const suppliersBtn = $("#tender-suppliers-btn", root);
    const autopickBtn = $("#tender-autopick", root);
    const exportBtn = $("#tender-export", root);

    const project = getProject(projectId);

    if (!project) {
      if (titleEl) titleEl.textContent = `Тендер #${projectId} (не найден)`;
      if (itemsWrap) itemsWrap.innerHTML = `<div class="sub">Нет такого проекта в демо-данных.</div>`;
      return;
    }

    if (titleEl) titleEl.textContent = `Тендер #${project.id} — ${project.title || "Тендер"}`;

    if (backBtn) backBtn.onclick = () => navigate("/tenders");
    if (uploadBtn) uploadBtn.onclick = () => alert("Демо: загрузка XLSX будет подключена позже.");
    if (exportBtn) exportBtn.onclick = () => exportCSV(project);

    if (suppliersBtn) suppliersBtn.onclick = () => openSuppliersModal(project.id);

    if (autopickBtn) {
      autopickBtn.onclick = () => {
        for (const it of project.items) {
          for (const s of project.selectedSuppliers) {
            if (!(s in it.compareOffers)) it.compareOffers[s] = autoPickOfferId(it, s);
            if (!it.compareOffers[s]) it.compareOffers[s] = autoPickOfferId(it, s);
          }
          let best = null;
          for (const s of project.selectedSuppliers) {
            const oid = it.compareOffers[s];
            const off = oid ? getOffer(it, oid) : null;
            if (!off) continue;
            if (!best || (off.ppu ?? 1e9) < (best.ppu ?? 1e9)) best = off;
          }
          it.picked = best ? { supplier: best.supplier, offerId: best.id } : null;
        }
        saveState(state);
        renderProjectView();
        alert("Автоподбор выполнен: заполнили сравнение и выбрали минимальную цену/ед в корзину.");
      };
    }

    renderProjectView();
  }

  function buildCart(project) {
    const rows = [...project.items].sort((a, b) => (a.rowNo ?? 0) - (b.rowNo ?? 0));

    const pickedRows = rows
      .map((it) => {
        if (!it.picked) return null;
        const off = getOffer(it, it.picked.offerId);
        if (!off) return null;
        const qty = Number(it.qty) || 0;
        const ppu = Number(off.ppu) || 0;
        const amount = qty * ppu;
        return { it, off, qty, ppu, amount };
      })
      .filter(Boolean);

    const bySupplier = new Map();
    for (const x of pickedRows) {
      const key = x.off.supplier;
      if (!bySupplier.has(key)) bySupplier.set(key, { supplier: key, lines: [], total: 0 });
      const bucket = bySupplier.get(key);
      bucket.lines.push(x);
      bucket.total += x.amount || 0;
    }

    const total = pickedRows.reduce((s, x) => s + (x.amount || 0), 0);

    return { pickedRows, bySupplier, total };
  }

  function renderSupplierTotals(bySupplier, total) {
    const suppliers = Array.from(bySupplier.values());
    if (suppliers.length <= 1) return "";

    return `
      <div class="totalsGrid">
        <table>
          <thead>
            <tr>
              <th>Поставщик</th>
              <th style="width:120px;">Позиций</th>
              <th style="width:140px;">Итого</th>
            </tr>
          </thead>
          <tbody>
            ${suppliers
              .sort((a, b) => b.total - a.total)
              .map(
                (s) => `
                  <tr>
                    <td><b>${esc(s.supplier)}</b></td>
                    <td>${esc(s.lines.length)}</td>
                    <td><b>${fmtNum(s.total)} ₽</b></td>
                  </tr>
                `
              )
              .join("")}
            <tr>
              <td><b>ИТОГО</b></td>
              <td>${esc(suppliers.reduce((n, s) => n + s.lines.length, 0))}</td>
              <td><b>${fmtNum(total)} ₽</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  function renderProjectView() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const route = parseRoute();
    if (route.page !== "project") return;

    const project = getProject(route.projectId);
    const itemsWrap = $("#tender-items", root);
    if (!itemsWrap) return;

    if (!project) {
      itemsWrap.innerHTML = `<div class="sub">Проект не найден.</div>`;
      return;
    }

    state = normalizeState(state);
    saveState(state);

    const suppliers = project.selectedSuppliers || [];
    const rows = [...project.items].sort((a, b) => (a.rowNo ?? 0) - (b.rowNo ?? 0));

    const { pickedRows, bySupplier, total } = buildCart(project);

    const cartHtml = `
      <div class="cartBox">
        <div class="cartTop">
          <div>
            <div class="cartTitle">Корзина</div>
            <div class="cartSub">
              Позиции: <b>${pickedRows.length}</b>
              · Итого: <b>${fmtNum(total)} ₽</b>
            </div>
            <div class="cartSub">★ — выбрать поставщика для строки (ячейка зелёная). Голубая — минимальная цена по строке (если не выбрана).</div>
          </div>

          <div class="cartActions">
            <button class="btn primary" id="tender-build-orders" ${pickedRows.length ? "" : "disabled"}>Собрать заказ(ы)</button>
          </div>
        </div>

        ${
          pickedRows.length
            ? `
              <table class="cartTable">
                <thead>
                  <tr>
                    <th style="width:60px;">№</th>
                    <th>Позиция</th>
                    <th style="width:120px;">Кол-во</th>
                    <th style="width:160px;">Поставщик</th>
                    <th>Товар</th>
                    <th style="width:110px;">Цена/ед</th>
                    <th style="width:110px;">Сумма</th>
                    <th style="width:60px;"></th>
                  </tr>
                </thead>
                <tbody>
                  ${pickedRows
                    .map(
                      ({ it, off, qty, amount }) => `
                        <tr>
                          <td>${esc(it.rowNo)}</td>
                          <td>${esc(it.name)}</td>
                          <td><b>${fmtNum(qty, 3)}</b> ${esc(it.unit || "")}</td>
                          <td><b>${esc(off.supplier)}</b></td>
                          <td>${esc(off.name)}</td>
                          <td><b>${fmtNum(off.ppu)} ₽</b></td>
                          <td><b>${fmtNum(amount)} ₽</b></td>
                          <td>
                            <button class="btn" data-action="cart-remove" data-item="${it.id}" title="Убрать из корзины">✕</button>
                          </td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>

              ${renderSupplierTotals(bySupplier, total)}
            `
            : `<div class="sub" style="margin-top:10px;">Корзина пустая — выберите позиции, нажав ★.</div>`
        }
      </div>
    `;

    // main comparison table
    let html = `${cartHtml}
      <div class="tender-grid">
        <table>
          <thead>
            <tr>
              <th style="width:50px;">№</th>
              <th style="min-width:260px;">Позиция закупки</th>
              <th style="width:90px;">Кол-во</th>
              <th style="width:70px;">Ед.</th>
              ${suppliers.map((s) => `<th class="supplierTh">${esc(s)}</th>`).join("")}
              <th style="width:200px;">Выбрано</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const it of rows) {
      // visible offers in selected suppliers (score >= MIN_SCORE)
      const visible = suppliers
        .map((s) => {
          const oid = it.compareOffers?.[s] ?? null;
          const off = oid ? getOffer(it, oid) : null;
          if (!off || Number(off.score) < MIN_SCORE) return null;
          return off;
        })
        .filter(Boolean);

      const bestPpu = visible.length ? Math.min(...visible.map((o) => Number(o.ppu) || 1e9)) : null;

      const pickedOff = it.picked ? getOffer(it, it.picked.offerId) : null;
      const pickedLabel = pickedOff
        ? `
          <div><b>${esc(pickedOff.supplier)}</b></div>
          <div class="sub">${esc(pickedOff.name)}</div>
          <div style="margin-top:4px;"><b>${fmtNum(pickedOff.ppu)} ₽/ед</b></div>
        `
        : `<span class="sub">не выбрано</span>`;

      html += `
        <tr>
          <td>${esc(it.rowNo)}</td>
          <td><b>${esc(it.name)}</b></td>
          <td>${esc(fmtNum(it.qty, 3))}</td>
          <td>${esc(it.unit)}</td>

          ${suppliers.map((s) => renderSupplierCell(project, it, s, bestPpu)).join("")}

          <td>${pickedLabel}</td>
        </tr>
      `;
    }

    html += `</tbody></table></div>`;
    itemsWrap.innerHTML = html;

    // bind cart remove
    $$('button[data-action="cart-remove"]', itemsWrap).forEach((btn) => {
      btn.onclick = () => {
        const itemId = Number(btn.dataset.item);
        const it = getItem(project, itemId);
        if (!it) return;
        it.picked = null;
        saveState(state);
        renderProjectView();
      };
    });

    // build orders button
    const buildBtn = $("#tender-build-orders", itemsWrap);
    if (buildBtn) {
      buildBtn.onclick = () => openOrdersModal(project.id);
    }

    // bind cell actions
    $$('button[data-action="cell-remove"]', itemsWrap).forEach((btn) => {
      btn.onclick = () => {
        const itemId = Number(btn.dataset.item);
        const supplier = decKey(btn.dataset.supplier || "");
        const it = getItem(project, itemId);
        if (!it) return;

        const oid = it.compareOffers?.[supplier] ?? null;
        it.compareOffers[supplier] = null;

        if (it.picked && oid && it.picked.offerId === oid) it.picked = null;

        saveState(state);
        renderProjectView();
      };
    });

    $$('button[data-action="cell-search"]', itemsWrap).forEach((btn) => {
      btn.onclick = () => {
        const itemId = Number(btn.dataset.item);
        const supplier = decKey(btn.dataset.supplier || "");
        openOfferModal(project.id, itemId, supplier, "cell");
      };
    });

    $$('button[data-action="cell-pick"]', itemsWrap).forEach((btn) => {
      btn.onclick = () => {
        const itemId = Number(btn.dataset.item);
        const supplier = decKey(btn.dataset.supplier || "");
        const it = getItem(project, itemId);
        if (!it) return;

        const oid = it.compareOffers?.[supplier] ?? null;
        const off = oid ? getOffer(it, oid) : null;

        if (!off) {
          openOfferModal(project.id, itemId, supplier, "cart");
          return;
        }

        const isPicked = it.picked && it.picked.offerId === off.id && it.picked.supplier === supplier;
        it.picked = isPicked ? null : { supplier, offerId: off.id };
        saveState(state);
        renderProjectView();
      };
    });
  }

  function renderSupplierCell(project, it, supplier, bestPpu) {
    const oid = it.compareOffers?.[supplier] ?? null;
    const off = oid ? getOffer(it, oid) : null;

    const valid = off && Number(off.score) >= MIN_SCORE;
    const isPicked = valid && it.picked && it.picked.offerId === off.id && it.picked.supplier === supplier;
    const isBest = valid && bestPpu !== null && Number(off.ppu) === Number(bestPpu);

    const cls = ["supplierCell"];
    if (isPicked) cls.push("picked");
    if (isBest) cls.push("best");

    const body = valid
      ? `
        <div class="supName">${esc(off.name)}</div>
        <div class="supMeta">
          <div class="supPrice">${fmtNum(off.ppu)} ₽/ед</div>
          <div class="supScore">score ${fmtNum(off.score, 2)}</div>
        </div>
      `
      : `<div class="supEmpty"></div>`;

    return `
      <td class="${cls.join(" ")}">
        ${body}
        <div class="iconRow">
          <button class="iconBtn" title="Удалить позицию из ячейки" data-action="cell-remove" data-item="${it.id}" data-supplier="${encKey(supplier)}" ${valid ? "" : "disabled"}>✕</button>
          <button class="iconBtn" title="Найти / выбрать позицию" data-action="cell-search" data-item="${it.id}" data-supplier="${encKey(supplier)}">🔍</button>
          <button class="iconBtn" title="Выбрать в корзину" data-action="cell-pick" data-item="${it.id}" data-supplier="${encKey(supplier)}">★</button>
        </div>
      </td>
    `;
  }

  // --- Offer selection modal ---
  let modalCtx = null; // { projectId, itemId, supplier, openedFor }

  function openOfferModal(projectId, itemId, supplier, openedFor = "cell") {
    modalCtx = { projectId, itemId, supplier, openedFor };

    const root = document.getElementById(ROOT_ID);
    const modal = $("#tender-modal", root);
    if (!modal) return;

    const q = $("#tender-search-manual", root);
    if (q) q.value = "";

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    renderOfferModal();
  }

  function closeOfferModal() {
    const root = document.getElementById(ROOT_ID);
    const modal = $("#tender-modal", root);
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    modalCtx = null;
  }

  function renderOfferModal() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !modalCtx) return;

    const project = getProject(modalCtx.projectId);
    if (!project) return;

    const item = getItem(project, modalCtx.itemId);
    if (!item) return;

    const subtitle = $("#tender-modal-subtitle", root);
    const supplierLine = $("#tender-modal-supplier", root);
    const tbody = $("#tender-offers-body", root);

    if (subtitle) subtitle.textContent = `Позиция: ${item.rowNo}. ${item.name} · ${fmtNum(item.qty, 3)} ${item.unit}`;
    if (supplierLine) supplierLine.textContent = `Поставщик: ${modalCtx.supplier}`;

    const manual = $("#tender-search-manual", root);
    const q = (manual?.value || "").trim().toLowerCase();

    let offers = [...(item.offers || [])];

    offers = offers.filter((o) => o.supplier === modalCtx.supplier);
    offers = offers.filter((o) => Number(o.score) >= MIN_SCORE);

    if (q) offers = offers.filter((o) => `${o.supplier} ${o.name}`.toLowerCase().includes(q));

    offers.sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
      return (a.ppu ?? 1e9) - (b.ppu ?? 1e9);
    });

    if (!tbody) return;

    if (!offers.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="sub">Ничего не найдено (или score &lt; ${MIN_SCORE}). Попробуйте другой запрос.</td></tr>`;
      return;
    }

    const pickedId = item.picked?.offerId ?? null;

    tbody.innerHTML = offers
      .map((o) => {
        const isPicked = pickedId === o.id;
        return `
          <tr>
            <td>${esc(o.supplier)}</td>
            <td>${esc(o.name)}${isPicked ? ` <span class="tag" style="margin-left:6px;background:#dcfce7;color:#166534;">В корзине</span>` : ""}</td>
            <td><b>${fmtNum(o.ppu)}</b></td>
            <td>${fmtNum(o.score, 2)}</td>
            <td style="white-space:nowrap;">
              <button class="btn" data-action="modal-choose" data-oid="${o.id}">Выбрать</button>
              <button class="btn primary" data-action="modal-pick" data-oid="${o.id}" ${isPicked ? "disabled" : ""}>★ В корзину</button>
            </td>
          </tr>
        `;
      })
      .join("");

    $$('button[data-action="modal-choose"]', tbody).forEach((btn) => {
      btn.onclick = () => {
        const oid = Number(btn.dataset.oid);
        const off = getOffer(item, oid);
        if (!off) return;

        item.compareOffers[off.supplier] = off.id;
        saveState(state);
        renderProjectView();
        closeOfferModal();
      };
    });

    $$('button[data-action="modal-pick"]', tbody).forEach((btn) => {
      btn.onclick = () => {
        const oid = Number(btn.dataset.oid);
        const off = getOffer(item, oid);
        if (!off) return;

        item.compareOffers[off.supplier] = off.id;
        item.picked = { supplier: off.supplier, offerId: off.id };

        saveState(state);
        renderProjectView();
        closeOfferModal();
      };
    });
  }

  // --- Suppliers modal ---
  let suppliersModalProjectId = null;

  function openSuppliersModal(projectId) {
    suppliersModalProjectId = projectId;

    const root = document.getElementById(ROOT_ID);
    const modal = $("#tender-suppliers-modal", root);
    if (!modal) return;

    const search = $("#tender-suppliers-search", root);
    if (search) search.value = "";

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    renderSuppliersModal();
  }

  function closeSuppliersModal() {
    const root = document.getElementById(ROOT_ID);
    const modal = $("#tender-suppliers-modal", root);
    if (!modal) return;

    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    suppliersModalProjectId = null;
  }

  function renderSuppliersModal() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !suppliersModalProjectId) return;

    const project = getProject(suppliersModalProjectId);
    if (!project) return;

    const listEl = $("#tender-suppliers-list", root);
    const search = $("#tender-suppliers-search", root);
    const q = (search?.value || "").trim().toLowerCase();

    const allSuppliers = listAllSuppliers(project);
    const selected = new Set(project.selectedSuppliers || []);

    const filtered = q ? allSuppliers.filter((s) => s.toLowerCase().includes(q)) : allSuppliers;

    if (!listEl) return;

    listEl.innerHTML = filtered
      .map((s) => {
        const checked = selected.has(s);
        return `
          <label class="suppliersItem">
            <input type="checkbox" data-supplier="${encKey(s)}" ${checked ? "checked" : ""}>
            <span>${esc(s)}</span>
          </label>
        `;
      })
      .join("");

    $$('input[type="checkbox"]', listEl).forEach((cb) => {
      cb.onchange = () => {
        const s = decKey(cb.dataset.supplier || "");
        if (!s) return;
        if (cb.checked) selected.add(s);
        else selected.delete(s);

        project.selectedSuppliers = Array.from(selected);
        state = normalizeState(state);
        saveState(state);
        renderSuppliersModal();
      };
    });
  }

  function applySuppliersSelection() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !suppliersModalProjectId) return;

    const project = getProject(suppliersModalProjectId);
    if (!project) return;

    const listEl = $("#tender-suppliers-list", root);
    const checked = $$('input[type="checkbox"]', listEl).filter((x) => x.checked);
    const selected = checked.map((x) => decKey(x.dataset.supplier || "")).filter(Boolean);

    project.selectedSuppliers = selected;
    state = normalizeState(state);
    saveState(state);

    closeSuppliersModal();
    renderProjectView();
  }

  // --- Orders modal (assemble per supplier) ---
  let ordersModalProjectId = null;

  function ensureOrdersModalExists() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    if ($("#tender-orders-modal", root)) return;

    // If template wasn't updated, inject modal markup dynamically
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="tender-modal hidden" id="tender-orders-modal" aria-hidden="true">
        <div class="tender-modal-body" role="dialog" aria-modal="true">
          <div class="tender-modal-header">
            <div>
              <div class="h3">Собранные заказы</div>
              <div class="sub" id="tender-orders-subtitle">Один заказ на каждого поставщика из корзины.</div>
            </div>
            <button class="btn" id="tender-orders-close">Закрыть</button>
          </div>
          <div id="tender-orders-body" class="sub">Загрузка…</div>
        </div>
      </div>
    `;
    root.appendChild(wrap.firstElementChild);
  }

  function openOrdersModal(projectId) {
    ensureOrdersModalExists();
    ordersModalProjectId = projectId;

    const root = document.getElementById(ROOT_ID);
    const modal = $("#tender-orders-modal", root);
    if (!modal) return;

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    renderOrdersModal();
  }

  function closeOrdersModal() {
    const root = document.getElementById(ROOT_ID);
    const modal = $("#tender-orders-modal", root);
    if (!modal) return;

    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    ordersModalProjectId = null;
  }

  function ordersTextForSupplier(bucket) {
    const lines = bucket.lines
      .sort((a, b) => (a.it.rowNo ?? 0) - (b.it.rowNo ?? 0))
      .map((x) => {
        const q = `${fmtNum(x.qty, 3)} ${x.it.unit || ""}`.trim();
        return `${x.it.rowNo}. ${x.it.name} — ${q} — ${x.off.name} — ${fmtNum(x.off.ppu)} ₽/ед — ${fmtNum(x.amount)} ₽`;
      });

    return [
      `Поставщик: ${bucket.supplier}`,
      `Позиций: ${bucket.lines.length}`,
      `Итого: ${fmtNum(bucket.total)} ₽`,
      ``,
      ...lines
    ].join("\n");
  }

  function downloadSupplierCSV(project, supplier, bucket) {
    const header = [
      "row_no",
      "purchase_name",
      "qty",
      "unit",
      "supplier_item_name",
      "price_per_unit",
      "score",
      "amount"
    ];

    const lines = [header.join(",")];

    for (const x of bucket.lines.sort((a, b) => (a.it.rowNo ?? 0) - (b.it.rowNo ?? 0))) {
      const row = [
        x.it.rowNo ?? "",
        `"${String(x.it.name ?? "").replaceAll('"', '""')}"`,
        x.qty ?? "",
        `"${String(x.it.unit ?? "").replaceAll('"', '""')}"`,
        `"${String(x.off.name ?? "").replaceAll('"', '""')}"`,
        x.off.ppu ?? "",
        x.off.score ?? "",
        x.amount ?? ""
      ];
      lines.push(row.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tender_${project.id}_order_${supplier.replaceAll(" ", "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return true;
      } catch {
        return false;
      }
    }
  }

  function renderOrdersModal() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !ordersModalProjectId) return;

    const project = getProject(ordersModalProjectId);
    if (!project) return;

    const body = $("#tender-orders-body", root);
    if (!body) return;

    const { pickedRows, bySupplier, total } = buildCart(project);
    const suppliers = Array.from(bySupplier.values()).sort((a, b) => b.total - a.total);

    if (!pickedRows.length) {
      body.innerHTML = `<div class="sub">Корзина пустая — нечего собирать.</div>`;
      return;
    }

    body.innerHTML = `
      <div class="cartSub">Всего: <b>${pickedRows.length}</b> позиций · Итого: <b>${fmtNum(total)} ₽</b></div>

      ${suppliers
        .map((bucket) => {
          return `
            <div class="orderBlock">
              <div class="orderHead">
                <div>
                  <div class="orderTitle">${esc(bucket.supplier)}</div>
                  <div class="orderMeta">Позиций: <b>${bucket.lines.length}</b> · Итого: <b>${fmtNum(bucket.total)} ₽</b></div>
                </div>
                <div class="orderBtns">
                  <button class="btn" data-action="order-copy" data-supplier="${encKey(bucket.supplier)}">Копировать</button>
                  <button class="btn primary" data-action="order-csv" data-supplier="${encKey(bucket.supplier)}">Скачать CSV</button>
                </div>
              </div>

              <table class="cartTable">
                <thead>
                  <tr>
                    <th style="width:60px;">№</th>
                    <th>Позиция</th>
                    <th style="width:120px;">Кол-во</th>
                    <th>Товар</th>
                    <th style="width:110px;">Цена/ед</th>
                    <th style="width:110px;">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  ${bucket.lines
                    .sort((a, b) => (a.it.rowNo ?? 0) - (b.it.rowNo ?? 0))
                    .map(
                      (x) => `
                        <tr>
                          <td>${esc(x.it.rowNo)}</td>
                          <td>${esc(x.it.name)}</td>
                          <td><b>${fmtNum(x.qty, 3)}</b> ${esc(x.it.unit || "")}</td>
                          <td>${esc(x.off.name)}</td>
                          <td><b>${fmtNum(x.off.ppu)} ₽</b></td>
                          <td><b>${fmtNum(x.amount)} ₽</b></td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `;
        })
        .join("")}
    `;

    // bind actions
    $$('button[data-action="order-copy"]', body).forEach((btn) => {
      btn.onclick = async () => {
        const supplier = decKey(btn.dataset.supplier || "");
        const bucket = suppliers.find((x) => x.supplier === supplier);
        if (!bucket) return;
        const ok = await copyToClipboard(ordersTextForSupplier(bucket));
        alert(ok ? "Скопировано в буфер обмена." : "Не удалось скопировать.");
      };
    });

    $$('button[data-action="order-csv"]', body).forEach((btn) => {
      btn.onclick = () => {
        const supplier = decKey(btn.dataset.supplier || "");
        const bucket = suppliers.find((x) => x.supplier === supplier);
        if (!bucket) return;
        downloadSupplierCSV(project, supplier, bucket);
      };
    });
  }

  function exportCSV(project) {
    const header = [
      "row_no",
      "purchase_name",
      "qty",
      "unit",
      "chosen_supplier",
      "supplier_item_name",
      "price_per_unit",
      "score",
      "amount"
    ];

    const lines = [header.join(",")];

    for (const it of project.items) {
      const picked = it.picked ? getOffer(it, it.picked.offerId) : null;
      const amount = picked ? (Number(it.qty) || 0) * (Number(picked.ppu) || 0) : 0;

      const row = [
        it.rowNo ?? "",
        `"${String(it.name ?? "").replaceAll('"', '""')}"`,
        it.qty ?? "",
        `"${String(it.unit ?? "").replaceAll('"', '""')}"`,
        picked ? `"${String(picked.supplier).replaceAll('"', '""')}"` : "",
        picked ? `"${String(picked.name).replaceAll('"', '""')}"` : "",
        picked ? picked.ppu : "",
        picked ? picked.score : "",
        picked ? amount : ""
      ];

      lines.push(row.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tender_${project.id}_cart_demo.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function bindModalUI() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    // offer modal
    const modal = $("#tender-modal", root);
    const closeBtn = $("#tender-modal-close", root);
    const searchBtn = $("#tender-search-btn", root);
    const resetBtn = $("#tender-search-reset", root);

    closeBtn && (closeBtn.onclick = closeOfferModal);
    modal &&
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeOfferModal();
      });

    searchBtn && (searchBtn.onclick = () => renderOfferModal());
    resetBtn &&
      (resetBtn.onclick = () => {
        const manual = $("#tender-search-manual", root);
        if (manual) manual.value = "";
        renderOfferModal();
      });

    // suppliers modal
    const sModal = $("#tender-suppliers-modal", root);
    const sClose = $("#tender-suppliers-close", root);
    const sApply = $("#tender-suppliers-apply", root);
    const sSearch = $("#tender-suppliers-search", root);

    sClose && (sClose.onclick = closeSuppliersModal);
    sApply && (sApply.onclick = applySuppliersSelection);
    sSearch && (sSearch.oninput = () => renderSuppliersModal());

    sModal &&
      sModal.addEventListener("click", (e) => {
        if (e.target === sModal) closeSuppliersModal();
      });

    // orders modal (may be injected later)
    ensureOrdersModalExists();
    const oModal = $("#tender-orders-modal", root);
    const oClose = $("#tender-orders-close", root);

    oClose && (oClose.onclick = closeOrdersModal);
    oModal &&
      oModal.addEventListener("click", (e) => {
        if (e.target === oModal) closeOrdersModal();
      });

    // close on ESC (all)
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;

      const offerOpen = modal && !modal.classList.contains("hidden");
      const suppOpen = sModal && !sModal.classList.contains("hidden");
      const ordOpen = oModal && !oModal.classList.contains("hidden");

      if (offerOpen) closeOfferModal();
      else if (suppOpen) closeSuppliersModal();
      else if (ordOpen) closeOrdersModal();
    });
  }

  function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    ensureStyles();

    const route = parseRoute();
    if (route.page === "other") return;

    const listBox = $("#tenders-view-list", root);
    const projectBox = $("#tenders-view-project", root);
    const createForm = $("#tender-create-form", root);

    if (!state) state = loadState();

    if (route.page === "list") {
      listBox?.classList.remove("hidden");
      projectBox?.classList.add("hidden");
      createForm?.classList.remove("hidden");
      listView(root);
    } else if (route.page === "project") {
      listBox?.classList.add("hidden");
      projectBox?.classList.remove("hidden");
      createForm?.classList.add("hidden");
      projectView(root, route.projectId);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    state = loadState();
    ensureStyles();
    bindModalUI();
    render();

    window.addEventListener("popstate", () => render());
  });
})();
