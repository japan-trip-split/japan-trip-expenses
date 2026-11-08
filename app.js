"use strict";

const DOC_KEY = "japan-trip-ledger-v1";
const USER_KEY = "japan-trip-user-v1";
const STORAGE_FULL_MSG = "Couldn’t save — this phone’s storage for the site is full. The last change was not kept. Export a backup if you can, delete some receipt photos, and try again.";
const STORAGE_WARN_MSG = "Storage on this phone is getting full. Export a backup, then delete receipt photos you no longer need. If it fills up, new expenses may not save.";

const CATEGORY_META = [
  { id: "Food", ja: "食事", mark: "食" },
  { id: "Transport", ja: "交通", mark: "交" },
  { id: "Accommodation", ja: "宿泊", mark: "宿" },
  { id: "Activities/Tickets", ja: "観光", mark: "観" },
  { id: "Shopping", ja: "買物", mark: "買" },
  { id: "Other", ja: "その他", mark: "他" },
];

let doc = null;
let savedJSON = "";
let currentUserId = null;
let lastRouteKey = "";
let saveTimer = 0;
let dialogResolve = null;
let lastFocus = null;
let toastTimer = 0;
let draftId = "";
let draftCreatedAt = "";
let draftReceipt = null;
let photoBusy = false;
let compressToken = 0;

function el(tag, props) {
  const node = document.createElement(tag);
  const children = Array.prototype.slice.call(arguments, 2);
  if (props) {
    Object.keys(props).forEach((key) => {
      const value = props[key];
      if (value == null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "value") node.value = value;
      else if (key === "checked") node.checked = Boolean(value);
      else if (key === "hidden") node.hidden = Boolean(value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
  }
  children.flat().forEach((child) => {
    if (child == null || child === false) return;
    if (typeof child === "string" || typeof child === "number") node.append(document.createTextNode(String(child)));
    else node.append(child);
  });
  return node;
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const rand = (Math.random() * 16) | 0;
    return (ch === "x" ? rand : (rand & 0x3) | 0x8).toString(16);
  });
}

function todayISO() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

function shiftISO(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + m + "-" + d;
}

function dateLabel(iso) {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === shiftISO(today, -1)) return "Yesterday";
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const options = { weekday: "short", month: "short", day: "numeric" };
  if (year !== new Date().getFullYear()) options.year = "numeric";
  return date.toLocaleDateString("en-US", options);
}

function money(amount) {
  return TripSplit.formatMoney(amount, doc.settings);
}

function personName(id) {
  const person = doc.people.find((item) => item.id === id);
  return person ? person.name : "Someone";
}

function categoryMeta(id) {
  return CATEGORY_META.find((item) => item.id === id) || { id: id, ja: "", mark: "・" };
}

function loadDoc() {
  const raw = localStorage.getItem(DOC_KEY);
  if (!raw) return { doc: TripSplit.createDocument(), recovered: false };
  try {
    const result = TripSplit.normalizeDocument(JSON.parse(raw));
    if (!result.ok) throw new Error(result.error || "unreadable");
    return { doc: result.document, recovered: false };
  } catch (error) {
    try {
      localStorage.setItem(DOC_KEY + "-unreadable", raw);
    } catch (err) {
      /* The broken copy could not be set aside. */
    }
    localStorage.removeItem(DOC_KEY);
    return { doc: TripSplit.createDocument(), recovered: true };
  }
}

function persist() {
  let next;
  try {
    next = TripSplit.serializeDocument(doc);
  } catch (error) {
    const soft = Boolean(error.soft) || /needs a name|title is missing|currency/i.test(error.message || "");
    return { ok: false, soft: soft };
  }
  next.settings.updatedAt = new Date().toISOString();
  const json = JSON.stringify(next);
  try {
    localStorage.setItem(DOC_KEY, json);
  } catch (error) {
    return { ok: false, soft: false, error: error };
  }
  doc = next;
  savedJSON = json;
  return { ok: true, bytes: json.length * 2 };
}

function commit(mutator) {
  const snapshot = savedJSON ? JSON.parse(savedJSON) : TripSplit.serializeDocument(doc);
  mutator(doc);
  const result = persist();
  if (!result.ok) {
    doc = snapshot;
    if (!result.soft) showBanner(STORAGE_FULL_MSG, "bad");
    return false;
  }
  clearBanner("bad");
  updateChrome();
  updateStorageBanner();
  return true;
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 280);
}

function flushSave() {
  window.clearTimeout(saveTimer);
  const result = persist();
  if (!result.ok && !result.soft) {
    if (savedJSON) doc = JSON.parse(savedJSON);
    showBanner(STORAGE_FULL_MSG, "bad");
    if (currentRoute().name === "settings") renderSettings();
    updateChrome();
    return;
  }
  if (result.ok) {
    clearBanner("bad");
    updateChrome();
    updateStorageBanner();
    if (document.getElementById("view-settings") && !document.getElementById("view-settings").hidden) {
      renderStorage();
      renderExample();
    }
  }
}

function showBanner(message, tone) {
  const banner = document.getElementById("banner");
  banner.hidden = false;
  banner.className = "banner " + (tone || "warn");
  banner.dataset.kind = tone || "warn";
  banner.textContent = message;
}

function clearBanner(kind) {
  const banner = document.getElementById("banner");
  if (kind && banner.dataset.kind !== kind) return;
  banner.hidden = true;
  banner.textContent = "";
  delete banner.dataset.kind;
}

function updateStorageBanner() {
  const banner = document.getElementById("banner");
  if (banner.dataset.kind === "bad") return;
  const raw = localStorage.getItem(DOC_KEY) || "";
  const level = TripSplit.storageLevel(raw.length * 2);
  if (level === "warn" || level === "full") showBanner(STORAGE_WARN_MSG, "warn");
  else clearBanner("warn");
}

