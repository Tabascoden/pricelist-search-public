// static/tenders.js
(() => {
  const ROOT_ID = "tenders-demo";
  const LS_KEY = "tendersDemoStateV2";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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

  function nowISO() {
    return new Date().toISOString();
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
      if (raw) return JSON.parse(raw);
    } catch {}
    const seeded = seedState();
    saveState(seeded);
    return seeded;
  }

  function saveState(st) {
    localStorage.setItem(LS_KEY, JSON.stringify(st));
  }

  function seedState() {
    // Offers generator
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
      items
    });

    const mkItem = (id, rowNo, name, qty, unit) => ({
      id,
      rowNo,
      name,
      qty,
      unit,
      benchmarkOfferId: null,
      alternativeOfferIds: [],
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

  // --- Rendering ---
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

  function listView(root) {
    const listWrap = $("#tender-projects", root);
    const form = $("#tender-create-form", root);
    const input = $("#tender-title", root);

    if (!listWrap || !form) return;

    // table
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

    // bind open/delete
    $$('button[data-action="open"]', listWrap).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        if (!Number.isFinite(id)) return;
        navigate(`/tenders/${id}`);
      });
    });

    $$('button[data-action="delete"]', listWrap).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        if (!Number.isFinite(id)) return;
        if (!confirm(`Удалить тендер #${id}? (в демо — удалит только в UI)`)) return;
        state.projects = state.projects.filter((p) => p.id !== id);
        saveState(state);
        render();
      });
    });

    // create
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const title = (input?.value || "").trim() || "Тендер";
      const maxId = Math.max(0, ...state.projects.map((p) => p.id));
      const newId = maxId + 1;

      const newProject = {
        id: newId,
        title,
        created_at: nowISO(),
        items: [
          {
            id: state.lastIds.item + 1,
            rowNo: 1,
            name: "Позиция 1 (пример)",
            qty: 1,
            unit: "шт",
            benchmarkOfferId: null,
            alternativeOfferIds: [],
            offers: seedState().projects[0].items[0].offers // reuse offers shape
          }
        ]
      };

      state.lastIds.item += 1;
      state.lastIds.project = newId;
      state.projects.unshift(newProject);
      saveState(state);

      navigate(`/tenders/${newId}`);
    });
  }

  // ---- Modal state ----
  let modalProjectId = null;
  let modalItemId = null;
  let sortState = { key: "score", dir: "desc" }; // default
  let filteredOfferIds = null;

  function openModal(projectId, itemId) {
    modalProjectId = projectId;
    modalItemId = itemId;
    sortState = { key: "score", dir: "desc" };
    filteredOfferIds = null;

    const modal = $("#tender-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    renderModal();
  }

  function closeModal() {
    const modal = $("#tender-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    modalProjectId = null;
    modalItemId = null;
    filteredOfferIds = null;
  }

  function renderModal() {
    const root = document;
    const project = getProject(modalProjectId);
    if (!project) return;

    const item = getItem(project, modalItemId);
    if (!item) return;

    const subtitle = $("#tender-modal-subtitle", root);
    const manual = $("#tender-search-manual", root);
    const base = $("#tender-search-base", root);
    const baseHint = $("#tender-search-base-hint", root);
    const mode = $("#tender-candidates-mode", root);
    const benchBox = $("#tender-benchmark-box", root);
    const tbody = $("#tender-offers-body", root);

    if (subtitle) subtitle.textContent = `Позиция: ${item.rowNo}. ${item.name} · ${fmtNum(item.qty, 3)} ${item.unit}`;

    // base search availability
    const hasBenchmark = !!item.benchmarkOfferId;
    if (base) {
      base.value = hasBenchmark ? "benchmark" : "purchase";
      base.querySelector('option[value="benchmark"]').disabled = !hasBenchmark;
    }
    if (baseHint) {
      baseHint.textContent = hasBenchmark
        ? "Можно искать по эталону (после выбора эталона) или по строке закупки."
        : "Эталона нет — доступен первичный поиск по строке закупки.";
    }

    // benchmark box
    if (benchBox) {
      if (!item.benchmarkOfferId) {
        benchBox.textContent = "Эталон ещё не выбран. Найдите кандидатов и нажмите «Сделать эталоном».";
      } else {
        const offer = getOffer(item, item.benchmarkOfferId);
        benchBox.innerHTML = offer
          ? `<b>${esc(offer.supplier)}</b> · ${esc(offer.name)} · <b>${fmtNum(offer.ppu)} ₽/ед</b> (score ${fmtNum(offer.score, 2)})`
          : "Эталон выбран, но оффер не найден (демо-состояние).";
      }
    }

    // determine candidates list
    let offers = [...item.offers];
    let modeText = "по строке закупки";
    const manualQ = (manual?.value || "").trim();

    if (manualQ) {
      modeText = `ручной поиск: “${manualQ}”`;
      const q = manualQ.toLowerCase();
      offers = offers.filter((o) => `${o.supplier} ${o.name}`.toLowerCase().includes(q));
    } else {
      const baseVal = base?.value || "purchase";
      if (baseVal === "benchmark" && hasBenchmark) {
        modeText = "по эталону";
        const b = getOffer(item, item.benchmarkOfferId);
        const q = (b?.name || "").toLowerCase();
        offers = offers.filter((o) => o.name.toLowerCase().includes(q.split(" ")[0] || q));
      } else {
        modeText = "по строке закупки";
        const q = item.name.toLowerCase();
        offers = offers.filter((o) => o.name.toLowerCase().includes(q.split(" ")[0] || q));
      }
    }

    // remember filtered ids to keep stable between sorts
    filteredOfferIds = offers.map((o) => o.id);
    if (mode) mode.textContent = `— режим: ${modeText}`;

    // sorting
    offers.sort((a, b) => compareOffers(a, b, sortState.key, sortState.dir));

    // render rows
    if (!tbody) return;

    if (!offers.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="sub">Ничего не найдено (демо-фильтр).</td></tr>`;
      return;
    }

    tbody.innerHTML = offers
      .map((o) => {
        const isBenchmark = item.benchmarkOfferId === o.id;
        const isAlt = item.alternativeOfferIds.includes(o.id);

        return `
          <tr>
            <td>${esc(o.supplier)}</td>
            <td>${esc(o.name)}${isBenchmark ? ` <span class="tag" style="margin-left:6px;">Эталон</span>` : ""}</td>
            <td>${fmtNum(o.price)}</td>
            <td><b>${fmtNum(o.ppu)}</b></td>
            <td>${fmtNum(o.score, 2)}</td>
            <td style="white-space:nowrap;">
              <button class="btn primary" data-action="set-benchmark" data-oid="${o.id}" ${isBenchmark ? "disabled" : ""}>
                Сделать эталоном
              </button>
              <button class="btn" data-action="toggle-alt" data-oid="${o.id}">
                ${isAlt ? "Убрать альтернативу" : "Добавить как альтернативу"}
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    // bind actions
    $$('button[data-action="set-benchmark"]', tbody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const oid = Number(btn.dataset.oid);
        if (!Number.isFinite(oid)) return;
        item.benchmarkOfferId = oid;

        // когда выбрали эталон — разумно очистить альтернативы и искать заново от эталона (демо-логика)
        item.alternativeOfferIds = item.alternativeOfferIds.filter((id) => id !== oid);
        saveState(state);

        renderProjectView(); // refresh main table
        renderModal();       // refresh modal
      });
    });

    $$('button[data-action="toggle-alt"]', tbody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const oid = Number(btn.dataset.oid);
        if (!Number.isFinite(oid)) return;
        const idx = item.alternativeOfferIds.indexOf(oid);
        if (idx >= 0) item.alternativeOfferIds.splice(idx, 1);
        else item.alternativeOfferIds.push(oid);

        // не даём эталону быть альтернативой
        item.alternativeOfferIds = item.alternativeOfferIds.filter((id) => id !== item.benchmarkOfferId);

        saveState(state);
        renderProjectView();
        renderModal();
      });
    });

    // bind sorting
    const table = $("#tender-offers-table", root);
    if (table) {
      const ths = $$("th.sortable", table);
      ths.forEach((th) => {
        th.onclick = () => {
          const key = th.dataset.sort;
          if (!key) return;
          if (sortState.key === key) {
            sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
          } else {
            sortState.key = key;
            sortState.dir = key === "supplier" || key === "name" ? "asc" : "desc";
          }
          renderModal();
        };
      });
    }
  }

  function compareOffers(a, b, key, dir) {
    const mul = dir === "asc" ? 1 : -1;
    let va, vb;

    switch (key) {
      case "supplier":
        va = (a.supplier || "").toLowerCase();
        vb = (b.supplier || "").toLowerCase();
        return va.localeCompare(vb) * mul;
      case "name":
        va = (a.name || "").toLowerCase();
        vb = (b.name || "").toLowerCase();
        return va.localeCompare(vb) * mul;
      case "price":
        return (Number(a.price) - Number(b.price)) * mul;
      case "ppu":
        return (Number(a.ppu) - Number(b.ppu)) * mul;
      case "score":
      default:
        return (Number(a.score) - Number(b.score)) * mul;
    }
  }

  function projectView(root, projectId) {
    const backBtn = $("#tender-back", root);
    const titleEl = $("#tender-project-title", root);
    const itemsWrap = $("#tender-items", root);

    const uploadBtn = $("#tender-upload-btn", root);
    const autopickBtn = $("#tender-autopick", root);
    const exportBtn = $("#tender-export", root);

    const project = getProject(projectId);

    if (!project) {
      if (titleEl) titleEl.textContent = `Тендер #${projectId} (не найден)`;
      if (itemsWrap) itemsWrap.innerHTML = `<div class="sub">Нет такого проекта в демо-данных.</div>`;
      return;
    }

    if (titleEl) titleEl.textContent = `Тендер #${project.id} — ${project.title || "Тендер"}`;

    backBtn?.addEventListener("click", () => navigate("/tenders"));

    uploadBtn?.addEventListener("click", () => alert("Демо: загрузка XLSX будет подключена позже."));
    exportBtn?.addEventListener("click", () => exportCSV(project));

    autopickBtn?.addEventListener("click", () => {
      // демо-логика: выбираем эталон как max(score), при равенстве min(ppu), и добавляем 2 альтернативы
      for (const it of project.items) {
        const best = [...it.offers].sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.ppu ?? 1e9) - (b.ppu ?? 1e9);
        })[0];
        if (best) it.benchmarkOfferId = best.id;

        const alts = [...it.offers]
          .filter((o) => o.id !== it.benchmarkOfferId)
          .sort((a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9))
          .slice(0, 3)
          .map((o) => o.id);

        it.alternativeOfferIds = alts;
      }
      saveState(state);
      renderProjectView();
      alert("Автоподбор (демо) выполнен: выставили эталон и альтернативы.");
    });

    renderProjectView();
  }

  function renderProjectView() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const route = parseRoute();
    if (route.page !== "project") return;

    const projectId = route.projectId;
    const project = getProject(projectId);
    const itemsWrap = $("#tender-items", root);
    if (!itemsWrap) return;

    if (!project) {
      itemsWrap.innerHTML = `<div class="sub">Проект не найден.</div>`;
      return;
    }

    const rows = [...project.items].sort((a, b) => (a.rowNo ?? 0) - (b.rowNo ?? 0));

    let html = `
      <div class="tender-grid">
        <table>
          <thead>
            <tr>
              <th style="width:50px;">№</th>
              <th>Позиция закупки</th>
              <th style="width:90px;">Кол-во</th>
              <th style="width:70px;">Ед.</th>

              <th style="width:180px;">Эталон: Поставщик</th>
              <th>Эталон: Товар</th>
              <th style="width:110px;">Цена/ед</th>
              <th style="width:80px;">Score</th>

              <th style="width:320px;">Предложения других поставщиков</th>
              <th style="width:120px;">Статус</th>
              <th style="width:120px;"></th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const it of rows) {
      const bench = it.benchmarkOfferId ? getOffer(it, it.benchmarkOfferId) : null;

      const altOffers = it.alternativeOfferIds
        .map((id) => getOffer(it, id))
        .filter(Boolean);

      const altMini =
        altOffers.length
          ? `
            <div class="mini">
              <table>
                <thead>
                  <tr>
                    <th>Поставщик</th>
                    <th>Товар</th>
                    <th style="width:90px;">Цена/ед</th>
                  </tr>
                </thead>
                <tbody>
                  ${altOffers
                    .slice(0, 4)
                    .map(
                      (o) => `
                        <tr>
                          <td>${esc(o.supplier)}</td>
                          <td>${esc(o.name)}</td>
                          <td><b>${fmtNum(o.ppu)}</b></td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : `<span class="sub">нет альтернатив</span>`;

      const status = bench ? `есть эталон` : `нет эталона`;

      html += `
        <tr>
          <td>${esc(it.rowNo)}</td>
          <td><b>${esc(it.name)}</b></td>
          <td>${esc(fmtNum(it.qty, 3))}</td>
          <td>${esc(it.unit)}</td>

          <td>${bench ? esc(bench.supplier) : "—"}</td>
          <td>${bench ? esc(bench.name) : `<span class="sub">не выбран</span>`}</td>
          <td>${bench ? `<b>${fmtNum(bench.ppu)}</b>` : ""}</td>
          <td>${bench ? fmtNum(bench.score, 2) : ""}</td>

          <td>${altMini}</td>
          <td><span class="sub">${esc(status)}</span></td>

          <td>
            <button class="btn" data-action="variants" data-item="${it.id}">Варианты</button>
          </td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;

    itemsWrap.innerHTML = html;

    // bind modal buttons
    $$('button[data-action="variants"]', itemsWrap).forEach((btn) => {
      btn.addEventListener("click", () => {
        const itemId = Number(btn.dataset.item);
        if (!Number.isFinite(itemId)) return;
        openModal(project.id, itemId);
      });
    });
  }

  function exportCSV(project) {
    const header = [
      "row_no",
      "purchase_name",
      "qty",
      "unit",
      "benchmark_supplier",
      "benchmark_name",
      "benchmark_ppu",
      "benchmark_score",
      "alternatives_count"
    ];

    const lines = [header.join(",")];
    for (const it of project.items) {
      const bench = it.benchmarkOfferId ? getOffer(it, it.benchmarkOfferId) : null;
      const row = [
        it.rowNo,
        `"${String(it.name).replaceAll('"', '""')}"`,
        it.qty,
        `"${String(it.unit).replaceAll('"', '""')}"`,
        bench ? `"${String(bench.supplier).replaceAll('"', '""')}"` : "",
        bench ? `"${String(bench.name).replaceAll('"', '""')}"` : "",
        bench ? bench.ppu : "",
        bench ? bench.score : "",
        it.alternativeOfferIds.length
      ];
      lines.push(row.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tender_${project.id}_demo.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function bindModalUI() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const modal = $("#tender-modal", root);
    const closeBtn = $("#tender-modal-close", root);
    const searchBtn = $("#tender-search-btn", root);
    const resetBtn = $("#tender-search-reset", root);

    closeBtn?.addEventListener("click", closeModal);
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    // search controls just re-render modal with current inputs
    searchBtn?.addEventListener("click", () => renderModal());
    resetBtn?.addEventListener("click", () => {
      const manual = $("#tender-search-manual", root);
      const base = $("#tender-search-base", root);
      if (manual) manual.value = "";
      if (base) base.value = "purchase";
      renderModal();
    });

    // close on ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) closeModal();
    });
  }

  function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

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

  // boot
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    state = loadState();
    bindModalUI();
    render();

    window.addEventListener("popstate", () => render());
  });
})();

