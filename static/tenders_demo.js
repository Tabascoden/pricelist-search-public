// static/tenders.js
(() => {
  // ===== DEMO DATA (no API) =====
  const DEMO = {
    projects: [
      { id: 24, title: "Закупка на неделю", created_at: "2025-12-19T10:15:00Z", items_count: 8 },
      { id: 23, title: "Сыр/молочка", created_at: "2025-12-18T12:10:00Z", items_count: 5 },
      { id: 22, title: "Овощи/фрукты", created_at: "2025-12-17T08:30:00Z", items_count: 12 },
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
        items: [
          { id: 20, row_no: 1, name_purchase: "Яблоки, 10 кг", qty: 10, unit: "кг", benchmark: null, alternatives: [] },
        ],
      },
    },
  };

  // offers pool (same pool reused; filtering imitates "search")
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

  // ===== Helpers =====
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

  function byKeyAsc(a, b, key) {
    const va = a?.[key];
    const vb = b?.[key];

    // numeric?
    const na = Number(va);
    const nb = Number(vb);
    const aNum = Number.isFinite(na);
    const bNum = Number.isFinite(nb);
    if (aNum && bNum) return na - nb;

    return String(va ?? "").localeCompare(String(vb ?? ""), "ru", { sensitivity: "base" });
  }

  // ===== /tenders page (list) =====
  async function initTendersPage() {
    const root = document.getElementById("tender-page");
    if (!root) return;

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
          <td>
            <div style="font-weight:800;">${esc(p.title || "")}</div>
            <div class="sub">Демо: удалить/открыть (без БД)</div>
          </td>
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
        <span class="pill"><b>Важно:</b> «Удалить» сейчас только прячет проект в UI (демо).</span>
      </div>`;
      listWrap.innerHTML = html;

      listWrap.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.id);
          if (!Number.isFinite(id)) return;
          if (!confirm(`Удалить тендер #${id}? (демо: только удалит строку из списка)`)) return;
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

      // also create demo project shell
      DEMO.projectsById[id] = {
        id,
        title,
        items: [
          { id: 100 + id * 10 + 1, row_no: 1, name_purchase: "Позиция 1 (пример)", qty: 1, unit: "шт", benchmark: null, alternatives: [] },
          { id: 100 + id * 10 + 2, row_no: 2, name_purchase: "Позиция 2 (пример)", qty: 2, unit: "шт", benchmark: null, alternatives: [] },
          { id: 100 + id * 10 + 3, row_no: 3, name_purchase: "Позиция 3 (пример)", qty: 3, unit: "шт", benchmark: null, alternatives: [] },
        ],
      };

      window.location.href = `/tenders/${id}`;
    });

    render();
  }

  // ===== /tenders/<id> page (project) =====
  async function initTenderProjectPage() {
    const root = document.getElementById("tender-project");
    const itemsWrap = document.getElementById("tender-items");
    const aboutWrap = document.getElementById("tender-about");
    if (!root || !itemsWrap) return;

    const projectId = Number(root.dataset.projectId);
    if (!Number.isFinite(projectId)) return;

    // tabs
    const tabs = root.querySelectorAll(".tab");
    tabs.forEach((t) =>
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        const tab = t.dataset.tab;
        if (tab === "about") {
          itemsWrap.classList.add("hidden");
          aboutWrap?.classList.remove("hidden");
        } else {
          aboutWrap?.classList.add("hidden");
          itemsWrap.classList.remove("hidden");
        }
      })
    );

    // controls (visual only)
    const btnAutopick = document.getElementById("tender-autopick");
    const btnExport = document.getElementById("tender-export");
    btnAutopick?.addEventListener("click", () => alert("Демо: автоподбор позже подключим к SQL."));
    btnExport?.addEventListener("click", () => alert("Демо: экспорт позже подключим к API."));

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

    // state
    const project = DEMO.projectsById[projectId] || DEMO.projectsById[24];
    const items = project.items;

    let currentItem = null;
    let currentOffers = [];
    let sortKey = "score";
    let sortDir = "desc"; // asc|desc

    function setBasisUI(hasBenchmark) {
      // "по эталону" доступно только если эталон выбран
      const optBenchmark = basisSel?.querySelector('option[value="benchmark"]');
      if (optBenchmark) optBenchmark.disabled = !hasBenchmark;

      const v = basisSel?.value || "purchase";
      if (v === "benchmark" && !hasBenchmark) basisSel.value = "purchase";

      const actual = basisSel?.value || "purchase";
      if (actual === "benchmark") {
        basisHint.textContent = "Ищем по эталону (после выбора эталона).";
        modeLabel.textContent = "— режим: поиск по эталону";
      } else {
        basisHint.textContent = "Ищем по строке закупки (первичный подбор альтернатив).";
        modeLabel.textContent = "— режим: поиск по строке закупки";
      }
    }

    function offersForQuery(query) {
      const q = lc(query);
      if (!q) return [...OFFERS_POOL];

      // demo heuristic filter: contains any word >=3
      const words = q.split(/\s+/).filter((w) => w.length >= 3);
      if (!words.length) return [...OFFERS_POOL];

      return OFFERS_POOL.filter((o) => {
        const text = lc(`${o.supplier} ${o.item}`);
        return words.some((w) => text.includes(w));
      });
    }

    function computeSupplierCompare(offers) {
      // take best price_unit per supplier (demo)
      const best = new Map();
      for (const o of offers) {
        const cur = best.get(o.supplier);
        if (!cur || (Number(o.price_unit) < Number(cur.price_unit))) best.set(o.supplier, o);
      }
      return [...best.values()].sort((a, b) => Number(a.price_unit) - Number(b.price_unit));
    }

    function renderMainTable() {
      if (!items.length) {
        itemsWrap.innerHTML = `<div class="sub">Пока нет строк. Позже подключим загрузку XLSX.</div>`;
        return;
      }

      let html = `
        <div class="tableWrap" style="overflow:auto;">
          <div class="tender-grid-head">
            <div>№</div>
            <div>Позиция закупки</div>
            <div>Кол-во</div>
            <div>Ед.</div>
            <div>Эталон: поставщик</div>
            <div>Эталон: товар</div>
            <div>Цена/ед</div>
            <div>Score</div>
            <div>Другие поставщики</div>
            <div></div>
          </div>
      `;

      for (const it of items) {
        const hasB = !!it.benchmark;
        const status = hasB
          ? `<span class="badge good">эталон выбран</span>`
          : `<span class="badge warn">нет эталона</span>`;

        const compareOffers = computeSupplierCompare(offersForQuery(it.name_purchase));
        const compareChips = compareOffers
          .slice(0, 4)
          .map(
            (o) => `<span class="tender-chip"><span>${esc(o.supplier)}</span><span class="price">${fmtNum(o.price_unit)} ₽</span></span>`
          )
          .join("") || `<span class="tender-cell-muted">пока пусто</span>`;

        html += `
          <div class="tender-grid-row" data-item="${esc(it.id)}">
            <div><b>${esc(it.row_no ?? "")}</b></div>
            <div>
              <div style="font-weight:800;">${esc(it.name_purchase)}</div>
              <div class="tender-mini">
                Альтернативы: <b>${esc(it.alternatives?.length ?? 0)}</b> · Статус: ${status}
              </div>
            </div>
            <div>${esc(fmtNum(it.qty, 3))}</div>
            <div>${esc(it.unit)}</div>
            <div>${hasB ? esc(it.benchmark.supplier) : `<span class="tender-cell-muted">—</span>`}</div>
            <div>${hasB ? esc(it.benchmark.item) : `<span class="tender-cell-muted">не выбран</span>`}</div>
            <div>${hasB ? `<b>${esc(fmtNum(it.benchmark.price_unit))} ₽</b>` : `<span class="tender-cell-muted">—</span>`}</div>
            <div>${hasB ? esc(fmtNum(it.benchmark.score, 2)) : `<span class="tender-cell-muted">—</span>`}</div>
            <div>${compareChips}</div>
            <div style="display:flex; justify-content:flex-end;">
              <button class="btn" data-action="variants" data-item="${esc(it.id)}">Варианты</button>
            </div>
          </div>
        `;
      }

      html += `</div></div>`;
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

    function renderBenchmark(it) {
      if (!it.benchmark) {
        benchmarkBox.innerHTML = `<span class="sub">Эталон ещё не выбран. Найдите кандидатов и нажмите «Сделать эталоном».</span>`;
        return;
      }
      const b = it.benchmark;
      benchmarkBox.innerHTML = `
        <div class="row">
          <span class="badge good">Эталон</span>
          <span><b>Поставщик:</b> ${esc(b.supplier)}</span>
          <span><b>Товар:</b> ${esc(b.item)}</span>
          <span><b>Цена/ед:</b> ${esc(fmtNum(b.price_unit))} ₽</span>
          <span><b>Score:</b> ${esc(fmtNum(b.score, 2))}</span>
        </div>
        <div class="sub" style="margin-top:6px;">
          Теперь можно переключать «Основа поиска» на <b>по эталону</b> и искать альтернативы относительно эталона.
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
        <div class="tableWrap">
          <table>
            <tr>
              <th>Поставщик</th>
              <th>Товар</th>
              <th>Цена/ед</th>
              <th>Score</th>
              <th></th>
            </tr>
            ${alts
              .map(
                (a, idx) => `
              <tr>
                <td>${esc(a.supplier)}</td>
                <td>${esc(a.item)}</td>
                <td><b>${esc(fmtNum(a.price_unit))} ₽</b></td>
                <td>${esc(fmtNum(a.score, 2))}</td>
                <td><button class="btn" data-action="remove-alt" data-idx="${idx}">Удалить</button></td>
              </tr>`
              )
              .join("")}
          </table>
        </div>
      `;

      altBox.querySelectorAll('button[data-action="remove-alt"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.idx);
          if (!Number.isFinite(idx)) return;
          it.alternatives.splice(idx, 1);
          renderAlternatives(it);
          renderMainTable();
        });
      });
    }

    function renderOffersTable(it) {
      // header sorting UI
      const sortArrow = (key) => {
        if (sortKey !== key) return `<span>↕</span>`;
        return sortDir === "asc" ? `<span>↑</span>` : `<span>↓</span>`;
      };

      const rows = [...currentOffers].sort((a, b) => {
        const v = byKeyAsc(a, b, sortKey);
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
          ${rows
            .map((o) => {
              const isBenchmark =
                it.benchmark &&
                it.benchmark.supplier === o.supplier &&
                it.benchmark.item === o.item;

              return `
                <tr>
                  <td>${esc(o.supplier)} ${isBenchmark ? `<span class="badge good" style="margin-left:8px;">Эталон</span>` : ""}</td>
                  <td>${esc(o.item)}</td>
                  <td>${esc(fmtNum(o.price))}</td>
                  <td><b>${esc(fmtNum(o.price_unit))}</b></td>
                  <td>${esc(fmtNum(o.score, 2))}</td>
                  <td style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
                    <button class="btn primary" data-action="make-benchmark">Сделать эталоном</button>
                    <button class="btn" data-action="add-alt">Добавить как альтернативу</button>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </table>
      `;

      // bind sorting
      modalTableWrap.querySelectorAll(".sort-th").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.dataset.sort;
          if (!key) return;
          if (sortKey === key) {
            sortDir = sortDir === "asc" ? "desc" : "asc";
          } else {
            sortKey = key;
            sortDir = key === "score" ? "desc" : "asc";
          }
          renderOffersTable(it);
        });
      });

      // bind actions per row
      const table = modalTableWrap.querySelector("table");
      if (!table) return;

      const trs = Array.from(table.querySelectorAll("tr")).slice(1);
      trs.forEach((tr, idx) => {
        const o = rows[idx];
        if (!o) return;

        tr.querySelector('[data-action="make-benchmark"]')?.addEventListener("click", () => {
          it.benchmark = { ...o };
          setBasisUI(true);
          renderBenchmark(it);
          renderMainTable();
          alert("Демо: эталон установлен. Теперь можно искать по эталону.");
        });

        tr.querySelector('[data-action="add-alt"]')?.addEventListener("click", () => {
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
      if (manual) {
        q = manual;
      } else if (basis === "benchmark" && it.benchmark) {
        q = it.benchmark.item;
      } else {
        q = it.name_purchase;
      }

      currentOffers = offersForQuery(q);
      // default sort: score desc
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

    // search controls
    basisSel?.addEventListener("change", () => {
      if (!currentItem) return;
      setBasisUI(!!currentItem.benchmark);
    });

    searchBtn?.addEventListener("click", () => {
      if (!currentItem) return;
      runSearch(currentItem);
    });

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
    initTendersPage();
    initTenderProjectPage();
  });
})();