function toast(message) {
  const node = document.getElementById("toast");
  node.hidden = false;
  node.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.hidden = true;
  }, 2800);
}

function updateChrome() {
  const title = (doc.settings.tripTitle || "").trim() || "Japan Trip";
  document.getElementById("trip-title").textContent = title;
  document.title = title + " · Expenses";
  document.getElementById("currency-label").textContent = (doc.settings.currencyLabel || "").trim() || "JPY";
  const person = doc.people.find((item) => item.id === currentUserId);
  document.getElementById("who-label").textContent = person ? person.name : "Choose";
  const symbol = document.getElementById("amount-symbol");
  if (symbol) symbol.textContent = doc.settings.currencySymbol || "¥";
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) {
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    theme.setAttribute("content", dark ? "#0c1e27" : "#1a3c4e");
  }
}

function currentRoute() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  let bits = [];
  try {
    bits = raw.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch (error) {
    bits = [];
  }
  return { name: bits[0] || (currentUserId ? "expenses" : "who"), id: bits[1] || null };
}

function viewName(routeName) {
  const map = {
    who: "who",
    expenses: "expenses",
    expense: "detail",
    new: "editor",
    edit: "editor",
    balances: "balances",
    settle: "settle",
    settings: "settings",
  };
  return map[routeName] || (currentUserId ? "expenses" : "who");
}

function go(hash) {
  if (location.hash === hash) onRoute(true);
  else location.hash = hash;
}

function applyView(view, route) {
  ["who", "expenses", "detail", "editor", "balances", "settle", "settings"].forEach((name) => {
    document.getElementById("view-" + name).hidden = name !== view;
  });
  const tabbed = ["expenses", "detail", "balances", "settle", "settings"].includes(view);
  document.getElementById("tabbar").hidden = !tabbed;
  document.body.classList.toggle("no-tabs", !tabbed);
  document.getElementById("who-button").hidden = view === "who" || view === "editor";
  document.body.dataset.view = view;
  const tabName = view === "detail" ? "expenses" : route.name;
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tabbed && tab.dataset.tab === tabName) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
}

function onRoute(force) {
  const route = currentRoute();
  if (!currentUserId && route.name !== "who") {
    if (location.hash !== "#/who") location.replace("#/who");
    return;
  }
  const view = viewName(route.name);
  const key = view + "/" + (route.id || "");
  const entered = force || key !== lastRouteKey;
  lastRouteKey = key;
  if (view === "who") renderWho();
  else if (view === "expenses") renderExpenses();
  else if (view === "detail") renderDetail(route.id);
  else if (view === "editor" && entered) renderEditor(route.name === "edit" ? route.id : null);
  else if (view === "balances") renderBalances();
  else if (view === "settle") renderSettle();
  else if (view === "settings" && entered) renderSettings();
  applyView(view, route);
  if (entered) window.scrollTo(0, 0);
  updateChrome();
  updateStorageBanner();
}

function renderWho() {
  document.getElementById("who-title").textContent = currentUserId ? "Switch person" : "Who are you?";
  document.getElementById("who-ja").textContent = currentUserId ? "切り替え" : "どなたですか";
  document.getElementById("who-lede").textContent = currentUserId
    ? "Pick the name this phone should use. Expenses stay put."
    : "Pick your name. This phone remembers it next time.";
  const grid = document.getElementById("who-grid");
  grid.replaceChildren();
  doc.people.forEach((person, index) => {
    grid.append(
      el(
        "button",
        {
          type: "button",
          class: "who-card" + (person.id === currentUserId ? " is-current" : ""),
          "data-action": "pick-user",
          "data-id": person.id,
        },
        el("span", { class: "num", text: String(index + 1).padStart(2, "0") }),
        el("span", { class: "name", text: person.name })
      )
    );
  });
}

function selectUser(id) {
  if (!doc.people.some((person) => person.id === id)) return;
  currentUserId = id;
  localStorage.setItem(USER_KEY, id);
  if (currentRoute().name === "who") go("#/expenses");
  else updateChrome();
}

function splitSummary(expense) {
  const count = expense.parts.length;
  if (count === doc.people.length && expense.split !== "custom") return "All 8";
  if (count === doc.people.length) return "All 8 · custom";
  if (count === 1) return "Just " + personName(expense.parts[0].personId);
  if (expense.split === "custom") return count + " people · custom";
  return count + " people";
}

function renderExpenses() {
  const total = doc.expenses.reduce((sum, item) => sum + item.amount, 0);
  const count = doc.expenses.length;
  document.getElementById("expense-summary").textContent = count
    ? count + (count === 1 ? " expense · " : " expenses · ") + money(total)
    : "No expenses yet";
  const list = document.getElementById("expense-list");
  list.replaceChildren();
  if (!count) {
    list.append(
      el(
        "div",
        { class: "empty" },
        el("div", { class: "empty-mark", text: "旅" }),
        el("h3", { text: "No expenses yet" }),
        el("p", { text: "Add the first bill — a train, a dinner, the hotel. Totals and who owes whom show up as soon as it’s saved." })
      )
    );
    return;
  }
  const sorted = doc.expenses.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  let lastDate = "";
  sorted.forEach((item) => {
    if (item.date !== lastDate) {
      lastDate = item.date;
      list.append(el("h3", { class: "day", text: dateLabel(item.date) }));
    }
    list.append(expenseRow(item));
  });
}

