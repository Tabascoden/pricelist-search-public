// static/tenders.js
(() => {
  const ROOT_ID = "tenders-demo";
  const LS_KEY = "tendersDemoStateV3";
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
      /* UX additions for supplier comparison */
      #tenders-demo .tender-grid { overflow:auto; }
      #tenders-demo .tender-grid table { min-width: 980px; }

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

      #tenders-demo .supplierCell.picked {
        background: #ecfdf5;
        box-shadow: inset 0 0 0 2px #10b981;
      }
      #tenders-demo .supplierCell.best:not(.picked) {
        background: #f0f9ff;
        box-shadow: inset 0 0 0 2px #38bdf8;
      }

      #tenders-demo .cartBox {
        margin: 14px 0;
        padding: 12px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: #ffffff;
      }
      #tenders-demo .cartTop { display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
      #tenders-demo .cartTitle { font-weight: 900; }
      #tenders-demo .cartSub { color:#64748b; font-size: 13px; }
      #tenders-demo .cartTable { width:100%; border-collapse: collapse; margin-top: 10px; }
      #tenders-demo .cartTable th, #tenders-demo .cartTable td {
        padding: 8px 10px;
        border-bottom: 1px solid var(--border);
        font-size: 13px;
        vertical-align: top;
        text-align: left;
      }
      #tenders-demo .cartTable th { background:#f8fafc; font-size: 12px; text-transform: uppercase; color:#475569; }

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
        return {
          id: offerId++,
          supplier,
          name: name + (Math.random() > 0.7 ? ` (${hint})` : ""),
          price,
          ppu,
          score
        };
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
      // UI-only fields:
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

      // selected suppliers
      const allSuppliers = listAllSuppliers(p);
      if (!Array.isArray(p.selectedSuppliers) || !p.selectedSuppliers.length) {
        p.selectedSuppliers = allSuppliers.slice(0, 3);
      } else {
        // drop suppliers not present anymore
        p.selectedSuppliers = p.selectedSuppliers.filter((s) => allSuppliers.includes(s));
        if (!p.selectedSuppliers.length) p.selectedSuppliers = allSuppliers.slice(0, 3);
      }

      for (const it of p.items) {
        if (!it.compareOffers || typeof it.compareOffers !== "object") it.compareOffers = {};
        if (typeof it.picked !== "object") it.picked = null;

        // ensure compare offer entries exist for selected suppliers
        for (const s of p.selectedSuppliers) {
          if (!(s in it.compareOffers)) {
            it.compareOffers[s] = autoPickOfferId(it, s);
          }
        }

        // validate compare offers (score threshold)
        for (const [sup, oid] of Object.entries(it.compareOffers)) {
          if (!oid) continue;
          const off = getOffer(it, oid);
          if (!off || Number(off.score) < MIN_SCORE) it.compareOffers[sup] = null;
        }

        // validate picked
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

    html += `
          </tbody>
        </table>
      </div>
    `;
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

    if (suppliersBtn) {
      suppliersBtn.onclick = () => openSuppliersModal(project.id);
    }

    if (autopickBtn) {
      autopickBtn.onclick = () => {
        // Автоподбор: заполняем ячейки и выбираем минимум по цене/ед среди выбранных поставщиков
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

    // normalize project each render (in case suppliers changed)
    state = normalizeState(state);
    saveState(state);

    const suppliers = project.selectedSuppliers || [];
    const rows = [...project.items].sort((a, b) => (a.rowNo ?? 0) - (b.rowNo ?? 0));

    // cart summary
    const pickedRows = rows
      .map((it) => {
        if (!it.picked) return null;
        const off = getOffer(it, it.picked.offerId);
        if (!off) return null;
        const amount = (Number(it.qty) || 0) * (Number(off.ppu) || 0);
        return { it, off, amount };
      })
      .filter(Boolean);

    const total = pickedRows.reduce((s, x) => s + (x.amount || 0), 0);

    const cartHtml = `
      <div class="cartBox">
        <div class="cartTop">
          <div>
            <div class="cartTitle">Корзина</div>
            <div class="cartSub">
              Позиции: <b>${pickedRows.length}</b>
              · Итого: <b>${fmtNum(total)} ₽</b>
            </div>
          </div>
          <div class="cartSub">Нажмите ★ в ячейке поставщика, чтобы добавить строку в корзину (зелёная подсветка).</div>
        </div>
        ${
          pickedRows.length
            ? `
              <table class="cartTable">
                <thead>
                  <tr>
                    <th style="width:60px;">№</th>
                    <th>Позиция</th>
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
                      ({ it, off, amount }) => `
                        <tr>
                          <td>${esc(it.rowNo)}</td>
                          <td>${esc(it.name)}</td>
                          <td><b>${esc(off.supplier)}</b></td>
                          <td>${esc(off.name)}</td>
                          <td><b>${fmtNum(off.ppu)}</b></td>
                          <td><b>${fmtNum(amount)}</b></td>
                          <td>
                            <button class="btn" data-action="cart-remove" data-item="${it.id}" title="Убрать из корзины">✕</button>
                          </td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
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
              <th>Позиция закупки</th>
              <th style="width:90px;">Кол-во</th>
              <th style="width:70px;">Ед.</th>
              ${suppliers.map((s) => `<th class="supplierTh">${esc(s)}</th>`).join("")}
              <th style="width:200px;">Выбрано</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const it of rows) {
      // compute best ppu among visible offers to highlight
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

          ${suppliers
            .map((s) => renderSupplierCell(project, it, s, bestPpu))
            .join("")}

          <td>${pickedLabel}</td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;

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
          // нет позиции — предложим выбрать в модалке
          openOfferModal(project.id, itemId, supplier, "cart");
          return;
        }

        // toggle
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
    else if (isBest) cls.push("best");

    // If position not found or score too low — do not show the position (only actions)
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

    // reset search input
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

    // supplier filter (cell-driven UX)
    offers = offers.filter((o) => o.supplier === modalCtx.supplier);

    // score threshold
    offers = offers.filter((o) => Number(o.score) >= MIN_SCORE);

    if (q) {
      offers = offers.filter((o) => `${o.supplier} ${o.name}`.toLowerCase().includes(q));
    }

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

    const filtered = q
      ? allSuppliers.filter((s) => s.toLowerCase().includes(q))
      : allSuppliers;

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

    // bind checkboxes
    $$('input[type="checkbox"]', listEl).forEach((cb) => {
      cb.onchange = () => {
        const s = decKey(cb.dataset.supplier || "");
        if (!s) return;
        if (cb.checked) selected.add(s);
        else selected.delete(s);

        project.selectedSuppliers = Array.from(selected);
        state = normalizeState(state);
        saveState(state);

        // re-render list to keep order stable
        renderSuppliersModal();
      };
    });
  }

  function applySuppliersSelection() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !suppliersModalProjectId) return;

    const project = getProject(suppliersModalProjectId);
    if (!project) return;

    // read checked values
    const listEl = $("#tender-suppliers-list", root);
    const checked = $$('input[type="checkbox"]', listEl).filter((x) => x.checked);
    const selected = checked.map((x) => decKey(x.dataset.supplier || "")).filter(Boolean);

    project.selectedSuppliers = selected;
    state = normalizeState(state);
    saveState(state);

    closeSuppliersModal();
    renderProjectView();
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

    // close on ESC (both modals)
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;

      const offerOpen = modal && !modal.classList.contains("hidden");
      const suppOpen = sModal && !sModal.classList.contains("hidden");

      if (offerOpen) closeOfferModal();
      else if (suppOpen) closeSuppliersModal();
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
