# Japan Trip expenses

A phone-first ledger for eight people sharing costs on a trip. It runs as a static site: no account, no server, no analytics. Each phone keeps its own copy in the browser. The group syncs by passing around one JSON file.

The travellers start as **Aaron, Gerri, Michael, Rachel, KD, Karen, Ambrose, and Pearl**. Names and the trip title can be changed in Settings.

## Use it on a phone

1. Open the site and tap your name. This phone remembers that choice.
2. Tap **Add expense**. Enter what was spent, the amount, a category, and the date.
3. Choose **who paid** (the person who covered the cost). That can be someone else, and they do not have to be part of the split.
4. Leave everyone checked for an equal split across all 8, or uncheck people who were not there. **Custom ratios** are available when the shares should not be equal: `1`, `1`, and `2` means the third person covers twice as much.
5. Add a receipt photo if you have one. It is compressed (about 1200px wide, JPEG) and stored on the phone. Tap the thumbnail later to see the full image.
6. **Balances** shows what each person paid, their share, and their net. A positive net means the group owes them.
7. **Settle** lists the shortest set of payments that brings everyone back to zero. Pay those in cash. Do not add a repayment as an expense — that would count the money twice.

When a bill does not divide evenly, the extra yen goes to the earliest names on the list. The share preview on the expense shows the exact numbers before you save.

You can edit or delete any expense. **Delete all expenses** in Settings keeps the names and the title.

## Phones do not sync by themselves

There is no server. Nothing you type is uploaded. Until someone exports a file and someone else imports it, each phone has its own copy.

To share the book:

1. On the phone with the latest expenses, open **Settings** and tap **Export JSON** (or **Share file**, which opens the phone’s share sheet for AirDrop or WhatsApp).
2. Send that file to the group.
3. On the other phone, open **Settings** and tap **Import JSON**.
4. Import **replaces** that phone’s expenses, names, title, and currency. If that phone has expenses the file does not, export a backup first.

The chosen name (who is “adding as”) stays on the device. It is not inside the shared file.

## Receipt photos and storage

Photos live inside the expense, as a compressed JPEG data URL. Browsers usually allow about 5 MB for this site. The Settings screen shows roughly how much of that is used. When it gets full, the app warns you instead of failing silently. Export a backup, then delete receipt photos you no longer need.

## The saved file

Export, import, and the on-phone copy all use the same JSON document. The root has **exactly three keys**: `people`, `expenses`, and `settings`.

```json
{
  "people": [
    { "id": "aaron", "name": "Aaron" },
    { "id": "gerri", "name": "Gerri" },
    { "id": "michael", "name": "Michael" },
    { "id": "rachel", "name": "Rachel" },
    { "id": "kd", "name": "KD" },
    { "id": "karen", "name": "Karen" },
    { "id": "ambrose", "name": "Ambrose" },
    { "id": "pearl", "name": "Pearl" }
  ],
  "expenses": [
    {
      "id": "0b1d0a2e-7c1a-4e0a-9a55-2f0a9d8e6c11",
      "description": "Ramen in Dotonbori",
      "amount": 8000,
      "category": "Food",
      "date": "2026-11-08",
      "payerId": "aaron",
      "split": "equal",
      "parts": [
        { "personId": "aaron", "weight": 1 },
        { "personId": "gerri", "weight": 1 }
      ],
      "receipt": null,
      "createdAt": "2026-11-08T12:00:00.000Z",
      "updatedAt": "2026-11-08T12:00:00.000Z"
    }
  ],
  "settings": {
    "version": 1,
    "tripTitle": "Japan Trip",
    "currencySymbol": "¥",
    "currencyLabel": "JPY",
    "decimals": 0,
    "updatedAt": "2026-11-08T12:00:00.000Z"
  }
}
```

| Field | Meaning |
| --- | --- |
| `people` | Exactly 8 people, in list order. `id` stays put when a name is edited, so old expenses still point at the right person. |
| `expenses[].amount` | Integer in minor units. With whole yen (`settings.decimals` is `0`), `8000` means ¥8,000. With two decimals, `8000` means 80.00. |
| `expenses[].payerId` | Who paid. They can be absent from `parts` if they covered a cost they do not share. |
| `expenses[].split` | `equal` or `custom`. |
| `expenses[].parts` | Who shares the expense. `weight` is the ratio (`1` for an equal split). |
| `expenses[].category` | One of `Food`, `Transport`, `Accommodation`, `Activities/Tickets`, `Shopping`, `Other`. |
| `expenses[].receipt` | `null`, or a compressed image as a `data:image/jpeg;base64,...` URL (PNG and WebP are accepted on import). |
| `settings.tripTitle` | Shown in the header. Starts as `Japan Trip`. |
| `settings.currencySymbol` / `currencyLabel` | Defaults `¥` and `JPY`. The book is one currency; there is no exchange-rate conversion. |
| `settings.decimals` | `0` for whole amounts, `2` for cents. |
| `settings.version` | `1`. Newer files are refused so an old page does not misread them. |

On the phone, that document is stored under the localStorage key `japan-trip-ledger-v1`. The selected person is a separate key, `japan-trip-user-v1`, and is not exported.

### How a net is calculated

For each person, **net = total they paid − their share of expenses they were included in**. Settle then matches the largest debts to the largest credits until every net is zero. That is a short list of payments (at most one fewer than the number of people), not a record of each IOU.

## Japanese labels

English is the interface. Short Japanese sits beside it: 支出 expenses, 収支 balances, 精算 settle, 設定 settings, 食事 food, 交通 transport, 宿泊 accommodation, 観光 activities/tickets, 買物 shopping, その他 other. The page uses the phone’s own fonts, including Japanese system fonts, so it still works offline.

## Open it on this computer

From this folder:

```bash
python3 -m http.server 47321
```

Then open [http://127.0.0.1:47321/](http://127.0.0.1:47321/).

Opening `index.html` directly also works for adding expenses. A local server is a better match for Add to Home Screen. The offline cache is only registered on the public HTTPS site, not on localhost, so refreshes during a local preview stay current.

To re-run the settlement checks:

```bash
node --test test/split.test.js
```

## Publish on GitHub Pages

This project does not create the GitHub repository for you. Do that in GitHub, then:

1. Create a **new public repository**. Free GitHub Pages for a project site expects a public repo. Do not put the site in an extra subfolder.
2. Upload these files to the **repository root**: `index.html`, `styles.css`, `app.js`, `split.js`, `sw.js`, `manifest.webmanifest`, `seigaiha.svg`, `favicon.svg`, `icon-192.png`, `icon-512.png`, `.nojekyll`, and `README.md`.
3. Commit them on the **`main`** branch (or push this project if you already connected it).
4. On GitHub, open the repository → **Settings** → **Pages**.
5. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
6. Set **Branch** to **`main`** and the folder to **`/ (root)`**. Save.
7. Wait until the Pages panel shows the site is live. The address looks like:

   `https://<user>.github.io/<repo>/`

   Example: GitHub user `aaron` and repository `japan-trip` → `https://aaron.github.io/japan-trip/`.

8. Open that URL on each phone. In the browser menu, use **Add to Home Screen** so it opens like an app. After one successful visit, the app shell can open again if the network drops. The expenses on that phone stay in the phone’s storage either way.
9. Send the link to the group. Remind them to export and import when they want everyone looking at the same book.

`.nojekyll` is included so GitHub Pages serves the files as-is and does not run Jekyll.

Paths in the site are relative, so the same folder works at a project URL (`https://<user>.github.io/<repo>/`) and at a local server.