function expenseRow(item) {
  const meta = categoryMeta(item.category);
  const visual = item.receipt && TripSplit.isSafeImage(item.receipt)
    ? el(
        "button",
        { type: "button", class: "thumb-btn", "data-action": "open-receipt", "data-id": item.id, "aria-label": "View receipt for " + item.description },
        el("img", { src: item.receipt, alt: "", loading: "lazy" })
      )
    : el("div", { class: "monogram", "aria-hidden": "true", text: meta.mark });
  const link = el(
    "a",
    { class: "expense-main", href: "#/expense/" + encodeURIComponent(item.id) },
    el("span", { class: "desc", text: item.description }),
    el("span", { class: "money", text: money(item.amount) }),
    el("span", { class: "paid-by", text: "Paid by " + personName(item.payerId) }),
    el("span", { class: "meta", text: item.category + " " + meta.ja + " · " + splitSummary(item) })
  );
  return el("article", { class: "expense" }, visual, link);
}

function renderDetail(id) {
  const root = document.getElementById("detail-root");
  const item = doc.expenses.find((expense) => expense.id === id);
  root.replaceChildren();
  if (!item) {
    root.append(el("p", { class: "lede", text: "That expense isn’t on this phone." }));
    return;
  }
  const meta = categoryMeta(item.category);
  root.append(el("p", { class: "lede", text: dateLabel(item.date) + " · " + item.category + " · " + meta.ja }));
  root.append(el("h2", { text: item.description }));
  root.append(el("p", { class: "detail-amount money", text: money(item.amount) }));
  root.append(el("p", { text: "Paid by " + personName(item.payerId) + "." }));
  root.append(
    el(
      "div",
      { class: "detail-actions" },
      el("a", { class: "btn primary", href: "#/edit/" + encodeURIComponent(item.id), text: "Edit" }),
      el("button", { type: "button", class: "btn ghost", "data-action": "delete-expense", "data-id": item.id, text: "Delete" })
    )
  );
  if (item.receipt && TripSplit.isSafeImage(item.receipt)) {
    root.append(
      el(
        "button",
        { type: "button", class: "detail-shot", "data-action": "open-receipt", "data-id": item.id, "aria-label": "Open receipt" },
        el("img", { src: item.receipt, alt: "Receipt for " + item.description })
      )
    );
  }
  const shares = TripSplit.sharesForExpense(item, doc.people);
  const box = el("div", { class: "receipt" }, el("div", { class: "receipt-head" }, el("h3", {}, "Shares ", el("span", { class: "jp", lang: "ja", text: "割り勘" }))));
  shares.forEach((share) => {
    const part = item.parts.find((row) => row.personId === share.id);
    const ratio = item.split === "custom" && part ? " · " + part.weight : "";
    box.append(
      el(
        "div",
        { class: "receipt-line" },
        el("span", { text: personName(share.id) + ratio }),
        el("span", { class: "money", text: money(share.amount) })
      )
    );
  });
  const payerIn = item.parts.some((part) => part.personId === item.payerId);
  box.append(
    el("p", {
      class: "receipt-note",
      text: payerIn
        ? "Split " + (item.split === "custom" ? "by custom ratios" : "equally") + " · " + splitSummary(item) + "."
        : personName(item.payerId) + " paid and is not sharing this one.",
    })
  );
  root.append(box);
}

function renderEditor(id) {
  const expense = id ? doc.expenses.find((item) => item.id === id) : null;
  const missing = document.getElementById("editor-missing");
  const form = document.getElementById("expense-form");
  if (id && !expense) {
    missing.hidden = false;
    form.hidden = true;
    document.getElementById("editor-heading-text").textContent = "Expense";
    return;
  }
  missing.hidden = true;
  form.hidden = false;
  draftId = expense ? expense.id : uid();
  draftCreatedAt = expense ? expense.createdAt : new Date().toISOString();
  draftReceipt = expense && expense.receipt ? expense.receipt : null;
  photoBusy = false;
  compressToken += 1;
  document.getElementById("editor-heading-text").textContent = expense ? "Edit expense" : "New expense";
  document.getElementById("editor-back").setAttribute("href", expense ? "#/expense/" + encodeURIComponent(expense.id) : "#/expenses");
  document.getElementById("field-description").value = expense ? expense.description : "";
  document.getElementById("field-amount").value = expense ? TripSplit.minorToInput(expense.amount, doc.settings.decimals) : "";
  document.getElementById("field-amount").setAttribute("inputmode", doc.settings.decimals === 2 ? "decimal" : "numeric");
  document.getElementById("field-date").value = expense ? expense.date : todayISO();
  document.getElementById("amount-symbol").textContent = doc.settings.currencySymbol || "¥";
  document.getElementById("amount-hint").textContent = doc.settings.decimals === 2 ? "Up to two decimal places." : "Whole numbers.";
  document.querySelectorAll('input[name="category"]').forEach((input) => {
    input.checked = input.value === (expense ? expense.category : "Food");
  });
  document.querySelectorAll('input[name="split-mode"]').forEach((input) => {
    input.checked = input.value === (expense && expense.split === "custom" ? "custom" : "equal");
  });
  renderPeoplePickers(expense);
  showReceiptPreview(draftReceipt);
  setReceiptStatus(draftReceipt ? "Photo attached." : "");
  document.getElementById("save-expense").disabled = false;
  setFormError("");
  updatePreview();
  window.setTimeout(() => {
    const field = document.getElementById("field-description");
    if (field && !document.getElementById("view-editor").hidden) field.focus();
  }, 0);
}

function renderPeoplePickers(expense) {
  const payerBox = document.getElementById("payer-chips");
  const rows = document.getElementById("person-rows");
  payerBox.replaceChildren();
  rows.replaceChildren();
  const payerId = expense ? expense.payerId : currentUserId;
  const selected = new Set(expense ? expense.parts.map((part) => part.personId) : doc.people.map((person) => person.id));
  const weights = new Map((expense ? expense.parts : []).map((part) => [part.personId, part.weight]));
  doc.people.forEach((person) => {
    payerBox.append(
      el(
        "label",
        { class: "chip" },
        el("input", { type: "radio", name: "payer", value: person.id, checked: person.id === payerId }),
        el("span", { text: person.name })
      )
    );
    rows.append(
      el(
        "div",
        { class: "person-row", "data-person-row": "true", "data-person-id": person.id },
        el(
          "label",
          { class: "check" },
          el("input", { type: "checkbox", checked: selected.has(person.id) }),
          el("span", { text: person.name })
        ),
        el(
          "label",
          { class: "ratio" },
          el("input", {
            class: "ratio-input",
            type: "number",
            min: "0.1",
            step: "0.5",
            inputmode: "decimal",
            value: String(weights.get(person.id) || 1),
            "aria-label": "Ratio for " + person.name,
          })
        )
      )
    );
  });
}

