// CAAD Feedback Lists Algorithm: CSV rows to a clean student list.
// Pure functions only: no DOM, no imports, no browser APIs. Works as a plain
// <script>, pasted into Google Apps Script, or loaded in Node.

const MAX_STUDENTS = 16;
const MAX_POSITION = 16;

function normaliseName(name) {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

function isBlank(cell) {
  return cell == null || String(cell).trim() === "";
}

// "3" -> 3, "Position 3" -> 3, anything without an integer -> null.
function readPosition(cell) {
  if (isBlank(cell)) return null;
  const m = String(cell).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// The ordinal in a header such as "1st choice" or "16TH Choice", or null.
function headerOrdinal(header) {
  const m = String(header).match(/(\d+)\s*(st|nd|rd|th)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

function listRows(rows) {
  if (rows.length === 1) return "row " + rows[0];
  return "rows " + rows.slice(0, -1).join(", ") + " and " + rows[rows.length - 1];
}

// rows: array of string arrays, header first. Row numbers in messages match a
// spreadsheet, so the header is row 1.
// Returns { students: [{ name, choices }], warnings: [string], errors: [string] }.
function parseRows(rows) {
  const warnings = [];
  const errors = [];
  if (!rows || !rows.length) return { students: [], warnings: warnings, errors: ["The file is empty."] };

  const header = rows[0].map(function (h) { return String(h == null ? "" : h); });
  let nameCol = -1;
  for (let c = 0; c < header.length; c++) {
    if (/name/i.test(header[c])) { nameCol = c; break; }
  }
  if (nameCol === -1) errors.push('No name column found. One header must contain "name".');

  // Choice columns ordered by their ordinal, not by where they sit.
  const choiceCols = [];
  const seenOrdinals = {};
  for (let c = 0; c < header.length; c++) {
    if (c === nameCol) continue;
    const ord = headerOrdinal(header[c]);
    if (ord === null || ord < 1 || ord > MAX_POSITION) continue;
    if (seenOrdinals[ord]) {
      warnings.push('Column "' + header[c].trim() + '" repeats an earlier choice column; ignored it.');
      continue;
    }
    seenOrdinals[ord] = true;
    choiceCols.push({ col: c, ord: ord });
  }
  choiceCols.sort(function (a, b) { return a.ord - b.ord; });
  if (nameCol !== -1 && !choiceCols.length) errors.push('No choice columns found. Headers should read "1st choice", "2nd choice" and so on.');
  if (errors.length) return { students: [], warnings: warnings, errors: errors };

  const students = [];
  const rowsByKey = {};
  const keyOrder = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rowNum = r + 1;
    if (row.every(isBlank)) continue;
    const rawName = row[nameCol];
    if (isBlank(rawName)) {
      warnings.push("Row " + rowNum + " has no name; ignored it.");
      continue;
    }
    const name = String(rawName).trim();
    const key = normaliseName(name);
    if (!rowsByKey[key]) { rowsByKey[key] = { name: name, rows: [] }; keyOrder.push(key); }
    rowsByKey[key].rows.push(rowNum);

    const choices = [];
    let sawGap = false;
    let gapWarned = false;
    for (let i = 0; i < choiceCols.length; i++) {
      const cell = row[choiceCols[i].col];
      const label = header[choiceCols[i].col].trim();
      if (isBlank(cell)) { sawGap = true; continue; }
      const pos = readPosition(cell);
      if (pos === null) {
        warnings.push(name + ': couldn\'t read "' + String(cell).trim() + '" in ' + label + "; ignored it.");
        sawGap = true;
        continue;
      }
      if (sawGap && !gapWarned) {
        warnings.push(name + ": gap in their list before " + label + "; closed it and kept the order.");
        gapWarned = true;
      }
      if (pos < 1 || pos > MAX_POSITION) {
        warnings.push(name + ": position " + pos + " in " + label + " is outside 1–" + MAX_POSITION + "; ignored it.");
        continue;
      }
      if (choices.indexOf(pos) !== -1) {
        warnings.push(name + ": position " + pos + " is listed twice; kept the first.");
        continue;
      }
      choices.push(pos);
    }
    if (!choices.length) warnings.push(name + " has no valid choices; any position is fine for them.");
    students.push({ name: name, choices: choices });
  }

  for (let k = 0; k < keyOrder.length; k++) {
    const entry = rowsByKey[keyOrder[k]];
    if (entry.rows.length > 1) errors.push('The name "' + entry.name + '" appears on ' + listRows(entry.rows) + ". Each student needs exactly one row.");
  }
  if (students.length > MAX_STUDENTS) errors.push("There are " + students.length + " names; the limit is " + MAX_STUDENTS + ".");
  if (!students.length && !errors.length) errors.push("No students found in the file.");
  if (errors.length) return { students: [], warnings: warnings, errors: errors };
  return { students: students, warnings: warnings, errors: errors };
}

// The first valid YYYY-MM-DD in a file name, or null.
function dateFromFileName(fileName) {
  const re = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
  let m;
  while ((m = re.exec(String(fileName || ""))) !== null) {
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return m[0];
  }
  return null;
}

function formatDate(date) {
  const pad = function (n) { return (n < 10 ? "0" : "") + n; };
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

// Session date for an uploaded file. today is a Date; defaults to now.
// Returns { date: "YYYY-MM-DD", source: "file" | "today", warning: string | null }.
function sessionDate(fileName, today) {
  const found = dateFromFileName(fileName);
  if (found) return { date: found, source: "file", warning: null };
  const date = formatDate(today || new Date());
  return { date: date, source: "today", warning: "No date found in the file name, so the date is set to today (" + date + "). Change it if this is for another session." };
}

if (typeof module !== "undefined") module.exports = { normaliseName, readPosition, headerOrdinal, parseRows, dateFromFileName, formatDate, sessionDate, MAX_STUDENTS, MAX_POSITION };
