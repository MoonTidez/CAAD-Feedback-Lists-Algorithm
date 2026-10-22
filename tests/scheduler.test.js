const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { assign, costOf, makeRng, cyrb128 } = require("../scheduler.js");
const { parseRows } = require("../parse.js");
const { FIXTURES, readFixture, randomClass, shuffled } = require("./helpers.js");

const MODES = ["hungarian", "boston"];
const SEED = "2026-10-26";

function studentsFrom(fixture) {
  const parsed = parseRows(readFixture(fixture));
  assert.deepEqual(parsed.errors, [], fixture + " should parse without errors");
  return parsed.students;
}

function assertValidOrder(result, students) {
  const M = students.length;
  assert.equal(result.order.length, M);
  assert.deepEqual(result.order.map((o) => o.position), Array.from({ length: M }, (_, i) => i + 1));
  assert.deepEqual(result.order.map((o) => o.name).sort(), students.map((s) => s.name.trim()).sort());
  const originals = result.order.map((o) => o.originalPosition);
  assert.equal(new Set(originals).size, M, "no original position used twice");
  for (let i = 1; i < originals.length; i++) assert.ok(originals[i] > originals[i - 1], "relative order kept");
}

// Smallest total integer cost over every injective assignment of students to 1..P.
function bruteForceMin(students) {
  let P = students.length;
  for (const s of students) for (const c of s.choices) P = Math.max(P, c);
  let best = Infinity;
  const used = new Array(P + 1).fill(false);
  (function go(i, total) {
    if (total >= best) return;
    if (i === students.length) { best = total; return; }
    for (let p = 1; p <= P; p++) {
      if (used[p]) continue;
      used[p] = true;
      go(i + 1, total + costOf(students[i].choices, p));
      used[p] = false;
    }
  })(0, 0);
  return best;
}

function totalCost(result, students) {
  const byName = Object.fromEntries(students.map((s) => [s.name.trim(), s.choices]));
  return result.order.reduce((sum, o) => sum + costOf(byName[o.name], o.originalPosition), 0);
}

test("seeded generator: same seed gives the same stream, different seeds differ", () => {
  const a = makeRng(SEED), b = makeRng(SEED), c = makeRng("2026-10-28");
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const x of sa) assert.ok(x >= 0 && x < 1);
  assert.equal(cyrb128(SEED).length, 4);
});

for (const mode of MODES) {
  test(`${mode}: same input, seed and mode always give the same output`, () => {
    for (const fixture of fs.readdirSync(FIXTURES)) {
      const students = studentsFrom(fixture);
      const first = assign(students, { mode, seed: SEED });
      for (let i = 0; i < 3; i++) assert.deepEqual(assign(students, { mode, seed: SEED }), first);
    }
  });

  test(`${mode}: shuffling the row order gives the same output`, () => {
    for (const fixture of fs.readdirSync(FIXTURES)) {
      const rows = readFixture(fixture);
      const base = assign(parseRows(rows).students, { mode, seed: SEED });
      for (let k = 0; k < 5; k++) {
        const reordered = [rows[0]].concat(shuffled(rows.slice(1), fixture + k));
        const parsed = parseRows(reordered);
        assert.deepEqual(parsed.errors, []);
        assert.deepEqual(assign(parsed.students, { mode, seed: SEED }).order, base.order);
      }
    }
  });

  test(`${mode}: every fixture gives each student exactly one position, 1 to M`, () => {
    for (const fixture of fs.readdirSync(FIXTURES)) {
      const students = studentsFrom(fixture);
      assertValidOrder(assign(students, { mode, seed: SEED }), students);
    }
  });

  test(`${mode}: class sizes 1, 12, 14 and 16 work`, () => {
    for (const n of [1, 12, 14, 16]) {
      for (let k = 0; k < 20; k++) {
        const students = randomClass(n, n + "-" + k);
        const result = assign(students, { mode, seed: "2026-11-" + String(1 + k).padStart(2, "0") });
        assertValidOrder(result, students);
      }
    }
  });

  test(`${mode}: listing position 14 with only 12 names puts that student last`, () => {
    const students = studentsFrom("Feedback Order - 2026-10-28.csv");
    assert.equal(students.length, 12);
    const result = assign(students, { mode, seed: "2026-10-28" });
    const last = result.order[result.order.length - 1];
    assert.equal(last.name, "Elif Demir");
    assert.equal(last.position, 12);
    assert.equal(last.originalPosition, 14);
    assert.equal(last.rank, 1);
  });

  test(`${mode}: an empty class returns an empty order`, () => {
    assert.deepEqual(assign([], { mode, seed: SEED }).order, []);
  });
}