function readDraft() {
  const parsed = TripSplit.parseMoney(document.getElementById("field-amount").value, doc.settings.decimals);
  const categoryInput = document.querySelector('input[name="category"]:checked');
  const payerInput = document.querySelector('input[name="payer"]:checked');
  const splitInput = document.querySelector('input[name="split-mode"]:checked');
  const split = splitInput && splitInput.value === "custom" ? "custom" : "equal";
  const parts = [];
  document.querySelectorAll("[data-person-row]").forEach((row) => {
    const box = row.querySelector('input[type="checkbox"]');
    if (!box || !box.checked) return;
    const weight = split === "custom" ? Number(row.querySelector(".ratio-input").value) : 1;
    parts.push({ personId: row.dataset.personId, weight: weight });
  });
  return {
    id: draftId,
    description: document.getElementById("field-description").value,
    amount: parsed.ok ? parsed.amount : 0,
    validParse: parsed.ok,
    amountError: parsed.ok ? null : parsed.error,
    category: categoryInput ? categoryInput.value : "",
    date: document.getElementById("field-date").value,
    payerId: payerInput ? payerInput.value : "",
    split: split,
    parts: parts,
    receipt: draftReceipt,
    createdAt: draftCreatedAt,
    updatedAt: new Date().toISOString(),
  };
}

function cleanDraft(draft) {
  const parts = draft.parts
    .map((part) => ({
      personId: part.personId,
      weight: draft.split === "equal" ? 1 : Math.round(Number(part.weight) * 1000) / 1000,
    }))
    .sort((a, b) => doc.people.findIndex((person) => person.id === a.personId) - doc.people.findIndex((person) => person.id === b.personId));
  let receipt = null;
  if (draft.receipt) {
    receipt = TripSplit.cleanReceipt(draft.receipt);
    if (!receipt) return { error: "That photo couldn’t be stored. Remove it and try a JPEG or PNG." };
  }
  return {
    expense: {
      id: draft.id,
      description: draft.description.trim(),
      amount: draft.amount,
      category: draft.category,
      date: draft.date,
      payerId: draft.payerId,
      split: draft.split,
      parts: parts,
      receipt: receipt,
      createdAt: draft.createdAt,
      updatedAt: new Date().toISOString(),
    },
  };
}

function setFormError(message) {
  const node = document.getElementById("form-error");
  node.hidden = !message;
  node.textContent = message || "";
  if (message) node.focus();
}

function updatePreview() {
  const form = document.getElementById("expense-form");
  if (!form || form.hidden) return;
  const splitInput = document.querySelector('input[name="split-mode"]:checked');
  form.classList.toggle("is-custom", Boolean(splitInput && splitInput.value === "custom"));
  const draft = readDraft();
  document.getElementById("split-count").textContent = draft.parts.length === 1 ? "Sharing: 1 person" : "Sharing: " + draft.parts.length + " people";
  const box = document.getElementById("split-preview");
  box.replaceChildren();
  if (!draft.validParse) {
    box.append(el("p", { class: "preview-empty", text: "Enter an amount to see each share." }));
    return;
  }
  if (!draft.parts.length) {
    box.append(el("p", { class: "preview-empty", text: "Choose at least one person." }));
    return;
  }
  if (draft.split === "custom" && draft.parts.some((part) => !(Number(part.weight) > 0))) {
    box.append(el("p", { class: "preview-empty", text: "Each selected person needs a ratio greater than zero." }));
    return;
  }
  let shares = [];
  try {
    shares = TripSplit.sharesForExpense(
      {
        amount: draft.amount,
        parts: draft.parts.map((part) => ({
          personId: part.personId,
          weight: draft.split === "equal" ? 1 : part.weight,
        })),
      },
      doc.people
    );
  } catch (error) {
    box.append(el("p", { class: "preview-empty", text: "Check the ratios." }));
    return;
  }
  box.append(
    el(
      "div",
      { class: "receipt-head" },
      el("h3", {}, "Shares ", el("span", { class: "jp", lang: "ja", text: "割り勘" })),
      el("strong", { class: "money", text: money(draft.amount) })
    )
  );
  shares.forEach((share) => {
    const part = draft.parts.find((item) => item.personId === share.id);
    const ratio = draft.split === "custom" && part ? " · " + part.weight : "";
    box.append(
      el(
        "div",
        { class: "receipt-line" },
        el("span", { text: personName(share.id) + ratio }),
        el("span", { class: "money", text: money(share.amount) })
      )
    );
  });
  const payerIn = draft.payerId && draft.parts.some((part) => part.personId === draft.payerId);
  box.append(
    el("p", {
      class: "receipt-note",
      text: draft.payerId
        ? payerIn
          ? "Paid by " + personName(draft.payerId) + "."
          : "Paid by " + personName(draft.payerId) + ", who is not sharing this one."
        : "Choose who paid.",
    })
  );
  const amounts = shares.map((share) => share.amount);
  if (draft.split === "equal" && amounts.length > 1 && Math.max.apply(null, amounts) - Math.min.apply(null, amounts) === 1) {
    box.append(el("p", { class: "receipt-note", text: "The extra yen goes to the earliest names on the trip list." }));
  }
}

