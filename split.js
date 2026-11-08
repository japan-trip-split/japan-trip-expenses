/* Shared trip math and the { people, expenses, settings } document.
   Amounts are integers in minor units: whole yen for JPY (decimals 0),
   cents for HKD (decimals 2). Each expense carries its own currency. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TripSplit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CATEGORIES = [
    "Food",
    "Transport",
    "Accommodation",
    "Activities/Tickets",
    "Shopping",
    "Other",
  ];

  const DEFAULT_PEOPLE = [
    { id: "aaron", name: "Aaron" },
    { id: "gerri", name: "Gerri" },
    { id: "michael", name: "Michael" },
    { id: "rachel", name: "Rachel" },
    { id: "kd", name: "KD" },
    { id: "karen", name: "Karen" },
    { id: "ambrose", name: "Ambrose" },
    { id: "pearl", name: "Pearl" },
  ];

  const CURRENCIES = {
    JPY: { code: "JPY", symbol: "¥", label: "JPY", decimals: 0 },
    HKD: { code: "HKD", symbol: "HK$", label: "HKD", decimals: 2 },
  };

  const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

  function currencyMeta(code) {
    return CURRENCIES[code === "HKD" ? "HKD" : "JPY"];
  }

  function normalizeCurrencyCode(value) {
    return value === "HKD" ? "HKD" : "JPY";
  }

  function defaultCurrencyFromSettings(settings) {
    if (!settings || typeof settings !== "object") return "JPY";
    if (settings.defaultCurrency === "HKD" || settings.defaultCurrency === "JPY") {
      return settings.defaultCurrency;
    }
    if (settings.currencyLabel === "HKD") return "HKD";
    return "JPY";
  }

  function settingsForCurrency(code) {
    const meta = currencyMeta(code);
    return {
      currencySymbol: meta.symbol,
      currencyLabel: meta.label,
      decimals: meta.decimals,
      defaultCurrency: meta.code,
    };
  }

  function createDocument(now) {
    const stamp = now || new Date().toISOString();
    return {
      people: DEFAULT_PEOPLE.map((person) => ({ id: person.id, name: person.name })),
      expenses: [],
      settings: {
        version: 1,
        tripTitle: "Japan Trip",
        currencySymbol: "¥",
        currencyLabel: "JPY",
        decimals: 0,
        defaultCurrency: "JPY",
        updatedAt: stamp,
      },
    };
  }

  function normalizeNumericInput(value) {
    return String(value == null ? "" : value)
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[，,]/g, "")
      .replace(/．/g, ".")
      .replace(/[^\d.]/g, "");
  }

  function parseMoney(input, decimals) {
    const normalized = normalizeNumericInput(input);
    if (!normalized || normalized === ".") {
      return { ok: false, error: "Enter an amount greater than zero." };
    }
    const pieces = normalized.split(".");
    if (pieces.length > 2) return { ok: false, error: "Enter a valid amount." };
    const whole = pieces[0] === "" ? "0" : pieces[0];
    if (!/^\d+$/.test(whole)) return { ok: false, error: "Enter a valid amount." };
    const frac = pieces[1] || "";
    if (decimals === 0) {
      if (frac.length) {
        return { ok: false, error: "Use a whole number. This currency doesn’t use decimals." };
      }
      const amount = Number(whole);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return { ok: false, error: "Enter an amount greater than zero." };
      }
      if (amount > 100000000) return { ok: false, error: "That amount is too large." };
      return { ok: true, amount };
    }
    if (frac.length > 2) return { ok: false, error: "Use at most two decimal places." };
    const frac2 = (frac + "00").slice(0, 2);
    const amount = Number(whole) * 100 + Number(frac2);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return { ok: false, error: "Enter an amount greater than zero." };
    }
    if (amount > 10000000000) return { ok: false, error: "That amount is too large." };
    return { ok: true, amount };
  }

  function formatMoney(amount, settingsOrCurrency) {
    let symbol = "";
    let decimals = 0;
    if (typeof settingsOrCurrency === "string") {
      const meta = currencyMeta(settingsOrCurrency);
      symbol = meta.symbol;
      decimals = meta.decimals;
    } else if (settingsOrCurrency && typeof settingsOrCurrency === "object") {
      if (settingsOrCurrency.code === "JPY" || settingsOrCurrency.code === "HKD" || (settingsOrCurrency.symbol != null && settingsOrCurrency.currencySymbol == null)) {
        symbol = settingsOrCurrency.symbol || "";
        decimals = settingsOrCurrency.decimals === 2 ? 2 : 0;
      } else {
        symbol = settingsOrCurrency.currencySymbol || "";
        decimals = settingsOrCurrency.decimals === 2 ? 2 : 0;
      }
    }
    const negative = amount < 0;
    const abs = Math.abs(Number(amount) || 0);
    let body;
    if (decimals === 2) {
      const whole = Math.floor(abs / 100);
      const frac = abs % 100;
      body = whole.toLocaleString("en-US") + "." + String(frac).padStart(2, "0");
    } else {
      body = Math.round(abs).toLocaleString("en-US");
    }
    return (negative ? "-" : "") + symbol + body;
  }

  function minorToInput(amount, decimals) {
    if (decimals === 2) {
      const abs = Math.abs(amount);
      const whole = Math.floor(abs / 100);
      const frac = abs % 100;
      const body = frac === 0 ? String(whole) : whole + "." + String(frac).padStart(2, "0");
      return amount < 0 ? "-" + body : body;
    }
    return String(amount);
  }

  function allocate(amount, parts) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error("amount must be a non-negative integer");
    }
    if (!parts.length) return [];
    const scaled = parts.map((part, index) => {
      const weight = Math.round(Number(part.weight) * 1000);
      if (!Number.isInteger(weight) || weight <= 0) throw new Error("weight must be positive");
      return { id: part.id, order: part.order ?? index, weight };
    });
    const totalWeight = scaled.reduce((sum, part) => sum + part.weight, 0);
    const amountB = BigInt(amount);
    const totalB = BigInt(totalWeight);
    const floors = scaled.map((part) => Number((amountB * BigInt(part.weight)) / totalB));
    let remainder = amount - floors.reduce((sum, n) => sum + n, 0);
    const ranked = scaled.map((part, index) => ({
      index,
      rem: (amountB * BigInt(part.weight)) % totalB,
      order: part.order,
    }));
    ranked.sort((a, b) => {
      if (a.rem === b.rem) return a.order - b.order;
      return a.rem > b.rem ? -1 : 1;
    });
    let cursor = 0;
    while (remainder > 0 && cursor < amount + scaled.length + 2) {
      floors[ranked[cursor % ranked.length].index] += 1;
      remainder -= 1;
      cursor += 1;
    }
    return scaled.map((part, index) => ({ id: part.id, amount: floors[index] }));
  }

function sharesForExpense(expense, people) {
  const orderOf = new Map(people.map((person, index) => [person.id, index]));
  const parts = (expense.parts || [])
    .filter((part) => orderOf.has(part.personId) && Number(part.weight) > 0)
    .map((part) => ({
      id: part.personId,
      weight: Number(part.weight),
      order: orderOf.get(part.personId),
    }))
    .sort((a, b) => a.order - b.order);
  return allocate(expense.amount, parts);
}

  function computeBalances(people, expenses) {
    const paid = new Map(people.map((person) => [person.id, 0]));
    const share = new Map(people.map((person) => [person.id, 0]));
    for (const expense of expenses) {
      if (paid.has(expense.payerId)) {
        paid.set(expense.payerId, paid.get(expense.payerId) + expense.amount);
      }
      for (const row of sharesForExpense(expense, people)) {
        share.set(row.id, (share.get(row.id) || 0) + row.amount);
      }
    }
    return people.map((person) => {
      const paidAmount = paid.get(person.id) || 0;
      const shareAmount = share.get(person.id) || 0;
      return {
        id: person.id,
        name: person.name,
        paid: paidAmount,
        share: shareAmount,
        net: paidAmount - shareAmount,
      };
    });
  }

  function expensesForCurrency(expenses, code) {
    const currency = normalizeCurrencyCode(code);
    return (expenses || []).filter((expense) => normalizeCurrencyCode(expense && expense.currency) === currency);
  }

  function settle(balances) {
    const creditors = balances
      .filter((row) => row.net > 0)
      .map((row) => ({ id: row.id, name: row.name, left: row.net }))
      .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, "en"));
    const debtors = balances
      .filter((row) => row.net < 0)
      .map((row) => ({ id: row.id, name: row.name, left: -row.net }))
      .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, "en"));
    const payments = [];
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const amount = Math.min(debtors[debtorIndex].left, creditors[creditorIndex].left);
      if (amount <= 0) break;
      payments.push({
        fromId: debtors[debtorIndex].id,
        fromName: debtors[debtorIndex].name,
        toId: creditors[creditorIndex].id,
        toName: creditors[creditorIndex].name,
        amount,
      });
      debtors[debtorIndex].left -= amount;
      creditors[creditorIndex].left -= amount;
      if (debtors[debtorIndex].left === 0) debtorIndex += 1;
      if (creditors[creditorIndex].left === 0) creditorIndex += 1;
    }
    return payments;
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    if (year < 2000 || year > 2100) return false;
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function cleanReceipt(value) {
    if (typeof value !== "string") return null;
    const match = /^data:image\/(jpeg|jpg|png|webp);base64,([a-z0-9+/=\r\n]+)$/i.exec(value.trim());
    if (!match) return null;
    const body = match[2].replace(/\s/g, "");
    if (body.length < 32 || body.length > 1500000) return null;
    const subtype = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
    return "data:image/" + subtype + ";base64," + body;
  }

  function isSafeImage(value) {
    return typeof value === "string" && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value);
  }

  function expenseLabel(raw, index) {
    if (raw && typeof raw.description === "string" && raw.description.trim()) {
      return "“" + raw.description.trim().slice(0, 40) + "”";
    }
    return "expense " + (index + 1);
  }

  function normalizeExpense(raw, people, index, warnings) {
    const label = expenseLabel(raw, index);
    if (!raw || typeof raw !== "object") return { ok: false, error: "Couldn’t read " + label + "." };
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    if (!description) return { ok: false, error: label + ": add a description." };
    if (description.length > 200) {
      return { ok: false, error: label + ": keep the description under 200 characters." };
    }
    if (!Number.isInteger(raw.amount) || raw.amount <= 0) {
      return { ok: false, error: label + ": the amount needs to be a positive whole number." };
    }
    if (raw.amount > 10000000000) return { ok: false, error: label + ": that amount is too large." };
    if (!CATEGORIES.includes(raw.category)) return { ok: false, error: label + ": choose a category." };
    if (!isValidDate(raw.date)) return { ok: false, error: label + ": choose a valid date." };
    const known = new Set(people.map((person) => person.id));
    if (typeof raw.payerId !== "string" || !known.has(raw.payerId)) {
      return { ok: false, error: label + ": choose who paid." };
    }
    if (!Array.isArray(raw.parts) || raw.parts.length === 0) {
      return { ok: false, error: label + ": choose at least one person to share it." };
    }
    const parts = [];
    const seen = new Set();
    for (const part of raw.parts) {
      if (!part || typeof part.personId !== "string" || !known.has(part.personId)) {
        return { ok: false, error: label + ": someone on the split isn’t on the trip." };
      }
      if (seen.has(part.personId)) {
        return { ok: false, error: label + ": each person can only be listed once." };
      }
      seen.add(part.personId);
      const weight = Math.round(Number(part.weight) * 1000) / 1000;
      if (!(weight > 0) || weight > 1000) {
        return { ok: false, error: label + ": each ratio needs to be greater than zero." };
      }
      parts.push({ personId: part.personId, weight });
    }
    parts.sort(
      (a, b) => people.findIndex((person) => person.id === a.personId) - people.findIndex((person) => person.id === b.personId)
    );
    let split = raw.split === "custom" || raw.split === "equal" ? raw.split : null;
    if (!split) split = parts.every((part) => part.weight === 1) ? "equal" : "custom";
    if (split === "equal") parts.forEach((part) => {
      part.weight = 1;
    });
    let receipt = null;
    if (raw.receipt) {
      receipt = cleanReceipt(raw.receipt);
      if (!receipt) warnings.push("A receipt photo on " + label + " was skipped because it wasn’t a usable image.");
    }
    if (typeof raw.id !== "string" || !/^[\w-]{1,80}$/.test(raw.id)) {
      return { ok: false, error: label + ": has an invalid id." };
    }
    const currency = normalizeCurrencyCode(raw.currency);
    const now = new Date().toISOString();
    return {
      ok: true,
      expense: {
        id: raw.id,
        description,
        amount: raw.amount,
        currency,
        category: raw.category,
        date: raw.date,
        payerId: raw.payerId,
        split,
        parts,
        receipt,
        createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : now,
      },
    };
  }

  function validateDraft(draft, people) {
    if (!draft || !String(draft.description || "").trim()) return "Add a short description.";
    if (String(draft.description).trim().length > 200) return "Keep the description under 200 characters.";
    if (!draft.validParse) return draft.amountError || "Enter an amount greater than zero.";
    if (!Number.isInteger(draft.amount) || draft.amount <= 0) return "Enter an amount greater than zero.";
    if (!CATEGORIES.includes(draft.category)) return "Choose a category.";
    if (!isValidDate(draft.date)) return "Choose a date.";
    const known = new Set(people.map((person) => person.id));
    if (!known.has(draft.payerId)) return "Choose who paid.";
    if (!Array.isArray(draft.parts) || draft.parts.length === 0) return "Choose at least one person to share this.";
    const seen = new Set();
    for (const part of draft.parts) {
      if (!known.has(part.personId)) return "Someone on this split isn’t on the trip.";
      if (seen.has(part.personId)) return "Each person can only be listed once.";
      seen.add(part.personId);
      const weight = Number(part.weight);
      if (!(weight > 0) || weight > 1000) return "Each selected person needs a ratio greater than zero.";
    }
    return null;
  }

  function normalizeSettings(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "Settings are missing." };
    }
    if (raw.version != null && Number(raw.version) > 1) {
      return { ok: false, error: "This file is from a newer version of the ledger." };
    }
    const tripTitle = typeof raw.tripTitle === "string" ? raw.tripTitle.trim().slice(0, 60) : "";
    if (!tripTitle) return { ok: false, error: "The trip title is missing." };
    const currencySymbol = typeof raw.currencySymbol === "string" ? raw.currencySymbol.trim().slice(0, 4) : "";
    if (!currencySymbol) return { ok: false, error: "The currency symbol is missing." };
    const currencyLabel = typeof raw.currencyLabel === "string" ? raw.currencyLabel.trim().slice(0, 12) : "";
    if (!currencyLabel) return { ok: false, error: "The currency label is missing." };
    let decimals = raw.decimals;
    if (decimals === "0") decimals = 0;
    if (decimals === "2") decimals = 2;
    if (decimals !== 0 && decimals !== 2) return { ok: false, error: "Decimals must be 0 or 2." };
    const defaultCurrency = defaultCurrencyFromSettings({
      defaultCurrency: raw.defaultCurrency,
      currencyLabel,
    });
    const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : new Date().toISOString();
    return {
      ok: true,
      settings: {
        version: 1,
        tripTitle,
        currencySymbol,
        currencyLabel,
        decimals,
        defaultCurrency,
        updatedAt,
      },
    };
  }

  function normalizeDocument(input) {
    const warnings = [];
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, error: "That file isn’t a trip ledger export." };
    }
    if (!Array.isArray(input.people) || !Array.isArray(input.expenses) || !input.settings || typeof input.settings !== "object") {
      return { ok: false, error: "The file needs people, expenses, and settings." };
    }
    if (input.people.length !== 8) return { ok: false, error: "This ledger is for exactly 8 people." };
    const people = [];
    const ids = new Set();
    for (let index = 0; index < input.people.length; index += 1) {
      const person = input.people[index];
      if (!person || typeof person !== "object") return { ok: false, error: "Person " + (index + 1) + " couldn’t be read." };
      const id = typeof person.id === "string" ? person.id.trim() : "";
      const name = typeof person.name === "string" ? person.name.trim().slice(0, 40) : "";
      if (!/^[\w-]{1,64}$/.test(id)) return { ok: false, error: "Person " + (index + 1) + " has an invalid id." };
      if (!name) return { ok: false, error: "Person " + (index + 1) + " needs a name." };
      if (ids.has(id)) return { ok: false, error: "Two people share the same id." };
      ids.add(id);
      people.push({ id, name });
    }
    const settingsResult = normalizeSettings(input.settings);
    if (!settingsResult.ok) return settingsResult;
    if (input.expenses.length > 1000) return { ok: false, error: "This file has too many expenses." };
    const expenses = [];
    const expenseIds = new Set();
    for (let index = 0; index < input.expenses.length; index += 1) {
      const result = normalizeExpense(input.expenses[index], people, index, warnings);
      if (!result.ok) return result;
      if (expenseIds.has(result.expense.id)) {
        return { ok: false, error: "Two expenses use the id " + result.expense.id + "." };
      }
      expenseIds.add(result.expense.id);
      expenses.push(result.expense);
    }
    return {
      ok: true,
      warnings,
      document: {
        people,
        expenses,
        settings: settingsResult.settings,
      },
    };
  }

  function serializeDocument(doc) {
    const normalized = normalizeDocument(doc);
    if (!normalized.ok) {
      const error = new Error(normalized.error || "Couldn’t prepare the ledger.");
      error.soft = /needs a name|title is missing|currency/i.test(normalized.error || "");
      throw error;
    }
    return normalized.document;
  }

  function storageLevel(bytes) {
    if (bytes >= STORAGE_LIMIT_BYTES * 0.92) return "full";
    if (bytes >= STORAGE_LIMIT_BYTES * 0.75) return "warn";
    return "ok";
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  return {
    CATEGORIES,
    DEFAULT_PEOPLE,
    CURRENCIES,
    STORAGE_LIMIT_BYTES,
    createDocument,
    currencyMeta,
    normalizeCurrencyCode,
    defaultCurrencyFromSettings,
    settingsForCurrency,
    normalizeNumericInput,
    parseMoney,
    formatMoney,
    minorToInput,
    allocate,
    sharesForExpense,
    computeBalances,
    expensesForCurrency,
    settle,
    isValidDate,
    cleanReceipt,
    isSafeImage,
    validateDraft,
    normalizeDocument,
    serializeDocument,
    storageLevel,
    formatBytes,
  };
});
