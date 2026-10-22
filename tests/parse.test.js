const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRows, readPosition, dateFromFileName, sessionDate } = require("../parse.js");
const { readFixture } = require("./helpers.js");

const HEADER = ["Name", "1st choice", "2nd choice", "3rd choice", "4th choice"];

function has(messages, pattern) {
  return messages.some((m) => pattern.test(m));
}

test("reads the first integer in a cell", () => {
  assert.equal(readPosition("3"), 3);
  assert.equal(readPosition("Position 3"), 3);
  assert.equal(readPosition(" pos. 12 "), 12);
  assert.equal(readPosition("abc"), null);
  assert.equal(readPosition(""), null);
  assert.equal(readPosition(null), null);
});

test("parses the brief's example", () => {
  const { students, warnings, errors } = parseRows([
    HEADER,
    ["Aisha", "3", "1", "", ""],
    ["Ben", "3", "", "", ""],
    ["Chen", "", "", "", ""],
    ["Dana", "Position 2", "5", "2", ""],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(students, [
    { name: "Aisha", choices: [3, 1] },
    { name: "Ben", choices: [3] },
    { name: "Chen", choices: [] },
    { name: "Dana", choices: [2, 5] },
  ]);
  assert.ok(has(warnings, /Chen has no valid choices/));
  assert.ok(has(warnings, /Dana: position 2 is listed twice/));
});

test("finds columns by header, ignoring case, and orders choices by ordinal", () => {
  const { students, errors } = parseRows([
    ["3RD CHOICE", "Notes", "student name", "1st Choice", "2nd choice"],
    ["7", "hi", "Aisha", "5", "6"],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(students, [{ name: "Aisha", choices: [5, 6, 7] }]);
});

test("ignores fully empty rows silently and warns about nameless rows", () => {
  const { students, warnings } = parseRows([HEADER, ["", "", "", "", ""], ["", "2", "", "", ""], ["Aisha", "1", "", "", ""]]);
  assert.equal(students.length, 1);
  assert.deepEqual(warnings, ["Row 3 has no name; ignored it."]);
});

test("cleaning: names are trimmed and shown as first written", () => {
  const { students } = parseRows([HEADER, ["  Aisha   Rahman ", "1", "", "", ""]]);
  assert.equal(students[0].name, "Aisha   Rahman");
});

test("cleaning: the same name on two rows is an error listing the rows", () => {
  const { students, errors } = parseRows([HEADER, ["Aisha", "1"], ["Ben", "2"], ["aisha", "3"]]);
  assert.deepEqual(students, []);
  assert.deepEqual(errors, ['The name "Aisha" appears on rows 2 and 4. Each student needs exactly one row.']);
});

test("cleaning: names that differ only in case or spacing are duplicates", () => {
  const { errors } = parseRows([HEADER, ["Aisha  Rahman", "1"], [" AISHA rahman ", "2"], ["Aisha Rahman", "3"]]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /rows 2, 3 and 4/);
});

test("cleaning: more than 16 names is an error", () => {
  const rows = [HEADER];
  for (let i = 1; i <= 17; i++) rows.push(["Student " + i, String(i % 16 + 1)]);
  const { students, errors } = parseRows(rows);
  assert.deepEqual(students, []);
  assert.ok(has(errors, /17 names; the limit is 16/));
  assert.deepEqual(parseRows(rows.slice(0, 17)).errors, []);
});

test("cleaning: gaps in a row are closed and the order kept", () => {
  const { students, warnings } = parseRows([HEADER, ["Aisha", "4", "", "2", "7"]]);
  assert.deepEqual(students[0].choices, [4, 2, 7]);
  assert.ok(has(warnings, /Aisha: gap in their list before 3rd choice/));
});

test("cleaning: the same position twice keeps the first occurrence", () => {
  const { students, warnings } = parseRows([HEADER, ["Aisha", "4", "2", "4", "2"]]);
  assert.deepEqual(students[0].choices, [4, 2]);
  assert.equal(warnings.filter((w) => /listed twice/.test(w)).length, 2);
});

test("cleaning: positions below 1 or above 16 are ignored", () => {
  const { students, warnings } = parseRows([HEADER, ["Aisha", "0", "17", "-3", "16"]]);
  assert.deepEqual(students[0].choices, [16]);
  assert.equal(warnings.filter((w) => /outside 1–16/.test(w)).length, 3);
});

test("cleaning: a student with no valid choices is kept with an empty list", () => {
  const { students, warnings } = parseRows([HEADER, ["Aisha", "abc", "", "", ""]]);
  assert.deepEqual(students, [{ name: "Aisha", choices: [] }]);
  assert.ok(has(warnings, /couldn't read "abc"/));
  assert.ok(has(warnings, /Aisha has no valid choices/));
});

test("missing name or choice columns are errors", () => {
  assert.ok(has(parseRows([["Who", "1st choice"], ["Aisha", "1"]]).errors, /No name column/));
  assert.ok(has(parseRows([["Name", "Favourite"], ["Aisha", "1"]]).errors, /No choice columns/));
  assert.ok(has(parseRows([HEADER]).errors, /No students found/));
  assert.ok(has(parseRows([]).errors, /empty/));
});

test("the messy fixture parses with warnings and no errors", () => {
  const { students, warnings, errors } = parseRows(readFixture("messy Feedback Order - 2026-11-04.csv"));
  assert.deepEqual(errors, []);
  assert.deepEqual(students, [
    { name: "Aisha   Rahman", choices: [3, 2, 1] },
    { name: "Ben Okafor", choices: [3, 4] },
    { name: "Chen Wei", choices: [] },
    { name: "Dana Kowalski", choices: [2] },
    { name: "Elif Demir", choices: [7, 9] },
    { name: "Farid Haddad", choices: [4] },
  ]);
  for (const pattern of [/gap/, /listed twice/, /outside 1–16/, /couldn't read/, /no valid choices/, /Row 6 has no name/]) {
    assert.ok(has(warnings, pattern), "expected a warning matching " + pattern);
  }
});

test("reads the date from the file name", () => {
  assert.equal(dateFromFileName("Feedback Order - 2026-10-26.csv"), "2026-10-26");
  assert.equal(dateFromFileName("2026-02-30 then 2026-03-02.csv"), "2026-03-02");
  assert.equal(dateFromFileName("v12026-10-26.csv"), null);
  assert.equal(dateFromFileName("Feedback Order.csv"), null);
  assert.deepEqual(sessionDate("Feedback Order - 2026-10-26.csv"), { date: "2026-10-26", source: "file", warning: null });
});

test("a file name with no date falls back to today with a warning", () => {
  const today = new Date(2026, 9, 22);
  const result = sessionDate("Feedback Order.csv", today);
  assert.equal(result.date, "2026-10-22");
  assert.equal(result.source, "today");
  assert.match(result.warning, /No date found in the file name/);
});