function upsertExpense(expense) {
  return commit((state) => {
    const index = state.expenses.findIndex((item) => item.id === expense.id);
    if (index === -1) state.expenses.push(expense);
    else state.expenses[index] = expense;
  });
}

async function saveExpense(event) {
  event.preventDefault();
  if (photoBusy) {
    setFormError("Wait for the photo to finish, then save.");
    return;
  }
  const draft = readDraft();
  const error = TripSplit.validateDraft(draft, doc.people);
  if (error) {
    setFormError(error);
    return;
  }
  const cleaned = cleanDraft(draft);
  if (cleaned.error) {
    setFormError(cleaned.error);
    return;
  }
  setFormError("");
  const isNew = !doc.expenses.some((item) => item.id === cleaned.expense.id);
  let ok = upsertExpense(cleaned.expense);
  let note = "";
  if (!ok && cleaned.expense.receipt) {
    const drop = await confirmDialog({
      title: "The photo didn’t fit",
      body: "This phone is out of room, so nothing was saved. You can save the expense without the receipt photo.",
      confirmLabel: "Save without photo",
      danger: false,
    });
    if (!drop) return;
    cleaned.expense.receipt = null;
    draftReceipt = null;
    showReceiptPreview(null);
    ok = upsertExpense(cleaned.expense);
    note = "Saved without the photo. Storage is full.";
  }
  if (!ok) return;
  toast(note || (isNew ? "Expense saved." : "Expense updated."));
  go("#/expense/" + encodeURIComponent(cleaned.expense.id));
}

async function deleteExpense(id) {
  const expense = doc.expenses.find((item) => item.id === id);
  if (!expense) return;
  const ok = await confirmDialog({
    title: "Delete this expense?",
    body: "“" + expense.description + "” will leave the totals" + (expense.receipt ? ", and its receipt photo will be removed" : "") + ".",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  if (!commit((state) => {
    state.expenses = state.expenses.filter((item) => item.id !== id);
  })) return;
  toast("Expense deleted.");
  go("#/expenses");
}

function setAllParticipants(checked) {
  document.querySelectorAll("#person-rows input[type='checkbox']").forEach((box) => {
    box.checked = checked;
  });
  updatePreview();
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn’t read that photo. Try a JPEG or PNG."));
    };
    image.src = url;
  });
}

async function compressImage(file) {
  if (!file) throw new Error("Choose a photo.");
  if (file.type && file.type.indexOf("image/") !== 0) throw new Error("Choose a photo from your camera or library.");
  if (file.size > 25 * 1024 * 1024) throw new Error("That photo is too large. Try a smaller one.");
  let source = null;
  let bitmap = null;
  let width = 0;
  let height = 0;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    }
  } catch (error) {
    bitmap = null;
  }
  if (!source) {
    const image = await loadImageElement(file);
    source = image;
    width = image.naturalWidth || image.width;
    height = image.naturalHeight || image.height;
  }
  if (!width || !height) throw new Error("Couldn’t read that photo. Try a JPEG or PNG.");
  const paint = (targetWidth, targetHeight, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const scale = width > 1200 ? 1200 / width : 1;
  let w = Math.max(1, Math.round(width * scale));
  let h = Math.max(1, Math.round(height * scale));
  let url = paint(w, h, 0.7);
  if (url.length > 450000) url = paint(w, h, 0.55);
  if (url.length > 600000) {
    const smaller = Math.min(1, 1000 / w);
    url = paint(Math.max(1, Math.round(w * smaller)), Math.max(1, Math.round(h * smaller)), 0.5);
  }
  if (bitmap && bitmap.close) bitmap.close();
  return url;
}

function setReceiptStatus(message) {
  document.getElementById("receipt-status").textContent = message || "";
}

function showReceiptPreview(src) {
  const wrap = document.getElementById("receipt-preview-wrap");
  const image = document.getElementById("receipt-preview");
  const remove = document.getElementById("photo-remove");
  if (!src || !TripSplit.isSafeImage(src)) {
    wrap.hidden = true;
    image.removeAttribute("src");
    remove.hidden = true;
    return;
  }
  image.src = src;
  image.alt = "Receipt preview";
  wrap.hidden = false;
  remove.hidden = false;
}

async function onReceiptChosen(file) {
  const input = document.getElementById("receipt-input");
  if (input) input.value = "";
  if (!file) return;
  const token = ++compressToken;
  photoBusy = true;
  document.getElementById("save-expense").disabled = true;
  setReceiptStatus("Preparing photo…");
  try {
    const url = await compressImage(file);
    if (token !== compressToken) return;
    draftReceipt = url;
    showReceiptPreview(url);
    setReceiptStatus("Photo ready.");
  } catch (error) {
    if (token !== compressToken) return;
    setReceiptStatus(error.message || "Couldn’t read that photo.");
  } finally {
    if (token === compressToken) {
      photoBusy = false;
      document.getElementById("save-expense").disabled = false;
    }
  }
}

function removeReceipt() {
  compressToken += 1;
  photoBusy = false;
  draftReceipt = null;
  document.getElementById("save-expense").disabled = false;
  showReceiptPreview(null);
  setReceiptStatus("Photo removed.");
}

function openLightbox(src, caption) {
  if (!TripSplit.isSafeImage(src)) return;
  const box = document.getElementById("lightbox");
  const image = document.getElementById("lightbox-img");
  image.src = src;
  image.alt = caption || "Receipt";
  document.getElementById("lightbox-cap").textContent = caption || "";
  box.hidden = false;
  document.body.classList.add("locked");
  document.getElementById("lightbox-close").focus();
}

function closeLightbox() {
  const box = document.getElementById("lightbox");
  box.hidden = true;
  document.getElementById("lightbox-img").removeAttribute("src");
  document.body.classList.remove("locked");
}

