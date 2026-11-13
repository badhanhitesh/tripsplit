# TripSplit

A simple trip expense tracker and money splitter for friends and family. Amounts are in INR (₹).

**Live app:** https://badhanhitesh.github.io/tripsplit/

Create a trip, add people, record who paid for what, and TripSplit works out each person's share,
who owes whom, and the easiest way to settle.

## What it does

- Trips with a destination, dates and any number of people
- Expenses with a payer, category, date and notes
- Equal split, or a custom split by amount or by percent, among only the people who took part
- Balances per person: `balance = paid − share` (green gets money back, red needs to pay)
- Three ways to settle, shown side by side with a recommendation:
  1. **Pay each other** with the fewest possible payments
  2. **Trip Treasurer**: everyone who owes pays one person, who pays everyone who is owed
  3. **Common trip fund**: collect an agreed amount up front, pay bills from the pot, refund what is left
- Mark payments as paid, record part payments, undo them
- Expense history with filters by person, category and date
- Trip report as Excel, PDF or copyable text

## Where the data lives

On this website, trips are saved in your browser (`localStorage`). They survive a refresh, but they
stay on that one device and browser: nothing is sent to a server, and other people opening the link
see their own separate data. Use the report export or **Copy summary** to share results with the group.

## How the numbers are kept right

- All money is stored as whole paise, so decimals never drift.
- Leftover paise from a split are handed out one at a time, so shares always add up to the expense.
- Fund contributions are transfers, not expenses, so nothing is counted twice.
- Settlement payments are kept in their own list and never change the expense records.
- The total owed always equals the total receivable. The tests check this on 400 random trips, and
  check that every settlement method brings every balance to zero.

"Pay each other" finds the true minimum number of payments while up to 16 balances are open, and
uses a close approximation above that.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | The built app, a single self-contained page. This is what GitHub Pages serves. |
| `src/engine.ts` | All calculations: splits, balances, the three settlement methods. No UI. |
| `src/app.tsx` | The interface (React). |
| `src/store.ts` | Saving and loading trips. |
| `src/export.ts` | Excel, PDF and text reports. |
| `src/demo.ts` | The three example trips. |
| `test/engine.test.ts` | Tests for the calculation engine. |
| `build.mjs` | Bundles everything into `index.html` (esbuild + Tailwind CSS). |

## Develop

```bash
npm install
npm test        # run the calculation tests
npm run build   # rebuild index.html
```

Then open `index.html` in a browser. Commit the rebuilt `index.html` to publish a change.

Built with React, TypeScript and Tailwind CSS.