test("hungarian: finds the minimal total cost (brute force, up to 6 students)", () => {
  let cases = 0;
  for (let n = 1; n <= 6; n++) {
    for (let k = 0; k < 40; k++) {
      const students = randomClass(n, "bf-" + n + "-" + k, 7);
      const result = assign(students, { mode: "hungarian", seed: "seed-" + k });
      assert.equal(totalCost(result, students), bruteForceMin(students), JSON.stringify(students));
      cases++;
    }
  }
  assert.equal(cases, 240);
});

test("hungarian: reports rank and log total cost", () => {
  const students = [
    { name: "Aisha", choices: [3, 1] },
    { name: "Ben", choices: [3] },
    { name: "Chen", choices: [] },
  ];
  const result = assign(students, { mode: "hungarian", seed: SEED });
  // Either Ben gets 3 and Aisha her 2nd choice (1 + 4), or Aisha gets 3 and Ben
  // lands off his list (1 + 4). Chen costs 1 anywhere, so the optimum is 6.
  assert.equal(result.log.totalCost, 6);
  assert.equal(totalCost(result, students), 6);
});

test("boston: a student who is the only applicant to their 1st choice always gets it", () => {
  let checked = 0;
  for (const n of [4, 8, 12, 14, 16]) {
    for (let k = 0; k < 30; k++) {
      const students = randomClass(n, "solo-" + n + "-" + k);
      const result = assign(students, { mode: "boston", seed: "s" + k });
      const firstCounts = {};
      for (const s of students) if (s.choices.length) firstCounts[s.choices[0]] = (firstCounts[s.choices[0]] || 0) + 1;
      for (const s of students) {
        if (!s.choices.length || firstCounts[s.choices[0]] !== 1) continue;
        const got = result.order.find((o) => o.name === s.name);
        assert.equal(got.originalPosition, s.choices[0]);
        assert.equal(got.rank, 1);
        checked++;
      }
    }
  }
  assert.ok(checked > 100);
});

test("boston: the audit log records rounds, lotteries and the final pool", () => {
  const students = studentsFrom("everyone-wants-1.csv");
  const result = assign(students, { mode: "boston", seed: SEED });
  assert.equal(result.log.rounds.length, 1);
  const round = result.log.rounds[0];
  assert.equal(round.applications.length, 10);
  assert.equal(round.contested.length, 1);
  assert.equal(round.contested[0].position, 1);
  assert.equal(round.contested[0].applicants.length, 10);
  assert.equal(result.order[0].name, round.contested[0].winner);
  assert.equal(result.log.finalPool.before.length, 9);
  assert.deepEqual(result.log.finalPool.pairs.map((p) => p.position), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("boston: students blocked from a taken position sit the round out", () => {
  const students = [
    { name: "Aisha", choices: [1] },
    { name: "Ben", choices: [2, 1] },
  ];
  const result = assign(students, { mode: "boston", seed: SEED });
  assert.deepEqual(result.log.rounds[1].blocked, []);
  const students2 = [
    { name: "Aisha", choices: [1, 2] },
    { name: "Ben", choices: [1, 2] },
    { name: "Chen", choices: [2] },
  ];
  const r2 = assign(students2, { mode: "boston", seed: SEED });
  // Chen wins 2 in round 1, so the 1st-choice loser is blocked from 2 in round 2.
  assert.equal(r2.order.find((o) => o.name === "Chen").originalPosition, 2);
  assert.equal(r2.log.rounds[1].blocked.length, 1);
  assert.equal(r2.log.rounds[1].blocked[0].position, 2);
});

test("stats: counts 1st choices, top 3, not on list, no choices, average and worst", () => {
  const students = studentsFrom("Feedback Order - 2026-10-26.csv");
  for (const mode of MODES) {
    const { order, stats } = assign(students, { mode, seed: SEED });
    const ranks = order.map((o) => o.rank).filter((r) => r !== null);
    assert.equal(stats.students, 14);
    assert.equal(stats.firstChoice, ranks.filter((r) => r === 1).length);
    assert.equal(stats.topThree, ranks.filter((r) => r <= 3).length);
    assert.equal(stats.noChoices, 1); // Farid listed nothing
    assert.equal(stats.notOnList + stats.noChoices, order.length - ranks.length);
    assert.equal(stats.worstRank, Math.max(...ranks));
    assert.ok(Math.abs(stats.averageRank - ranks.reduce((a, b) => a + b, 0) / ranks.length) < 1e-12);
  }
});

test("all-empty lists: everyone is placed and nobody is counted as off their list", () => {
  const students = studentsFrom("all-empty - 2026-11-02.csv");
  for (const mode of MODES) {
    const { stats } = assign(students, { mode, seed: SEED });
    assert.equal(stats.noChoices, 8);
    assert.equal(stats.notOnList, 0);
    assert.equal(stats.averageRank, null);
  }
});