function confirmDialog(options) {
  return new Promise((resolve) => {
    lastFocus = document.activeElement;
    dialogResolve = resolve;
    document.getElementById("dialog-title").textContent = options.title;
    document.getElementById("dialog-body").textContent = options.body;
    const ok = document.getElementById("dialog-ok");
    ok.textContent = options.confirmLabel || "OK";
    ok.className = options.danger ? "btn danger" : "btn primary";
    document.getElementById("dialog-cancel").textContent = options.cancelLabel || "Cancel";
    document.getElementById("dialog").hidden = false;
    document.body.classList.add("locked");
    document.getElementById("dialog-cancel").focus();
  });
}

function closeDialog(value) {
  if (!dialogResolve) return;
  document.getElementById("dialog").hidden = true;
  document.body.classList.remove("locked");
  const resolve = dialogResolve;
  dialogResolve = null;
  resolve(value);
  if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
}

function renderBalances() {
  const root = document.getElementById("balance-root");
  const balances = TripSplit.computeBalances(doc.people, doc.expenses);
  const total = doc.expenses.reduce((sum, item) => sum + item.amount, 0);
  const netSum = balances.reduce((sum, row) => sum + row.net, 0);
  root.replaceChildren();
  root.append(
    el(
      "div",
      { class: "hero" },
      el("p", { class: "kicker", text: "Total spent · 合計" }),
      el("p", { class: "total money", text: money(total) }),
      el("p", { class: "sub", text: doc.expenses.length + (doc.expenses.length === 1 ? " expense" : " expenses") })
    )
  );
  balances.forEach((row) => {
    let netClass = "even";
    let netText = "Settled";
    if (row.net > 0) {
      netClass = "owed";
      netText = "Owed " + money(row.net);
    } else if (row.net < 0) {
      netClass = "owes";
      netText = "Owes " + money(-row.net);
    }
    root.append(
      el(
        "div",
        { class: "ledger-row" + (row.id === currentUserId ? " is-you" : "") },
        el("div", { class: "person-name" }, row.name, row.id === currentUserId ? el("span", { class: "you-tag", text: "You" }) : null),
        el("div", { class: "net money " + netClass, text: netText }),
        el("div", { class: "fine", text: "Paid " + money(row.paid) + " · share " + money(row.share) })
      )
    );
  });
  if (netSum !== 0) {
    root.append(el("p", { class: "books-warn", text: "The books are off by " + money(netSum) + ". Export a backup, then check the latest expenses." }));
  }
}

function settlementLines() {
  const balances = TripSplit.computeBalances(doc.people, doc.expenses);
  const payments = TripSplit.settle(balances);
  const lines = [((doc.settings.tripTitle || "Trip").trim() || "Trip") + " — settlement", ""];
  if (!doc.expenses.length) lines.push("No expenses yet.");
  else if (!payments.length) lines.push("Everyone is square. Nobody owes anything.");
  else {
    payments.forEach((payment) => {
      lines.push(payment.fromName + " pays " + payment.toName + " " + money(payment.amount));
    });
  }
  lines.push("", "Log only what the group spent. A repayment is settled in cash; it is not a new expense.");
  return { payments: payments, balances: balances, text: lines.join("\n") };
}

function renderSettle() {
  const root = document.getElementById("settle-root");
  const result = settlementLines();
  root.replaceChildren();
  if (!doc.expenses.length) {
    root.append(el("div", { class: "empty" }, el("h3", { text: "Nothing to settle yet" }), el("p", { text: "Add an expense and the payments will show up here." })));
    return;
  }
  if (!result.payments.length) {
    root.append(el("div", { class: "empty" }, el("h3", { text: "Everyone is square" }), el("p", { text: "Nobody owes anything." })));
    return;
  }
  root.append(
    el("p", {
      class: "settle-count",
      text: result.payments.length + (result.payments.length === 1 ? " payment squares the trip." : " payments square the trip."),
    })
  );
  result.payments.forEach((payment) => {
    const involvesYou = payment.fromId === currentUserId || payment.toId === currentUserId;
    const youNote = payment.fromId === currentUserId ? "You pay this." : payment.toId === currentUserId ? "This comes to you." : "";
    root.append(
      el(
        "article",
        { class: "pay-slip" + (payment.toId === currentUserId ? " is-in" : "") },
        el(
          "div",
          { class: "pay-line" },
          el("strong", { text: payment.fromName }),
          el("span", { class: "arrow", text: "→" }),
          el("strong", { text: payment.toName })
        ),
        el("p", { class: "pay-amount money", text: money(payment.amount) }),
        youNote ? el("p", { class: "pay-you", text: youNote }) : null,
        involvesYou ? null : null
      )
    );
  });
}

async function copySettlement() {
  const text = settlementLines().text;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast("Payment list copied.");
      return;
    }
  } catch (error) {
    /* Fall through to the textarea copy. */
  }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
  toast("Payment list copied.");
}

function slug(title) {
  const value = String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return value || "trip";
}

function exportFile() {
  flushSave();
  const clean = TripSplit.serializeDocument(doc);
  const json = JSON.stringify(clean, null, 2);
  const filename = slug(clean.settings.tripTitle) + "-expenses-" + todayISO() + ".json";
  return new File([json], filename, { type: "application/json" });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function onExport() {
  try {
    const file = exportFile();
    downloadFile(file);
    const count = doc.expenses.length;
    toast("Downloaded " + count + (count === 1 ? " expense." : " expenses."));
  } catch (error) {
    toast(error.message || "Couldn’t export yet. Check the trip title and names.");
  }
}

async function onShare() {
  const file = exportFile();
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: doc.settings.tripTitle + " expenses",
        text: "Trip expenses. Import this file in the trip ledger.",
      });
      return;
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
  }
  downloadFile(file);
  toast("Downloaded the file. Send it by AirDrop or WhatsApp.");
}

