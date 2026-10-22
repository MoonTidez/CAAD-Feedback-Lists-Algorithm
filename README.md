# CAAD Feedback Lists Algorithm

A small static site that turns a CSV of student preferences into the order of 1:1 feedback sessions for the CAAD graphic design class. It runs entirely in the browser: no backend, no login, no storage, no analytics. Uploaded files never leave your machine.

**Live site:** _added after the first deploy_

## Running a session

1. After the cutoff, download that session's tab of the class Sheet as CSV (File → Download → Comma-separated values). Keep the date in the file name, for example `Feedback Order - 2026-10-26.csv`.
2. Open the site, choose the file, and check the session date. It fills in from the file name; change it if needed.
3. Pick **Hungarian** or **Boston** and press **Run**. Fix any red errors in the sheet and run again. Read the yellow warnings.
4. Press **Copy for group chat** and paste the order into the class group chat.

The **Compare** tab runs both methods on the same file and date and marks every student whose position or result differs.

Anyone can check an order: the same file, date and method always give the same result.

## CSV format

A header row, then one row per student: a column whose header contains "name", then choice columns headed "1st choice", "2nd choice" … up to "16th choice" (fewer is fine). Each choice cell holds a position number; `3` and `Position 3` both work. The site offers a blank template.

```csv
Name,1st choice,2nd choice,3rd choice,4th choice
Aisha,3,1,,
Ben,3,,,
Chen,,,,
Dana,Position 2,5,2,
```

Cleaning rules, each reported on the page:

| Problem | What happens |
| --- | --- |
| The same name on two rows (ignoring case and extra spaces) | Error, no result |
| More than 16 names | Error, no result |
| Gap in a row (1st and 3rd filled, 2nd empty) | Gap closed, order kept |
| The same position twice in a row | First one kept |
| Position below 1 or above 16 | Ignored |
| A cell with no number in it | Ignored |
| No valid choices | Student kept; any position is fine for them |
| Row with no name | Ignored |

## How it works

Both methods match students to positions 1 to P, where P is the larger of the class size and the highest position anyone listed. Empty positions are then removed and the rest renumbered 1 to M, so someone who asked for 14 in a class of 12 still goes last.

Every random choice comes from one generator seeded with the session date (cyrb128 hash into mulberry32). Students are sorted by name before any draw, so row order in the CSV can't change the result.

- **Hungarian:** minimises the total cost, where getting your k-th choice costs k², and any position you didn't list costs (L+1)² for a list of length L. Tiny seeded noise (under 0.001 per cell) breaks ties between equally good answers. Kuhn–Munkres, O(n³).
- **Boston:** round k gives each waiting student's k-th choice to them if they're the only applicant, or to a seeded draw winner if several apply. Positions already taken are skipped. Anyone left over is shuffled into the free positions. The audit log on the page shows every round.

## Files

| File | Purpose |
| --- | --- |
| `scheduler.js` | Seeded generator, both modes, renumbering and stats |
| `parse.js` | Rows to a clean student list with warnings and errors; date from file name |
| `app.js` | UI wiring: file input, Papa Parse, rendering, copy and downloads |
| `index.html`, `faq.html`, `styles.css` | The pages |
| `tests/` | Node tests and fixture CSVs |

`scheduler.js` and `parse.js` are pure functions with no DOM or imports. They load with a plain `<script>` tag, in Node, or pasted into Google Apps Script. The entry point is:

```js
assign(students, { mode: "hungarian" | "boston", seed: "2026-10-26" })
// -> { order: [{ position, originalPosition, name, rank }], stats, log }
```

In Apps Script, paste `parse.js` and `scheduler.js` as two script files, turn the sheet's values into an array of string arrays (`sheet.getDataRange().getDisplayValues()`), and call `parseRows(rows)` then `assign(result.students, { mode, seed })`.

## Tests

Needs Node 18 or later; no npm packages.

```bash
npm test
```

To try the pages locally, serve the folder (for example `python3 -m http.server`) and open `http://localhost:8000`.

## Decisions

Choices made where the brief was silent:

- **One shared input panel.** Run and Compare use the same file and date fields; the method choice hides on the Compare tab. Switching tabs re-runs with the loaded file.
- **Results run on demand.** Choosing a file fills in the date but nothing runs until you press Run.
- **Empty lists get their own label.** A student who listed nothing shows "No choices listed" rather than "Not on list", and the stats count them separately ("Listed no choices") so "Placed off their list" only counts students who listed something.
- **"Differs" in Compare** means a different final position or a different result label.
- **Name sort uses a fixed locale.** `localeCompare` runs with the `en` locale at base sensitivity, with a plain code-point comparison as a tie-break, so the order is identical in every browser and in Node regardless of the viewer's language.
- **Unreadable cells warn.** A choice cell with no integer counts as empty, as the brief says, and also shows a warning so typos are visible.
- **Nameless rows warn** if they contain anything; fully blank rows are skipped silently.
- **Missing name or choice columns are errors**, since nothing sensible can be produced.
- **Duplicate choice columns** (two "2nd choice" headers) keep the first and warn.
- **Row numbers** in messages count the header as row 1, matching the spreadsheet.
- **Boston lotteries draw only when contested.** A position with one applicant uses no random number.
- **Dummy rows in Hungarian get no noise.** Noise on the real students' cells is enough to break every tie.
- **Downloads** are UTF-8 CSV with a byte-order mark so Excel shows accented names correctly. The result file is named `Feedback Order Result - <date> (<method>).csv`.
- **Papa Parse 5.4.1** is loaded from cdnjs with a subresource-integrity hash.
- **Look and feel** follows Apple's Human Interface Guidelines for accessibility: system fonts at 17px, 44px tap targets, 4.5:1 text contrast in both themes, and "differs" marked with a label as well as colour.
