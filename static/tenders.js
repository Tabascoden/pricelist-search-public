// static/tenders.js
(() => {
  const DEMO_MODE = window.tendersDemo === true;

  // ---------- helpers ----------
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const fmtNum = (v, digits = 2) => {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(n);
  };

  const lc = (s) => String(s ?? "").toLowerCase();

  function cmp(a, b) {
    // null-safe compare
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;

    const na = Number(a);
    const nb = Number(b);
    const aNum = Number.isFinite(na);
    const bNum = Number.isFinite(nb);
    if (aNum && bNum) return na - nb;

    return String(a).localeCompare(String(b), "ru", { sensitivity: "base" });
  }

  // ---------- DEMO DATA ----------
  const DEMO = {
    projects: [
      { id: 24, title: "Закупка на неделю", created_at: "2025-12-19T10:15:00Z", items_count: 3 },
      { id: 23, title: "Сыр/молочка", created_at: "2025-12-18T12:10:00Z", items_count: 2 },
      { id: 22, title: "Овощи/фрукты", created_at: "2025-12-17T08:30:00Z", items_count: 1 },
    ],
    projectsById: {
      24: {
        id: 24,
        title: "Закупка на неделю",
        items: [
          { id: 1, row_no: 1, name_purchase: "Томаты, 1 кг", qty: 1, unit: "кг", benchmark: null, alternatives: [] },
          { id: 2, row_no: 2, name_purchase: "Сулугуни 45%, 2 кг", qty: 2, unit: "кг", benchmark: null, alternatives: [] },
          { id: 3, row_no: 3, name_purchase: "Лук репчатый, 5 кг", qty: 5, unit: "кг", benchmark: null, alternatives: [] },
        ],
      },
      23: {
        id: 23,
        title: "Сыр/молочка",
        items: [
          { id: 10, row_no: 1, name_purchase: "Молоко 3.2%, 12 л", qty: 12, unit: "л", benchmark: null, alternatives: [] },
          { id: 11, row_no: 2, name_purchase: "Сметана 20%, 3 кг", qty: 3, unit: "кг", benchmark: null, alternatives: [] },
        ],
      },
      22: {
        id: 22,
        title: "Овощи/фрукты",
        items: [{ id: 20, row_no: 1, name_purchase: "Яблоки, 10 кг", qty: 10, unit: "кг", benchmark: null, alternatives: [] }],
      },
    },
  };

  const OFFERS_POOL = [
    { supplier: "Поставщик A", item: "Томаты сливовидные", price: 152.99, price_unit: 152.99, score: 0.42 },
    { supplier: "Поставщик B", item: "Томаты тепличные", price: 113.46, price_unit: 113.46, score: 0.38 },
    { supplier: "Поставщик B", item: "Томатная паста 70 г", price: 49.90, price_unit: 712.86, score: 0.17 },
    { supplier: "Поставщик Г", item: "Томаты розовые", price: 177.49, price_unit: 177.49, score: 0.31 },

    { supplier: "Поставщик A", item: "Сулугуни копченый", price: 124.82, price_unit: 124.82, score: 0.35 },
    { supplier: "Поставщик B", item: "Сулугуни 45%", price: 120.69, price_unit: 120.69, score: 0.44 },
    { supplier: "Поставщик Г", item: "Сулугуни 45% (палка)", price: 118.40, price_unit: 118.40, score: 0.41 },

    { supplier: "Поставщик A", item: "Лук репчатый", price: 162.27, price_unit: 32.45, score: 0.33 },
    { supplier: "Поставщик B", item: "Лук репчатый (сетка)", price: 148.00, price_unit: 29.60, score: 0.36 },
    { supplier: "Поставщик Г", item: "Лук белый", price: 190.00, price_unit: 38.00, score: 0.22 },
  ];

  function offersForQuery(query) {
    const q = lc(query).trim();
    if (!q) return [...OFFERS_POOL];

    const words = q.split(/\s+/).filter((w) => w.length >= 3);
    if (!words.length) return [...OFFERS_POOL];

    return OFFERS_POOL.filter((o) => {
      const text = lc(`${o.supplier} ${o.item}`);
      return words.some((w) => text.includes(w));
    });
  }

  function bestPerSupplier(offers) {
    const best = new Map();
    for (const o of offers) {
      const cur = best.get(o.supplier);
      if (!cur || Number(o.price_unit) < Number(cur.price_unit)) best.set(o.supplier, o);
    }
    return [...best.values()].sort((a, b) => Number(a.price_unit) - Number(b.price_unit));
  }

  // ---------- /tenders list ----------
  function initTendersPage() {
    const page = document.getElementById("tender-page");
    if (!page) return;

    const form = document.getElementById("tender-create-form");
    const input = document.getElementById("tender-title");
    const listWrap = document.getElementById("tender-projects");

    let projects = [...DEMO.projects];

    function render() {
      if (!projects.length) {
        listWrap.innerHTML = `<div class="sub">Проектов пока нет.</div>`;
        return;
      }

      let html = `<div class="tableWrap"><table>
        <tr>
          <th>ID</th>
          <th>Название</th>
          <th>Создан</th>
          <th>Позиций</th>
          <th style="width:240px;">Действия</th>
        </tr>`;

      for (const p of projects) {
        const created = p.created_at ? new Date(p.created_at).toLocaleString("ru-RU") : "";
        html += `<tr>
          <td>${esc(p.id)}</td>
          <td><b>${esc(p.title || "")}</b></td>
          <td>${esc(created)}</td>
          <td>${esc(p.items_count ?? 0)}</td>
          <td>
            <div class="tender-actions">
              <a class="btn" href="/tenders/${p.id}">Открыть</a>
              <button class="btn tender-danger" data-action="delete" data-id="${esc(p.id)}">Удалить</button>
            </div>
          </td>
        </tr>`;
      }

      html += `</table></div>
        <div style="margin-top:10px;">
          <span class="pill"><b>Демо:</b> «Удалить» сейчас удаляет строку только из UI.</span>
        </div>`;

      listWrap.innerHTML = html;

      listWrap.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.id);
          if (!Number.isFinite(id)) return;
          if (!confirm(`Удалить тендер #${id}? (демо: только из списка)`)) return;
          projects = projects.filter((x) => x.id !== id);
          render();
        });
      });
    }

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const title = (input?.value || "").trim() || "Новый тендер (демо)";
      const id = Math.max(0, ...projects.map((p) => p.id)) + 1;
      const created_at = new Date().toISOString();

      projects.unshift({ id, title, created_at, items_count: 3 });

      DEMO.projectsById[id] = {
        id,
        title,
        items: [
          { id: id * 100 + 1, row_no: 1, name_purchase: "Позиция 1 (пример)", qty: 1, unit: "шт", benchmark: null, alternatives: [] },
          { id: id * 100 + 2, row_no: 2, name_purchase: "Позиция 2 (пример)", qty: 2, unit: "шт", benchmark: null, alternatives: [] },
          { id: id * 100 + 3, row_no: 3, name_purchase: "Позиция 3 (пример)", qty: 3, unit: "шт", benchmark: null, alternatives: [] },
        ],
      };

      window.location.href = `/tenders/${id}`;
    });

    render();
  }

  // ---------- /tenders/<id> ----------
  function initTenderProjectPage() {
    const root = document.getElementById("tender-project");
    const itemsWrap = document.getElementById("tender-items");
    if (!root || !itemsWrap) return;

    const projectId = Number(root.dataset.projectId);
    if (!Number.isFinite(projectId)) return;

    const project = DEMO.projectsById[projectId] || DEMO.projectsById[24];
    const items = project.items || [];

    // buttons (visual)
    document.getElementById("tender-autopick")?.addEventListener("click", () => {
      alert("Демо: автоподбор позже подключим (сейчас только UX).");
    });
    document.getElementById("tender-export")?.addEventListener("click", () => {
      alert("Демо: экспорт позже подключим (сейчас только UX).");
    });

    // modal refs
    const modal = document.getElementById("tender-modal");
    const modalClose = document.getElementById("tender-modal-close");
    const modalTitle = document.getElementById("tender-modal-title");
    const modalSubtitle = document.getElementById("tender-modal-subtitle");
    const modalTableWrap = document.getElementById("tender-modal-table-wrap");
    const benchmarkBox = document.getElementById("tender-benchmark");
    const altBox = document.getElementById("tender-alternatives");

    const manualQ = document.getElementById("tender-manual-q");
    const basisSel = document.getElementById("tender-search-basis");
    const basisHint = document.getElementById("tender-basis-hint");
    const searchBtn = document.getElementById("tender-search-btn");
    const resetBtn = document.getElementById("tender-reset-btn");
    const modeLabel = document.getElementById("tender-search-mode");

    const openModal = () => modal?.classList.remove("hidden");
    const closeModal = () => modal?.classList.add("hidden");

    modalClose?.addEventListener("click", closeModal);
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    let currentItem = null;
    let currentOffers = [];
    let sortKey = "score";
    let sortDir = "desc"; // asc|desc

    function setBasisUI(hasBenchmark) {
      const optB = basisSel?.querySelector('option[value="benchmark"]');
      if (optB) optB.disabled = !hasBenchmark;

      if ((basisSel?.value === "benchmark") && !hasBenchmark) basisSel.value = "purchase";

      const v = basisSel?.value || "purchase";
      if (v === "benchmark") {
        basisHint.textContent = "Ищем по эталону (после выбора эталона).";
        modeLabel.textContent = "— режим: поиск по эталону";
      } else {
        basisHint.textContent = "Ищем по строке закупки (первичный подбор).";
        modeLabel.textContent = "— режим: поиск по строке закупки";
      }
    }

    function renderBenchmark(it) {
      if (!it.benchmark) {
        benchmarkBox.innerHTML = `<span class="sub">Эталон ещё не выбран.</span>`;
        return;
      }
      const b = it.benchmark;
      benchmarkBox.innerHTML = `
        <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
          <span class="badge good">Эталон</span>
          <span><b>Поставщик:</b> ${esc(b.supplier)}</span>
          <span><b>Товар:</b> ${esc(b.item)}</span>
          <span><b>Цена/ед:</b> ${esc(fmtNum(b.price_unit))} ₽</span>
          <span><b>Score:</b> ${esc(fmtNum(b.score, 2))}</span>
        </div>
      `;
    }

    function renderAlternatives(it) {
      const alts = it.alternatives || [];
      if (!alts.length) {
        altBox.textContent = "Пока пусто.";
        return;
      }

      altBox.innerHTML = `
        <div class="tableWrap"><table>
          <tr>
            <th>Поставщик</th>
            <th>Товар</th>
            <th>Цена/ед</th>
            <th>Score</th>
            <th></th>
          </tr>
          ${alts.map((a, idx) => `
            <tr>
              <td>${esc(a.supplier)}</td>
              <td>${esc(a.item)}</td>
              <td><b>${esc(fmtNum(a.price_unit))} ₽</b></td>
              <td>${esc(fmtNum(a.score, 2))}</td>
              <td><button class="btn" data-action="alt-del" data-idx="${idx}">Удалить</button></td>
            </tr>
          `).join("")}
        </table></div>
      `;

      altBox.querySelectorAll('button[data-action="alt-del"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.idx);
          if (!Number.isFinite(idx)) return;
          it.alternatives.splice(idx, 1);
          renderAlternatives(it);
          renderMainTable();
        });
      });
    }

    function sortArrow(key) {
      if (sortKey !== key) return `<span>↕</span>`;
      return sortDir === "asc" ? `<span>↑</span>` : `<span>↓</span>`;
    }

    function renderOffersTable(it) {
      const rows = [...currentOffers].sort((a, b) => {
        const v = cmp(a?.[sortKey], b?.[sortKey]);
        return sortDir === "asc" ? v : -v;
      });

      modalTableWrap.innerHTML = `
        <table class="tender-offers-table">
          <tr>
            <th class="sort-th" data-sort="supplier">Поставщик ${sortArrow("supplier")}</th>
            <th class="sort-th" data-sort="item">Товар ${sortArrow("item")}</th>
            <th class="sort-th" data-sort="price">Цена ${sortArrow("price")}</th>
            <th class="sort-th" data-sort="price_unit">Цена/ед ${sortArrow("price_unit")}</th>
            <th class="sort-th" data-sort="score">Score ${sortArrow("score")}</th>
            <th style="width:340px;"></th>
          </tr>
          ${rows.map((o, idx) => {
            const isB = it.benchmark && it.benchmark.supplier === o.supplier && it.benchmark.item === o.item;
            return `
              <tr>
                <td>${esc(o.supplier)} ${isB ? `<span class="badge good" style="margin-left:8px;">Эталон</span>` : ""}</td>
                <td>${esc(o.item)}</td>
                <td>${esc(fmtNum(o.price))}</td>
                <td><b>${esc(fmtNum(o.price_unit))}</b></td>
                <td>${esc(fmtNum(o.score, 2))}</td>
                <td style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
                  <button class="btn primary" data-action="mkb" data-idx="${idx}">Сделать эталоном</button>
                  <button class="btn" data-action="alta" data-idx="${idx}">Добавить как альтернативу</button>
                </td>
              </tr>
            `;
          }).join("")}
        </table>
      `;

      // sort handlers
      modalTableWrap.querySelectorAll(".sort-th").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.dataset.sort;
          if (!key) return;
          if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
          else {
            sortKey = key;
            sortDir = key === "score" ? "desc" : "asc";
          }
          renderOffersTable(it);
        });
      });

      // action handlers
      modalTableWrap.querySelectorAll('button[data-action="mkb"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.idx);
          const o = rows[idx];
          if (!o) return;
          it.benchmark = { ...o };
          setBasisUI(true);
          renderBenchmark(it);
          renderMainTable();
        });
      });

      modalTableWrap.querySelectorAll('button[data-action="alta"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.idx);
          const o = rows[idx];
          if (!o) return;
          it.alternatives = it.alternatives || [];
          it.alternatives.push({ ...o });
          renderAlternatives(it);
          renderMainTable();
        });
      });
    }

    function runSearch(it) {
      const manual = (manualQ?.value || "").trim();
      const basis = basisSel?.value || "purchase";

      let q = "";
      if (manual) q = manual;
      else if (basis === "benchmark" && it.benchmark) q = it.benchmark.item;
      else q = it.name_purchase;

      currentOffers = offersForQuery(q);
      sortKey = "score";
      sortDir = "desc";
      renderOffersTable(it);
    }

    function openVariants(it) {
      currentItem = it;

      modalTitle.textContent = "Варианты поставщиков";
      modalSubtitle.textContent = `Позиция: ${it.row_no}. ${it.name_purchase} · ${fmtNum(it.qty, 3)} ${it.unit}`;

      manualQ.value = "";
      setBasisUI(!!it.benchmark);
      renderBenchmark(it);
      renderAlternatives(it);

      openModal();
      runSearch(it);
    }

    function renderMainTable() {
      if (!items.length) {
        itemsWrap.innerHTML = `<div class="sub">Пока нет строк (демо).</div>`;
        return;
      }

      let html = `<div class="tableWrap"><table>
        <tr>
          <th>№</th>
          <th>Позиция закупки</th>
          <th>Кол-во</th>
          <th>Ед.</th>
          <th>Эталон: поставщик</th>
          <th>Эталон: товар</th>
          <th>Цена/ед</th>
          <th>Score</th>
          <th>Другие поставщики</th>
          <th></th>
        </tr>`;

      for (const it of items) {
        const hasB = !!it.benchmark;
        const status = hasB ? `<span class="badge good">эталон выбран</span>` : `<span class="badge warn">нет эталона</span>`;

        const compare = bestPerSupplier(offersForQuery(it.name_purchase));
        const chips = compare.slice(0, 4).map(o =>
          `<span class="tender-chip"><span>${esc(o.supplier)}</span><span class="price">${fmtNum(o.price_unit)} ₽</span></span>`
        ).join("") || `<span class="sub">пока пусто</span>`;

        html += `<tr>
          <td><b>${esc(it.row_no)}</b></td>
          <td>
            <div style="font-weight:800;">${esc(it.name_purchase)}</div>
            <div class="sub">Альтернативы: <b>${esc(it.alternatives?.length ?? 0)}</b> · Статус: ${status}</div>
          </td>
          <td>${esc(fmtNum(it.qty, 3))}</td>
          <td>${esc(it.unit)}</td>
          <td>${hasB ? esc(it.benchmark.supplier) : `<span class="sub">—</span>`}</td>
          <td>${hasB ? esc(it.benchmark.item) : `<span class="sub">не выбран</span>`}</td>
          <td>${hasB ? `<b>${esc(fmtNum(it.benchmark.price_unit))} ₽</b>` : `<span class="sub">—</span>`}</td>
          <td>${hasB ? esc(fmtNum(it.benchmark.score, 2)) : `<span class="sub">—</span>`}</td>
          <td>${chips}</td>
          <td style="text-align:right;">
            <button class="btn" data-action="variants" data-item="${esc(it.id)}">Варианты</button>
          </td>
        </tr>`;
      }

      html += `</table></div>`;
      itemsWrap.innerHTML = html;

      itemsWrap.querySelectorAll('button[data-action="variants"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.item);
          const it = items.find((x) => x.id === id);
          if (!it) return;
          openVariants(it);
        });
      });
    }

    // controls
    basisSel?.addEventListener("change", () => {
      if (!currentItem) return;
      setBasisUI(!!currentItem.benchmark);
    });
    searchBtn?.addEventListener("click", () => currentItem && runSearch(currentItem));
    resetBtn?.addEventListener("click", () => {
      if (!currentItem) return;
      manualQ.value = "";
      basisSel.value = "purchase";
      setBasisUI(!!currentItem.benchmark);
      runSearch(currentItem);
    });

    renderMainTable();
  }

  document.addEventListener("DOMContentLoaded", () => {
    // В демо-режиме мы ничего не грузим с API — только рисуем UI.
    // Инициализаторы безопасны: если страница не та — просто выйдут.
    initTendersPage();
    initTenderProjectPage();
  });
})();