async function onImportFile(file) {
  const input = document.getElementById("import-input");
  if (input) input.value = "";
  if (!file) return;
  let text = "";
  try {
    text = await file.text();
  } catch (error) {
    toast("Couldn’t read that file.");
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    toast("That file isn’t valid JSON.");
    return;
  }
  const result = TripSplit.normalizeDocument(parsed);
  if (!result.ok) {
    toast(result.error || "That file isn’t a trip export this app understands.");
    return;
  }
  const count = result.document.expenses.length;
  const title = result.document.settings.tripTitle;
  const ok = await confirmDialog({
    title: "Replace this phone’s data?",
    body:
      "The file “" +
      title +
      "” has " +
      count +
      (count === 1 ? " expense" : " expenses") +
      ". Importing replaces the expenses, names, title, and currency on this phone. Export a backup first if you need to keep this copy.",
    confirmLabel: "Replace data",
    danger: true,
  });
  if (!ok) return;
  const snapshot = savedJSON;
  doc = result.document;
  const saved = persist();
  if (!saved.ok) {
    doc = snapshot ? JSON.parse(snapshot) : doc;
    showBanner(STORAGE_FULL_MSG, "bad");
    toast("The file didn’t fit on this phone, so nothing changed.");
    return;
  }
  const warning = result.warnings && result.warnings[0] ? " " + result.warnings[0] : "";
  if (!doc.people.some((person) => person.id === currentUserId)) {
    currentUserId = null;
    localStorage.removeItem(USER_KEY);
    toast("Imported. Pick your name again." + warning);
    go("#/who");
    return;
  }
  toast("Imported " + count + (count === 1 ? " expense." : " expenses.") + warning);
  onRoute(true);
}

function renderExample() {
  const sample = doc.settings.decimals === 2 ? 120000 : 1200;
  const node = document.getElementById("money-example");
  if (node) node.textContent = "Example: " + TripSplit.formatMoney(sample, doc.settings);
}

function renderStorage() {
  const raw = localStorage.getItem(DOC_KEY) || "";
  const bytes = raw.length * 2;
  const ratio = Math.min(1, bytes / TripSplit.STORAGE_LIMIT_BYTES);
  const fill = document.getElementById("storage-fill");
  fill.style.width = Math.round(ratio * 100) + "%";
  fill.classList.toggle("is-warn", TripSplit.storageLevel(bytes) !== "ok");
  document.getElementById("storage-label").textContent =
    "About " + TripSplit.formatBytes(bytes) + " of ~" + TripSplit.formatBytes(TripSplit.STORAGE_LIMIT_BYTES) + " used on this phone.";
}

function updateNameHint() {
  const names = doc.people.map((person) => person.name.trim()).filter(Boolean);
  const duplicate = names.some((name, index) => names.indexOf(name) !== index);
  const hint = document.getElementById("name-hint");
  hint.hidden = !duplicate;
  hint.textContent = duplicate ? "Two people currently share a name, so settlement lines are harder to tell apart." : "";
}

function renderSettings() {
  document.getElementById("trip-title-input").value = doc.settings.tripTitle;
  document.getElementById("currency-symbol").value = doc.settings.currencySymbol;
  document.getElementById("currency-label-input").value = doc.settings.currencyLabel;
  document.getElementById("decimals").value = String(doc.settings.decimals);
  const box = document.getElementById("people-fields");
  box.replaceChildren();
  doc.people.forEach((person, index) => {
    box.append(
      el(
        "label",
        { class: "name-field" },
        el("span", { class: "name-index", text: String(index + 1).padStart(2, "0") }),
        el("input", {
          type: "text",
          value: person.name,
          maxlength: "40",
          "data-person-id": person.id,
          autocomplete: "off",
          "aria-label": "Name " + (index + 1),
        })
      )
    );
  });
  updateNameHint();
  renderExample();
  renderStorage();
  document.getElementById("share-export").hidden = typeof navigator.share !== "function";
}

async function onDecimalsChange(select) {
  const next = Number(select.value);
  const prev = doc.settings.decimals;
  if (next === prev) return;
  if (next !== 0 && next !== 2) {
    select.value = String(prev);
    return;
  }
  let removed = 0;
  if (next === 0 && doc.expenses.some((item) => item.amount % 100 !== 0)) {
    const ok = await confirmDialog({
      title: "Round to whole amounts?",
      body: "Some expenses use decimals. They’ll be rounded to the nearest whole unit. Anything that rounds to zero is removed.",
      confirmLabel: "Round amounts",
      danger: true,
    });
    if (!ok) {
      select.value = String(prev);
      return;
    }
  }
  const success = commit((state) => {
    if (prev === 0 && next === 2) {
      state.expenses.forEach((item) => {
        item.amount *= 100;
      });
    } else if (prev === 2 && next === 0) {
      const kept = [];
      state.expenses.forEach((item) => {
        item.amount = Math.round(item.amount / 100);
        if (item.amount > 0) kept.push(item);
        else removed += 1;
      });
      state.expenses = kept;
    }
    state.settings.decimals = next;
  });
  if (!success) {
    select.value = String(doc.settings.decimals);
    return;
  }
  renderExample();
  toast(removed ? "Amounts rounded. Removed " + removed + " that became zero." : "Currency format updated.");
}

async function eraseExpenses() {
  if (!doc.expenses.length) {
    toast("There are no expenses to delete.");
    return;
  }
  const ok = await confirmDialog({
    title: "Delete all expenses?",
    body: "Names, the title, and currency stay. Every expense and receipt photo on this phone is removed.",
    confirmLabel: "Delete all",
    danger: true,
  });
  if (!ok) return;
  if (!commit((state) => {
    state.expenses = [];
  })) return;
  toast("All expenses deleted.");
  renderSettings();
}

