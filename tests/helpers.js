// Test helpers: a minimal CSV reader (the browser uses Papa Parse) and
// seeded random class generators.
const fs = require("node:fs");
const path = require("node:path");
const { makeRng } = require("../scheduler.js");

const FIXTURES = path.join(__dirname, "fixtures");

// Enough CSV for the fixtures: commas, quoted cells, doubled quotes.
function csvToRows(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function readFixture(name) {
  return csvToRows(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

// A random class of n students with lists drawn from positions 1..maxPos.
function randomClass(n, seed, maxPos) {
  const rng = makeRng("class-" + seed);
  const students = [];
  for (let i = 0; i < n; i++) {
    const len = Math.floor(rng() * 5);
    const choices = [];
    while (choices.length < len) {
      const p = 1 + Math.floor(rng() * (maxPos || 16));
      if (choices.indexOf(p) === -1) choices.push(p);
    }
    students.push({ name: "Student " + String.fromCharCode(65 + i) + i, choices: choices });
  }
  return students;
}

function shuffled(arr, seed) {
  const rng = makeRng("shuffle-" + seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { FIXTURES, csvToRows, readFixture, randomClass, shuffled };