async function resetNames() {
  const ok = await confirmDialog({
    title: "Restore the original names?",
    body: "The eight names go back to Aaron, Gerri, Michael, Rachel, KD, Karen, Ambrose, and Pearl. Who owes what stays the same.",
    confirmLabel: "Restore names",
    danger: false,
  });
  if (!ok) return;
  if (!commit((state) => {
    state.people.forEach((person, index) => {
      if (TripSplit.DEFAULT_PEOPLE[index]) person.name = TripSplit.DEFAULT_PEOPLE[index].name;
    });
  })) return;
  renderSettings();
  toast("Original names restored.");
}

function savedPersonName(id) {
  try {
    const saved = JSON.parse(savedJSON);
    const person = saved.people.find((item) => item.id === id);
    if (person && person.name) return person.name;
  } catch (error) {
    /* Use the built-in name below. */
  }
  const fallback = TripSplit.DEFAULT_PEOPLE.find((item) => item.id === id);
  return fallback ? fallback.name : "Name";
}

function bind() {
  document.getElementById("expense-form").addEventListener("submit", saveExpense);
  document.getElementById("dialog-cancel").addEventListener("click", () => closeDialog(false));
  document.getElementById("dialog-ok").addEventListener("click", () => closeDialog(true));
  document.getElementById("dialog").addEventListener("click", (event) => {
    if (event.target.id === "dialog") closeDialog(false);
  });
  document.getElementById("lightbox").addEventListener("click", (event) => {
    if (event.target.id === "lightbox" || event.target.closest("[data-action='close-lightbox']")) closeLightbox();
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "pick-user") selectUser(target.dataset.id);
    else if (action === "delete-expense") deleteExpense(target.dataset.id);
    else if (action === "open-receipt") {
      const item = doc.expenses.find((expense) => expense.id === target.dataset.id);
      if (item) openLightbox(item.receipt, item.description);
    } else if (action === "open-draft-receipt") openLightbox(draftReceipt, "Receipt");
    else if (action === "close-lightbox") closeLightbox();
    else if (action === "remove-receipt") removeReceipt();
    else if (action === "select-all") setAllParticipants(true);
    else if (action === "select-none") setAllParticipants(false);
    else if (action === "copy-settlement") copySettlement();
    else if (action === "export") onExport();
    else if (action === "share") onShare();
    else if (action === "erase") eraseExpenses();
    else if (action === "reset-names") resetNames();
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "trip-title-input") {
      doc.settings.tripTitle = target.value.slice(0, 60);
      updateChrome();
      scheduleSave();
    } else if (target.id === "currency-symbol") {
      doc.settings.currencySymbol = target.value.slice(0, 4);
      updateChrome();
      renderExample();
      scheduleSave();
    } else if (target.id === "currency-label-input") {
      doc.settings.currencyLabel = target.value.slice(0, 12);
      updateChrome();
      scheduleSave();
    } else if (target.dataset.personId && target.closest("#people-fields")) {
      const person = doc.people.find((item) => item.id === target.dataset.personId);
      if (person) person.name = target.value.slice(0, 40);
      updateChrome();
      updateNameHint();
      scheduleSave();
    } else if (target.closest("#expense-form")) {
      updatePreview();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "decimals") onDecimalsChange(target);
    else if (target.id === "receipt-input") onReceiptChosen(target.files && target.files[0]);
    else if (target.id === "import-input") onImportFile(target.files && target.files[0]);
    else if (target.closest("#expense-form")) updatePreview();
  });

  document.addEventListener("focusout", (event) => {
    const target = event.target;
    if (target.id === "trip-title-input") {
      const value = target.value.trim().slice(0, 60) || "Japan Trip";
      target.value = value;
      doc.settings.tripTitle = value;
      updateChrome();
      flushSave();
    } else if (target.id === "currency-symbol") {
      const value = target.value.trim().slice(0, 4) || "¥";
      target.value = value;
      doc.settings.currencySymbol = value;
      updateChrome();
      renderExample();
      flushSave();
    } else if (target.id === "currency-label-input") {
      const value = target.value.trim().slice(0, 12) || "JPY";
      target.value = value;
      doc.settings.currencyLabel = value;
      updateChrome();
      flushSave();
    } else if (target.dataset.personId && target.closest("#people-fields")) {
      const person = doc.people.find((item) => item.id === target.dataset.personId);
      const value = target.value.trim().slice(0, 40);
      const next = value || savedPersonName(target.dataset.personId);
      target.value = next;
      if (person) person.name = next;
      updateChrome();
      updateNameHint();
      flushSave();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.getElementById("lightbox").hidden) {
      closeLightbox();
      return;
    }
    if (!document.getElementById("dialog").hidden) closeDialog(false);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });

  window.addEventListener("hashchange", () => {
    flushSave();
    onRoute(false);
  });
}

function registerServiceWorker() {
  const host = location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  if (!("serviceWorker" in navigator) || local || location.protocol.indexOf("http") !== 0) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function init() {
  const loaded = loadDoc();
  doc = loaded.doc;
  try {
    savedJSON = JSON.stringify(TripSplit.serializeDocument(doc));
  } catch (error) {
    savedJSON = JSON.stringify(doc);
  }
  if (!localStorage.getItem(DOC_KEY)) persist();
  currentUserId = localStorage.getItem(USER_KEY);
  if (currentUserId && !doc.people.some((person) => person.id === currentUserId)) {
    currentUserId = null;
    localStorage.removeItem(USER_KEY);
  }
  bind();
  if (!location.hash) location.replace(currentUserId ? "#/expenses" : "#/who");
  else if (!currentUserId && currentRoute().name !== "who") location.replace("#/who");
  onRoute(true);
  if (loaded.recovered) {
    showBanner("Saved data on this phone couldn’t be read, so a fresh ledger was started. Import a backup if you have one.", "bad");
  }
  registerServiceWorker();
}

document.addEventListener("DOMContentLoaded", init);
