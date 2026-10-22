// CAAD Feedback Lists Algorithm: scheduling core.
// Pure functions only: no DOM, no imports, no browser APIs. Works as a plain
// <script>, pasted into Google Apps Script, or loaded in Node.

// ---------- Seeded randomness ----------

// cyrb128: hashes a string into four 32-bit unsigned integers.
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// mulberry32: returns a generator of floats in [0, 1).
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One generator per run, seeded from the session date string.
function makeRng(seed) {
  return mulberry32(cyrb128(String(seed))[0]);
}

// ---------- Helpers ----------

function nameKey(name) {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

// Sort by normalised name so CSV row order never affects the result.
// A fixed locale keeps the order identical in every browser and in Node;
// the code-point comparison breaks ties such as "José" and "Jose".
function sortStudents(students) {
  return students
    .map(function (s) {
      return { name: String(s.name).trim(), key: nameKey(s.name), choices: (s.choices || []).slice() };
    })
    .sort(function (a, b) {
      const c = a.key.localeCompare(b.key, "en", { sensitivity: "base" });
      if (c !== 0) return c;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
}

// Rank of position p on a student's list (1-based), or null if not listed.
function rankOf(choices, p) {
  const i = choices.indexOf(p);
  return i === -1 ? null : i + 1;
}

function costOf(choices, p) {
  const r = rankOf(choices, p);
  return r === null ? Math.pow(choices.length + 1, 2) : r * r;
}

// ---------- Mode A: Hungarian ----------

// Kuhn–Munkres with potentials, O(n^3). cost is an n×n matrix.
// Returns rowToCol: rowToCol[i] = column assigned to row i.
function hungarian(cost) {
  const n = cost.length;
  const INF = Infinity;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0); // p[j] = row matched to column j (1-based)
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const rowToCol = new Array(n);
  for (let j = 1; j <= n; j++) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

function assignHungarian(sorted, P, rng) {
  const M = sorted.length;
  const matrix = [];
  // Students sorted by name, positions ascending: the fixed fill order for noise.
  for (let s = 0; s < M; s++) {
    const row = [];
    for (let p = 1; p <= P; p++) row.push(costOf(sorted[s].choices, p) + rng() * 0.001);
    matrix.push(row);
  }
  // Dummy rows soak up the empty positions when M < P.
  for (let d = M; d < P; d++) matrix.push(new Array(P).fill(0));
  const rowToCol = hungarian(matrix);
  const assigned = [];
  let totalCost = 0;
  for (let s = 0; s < M; s++) {
    const pos = rowToCol[s] + 1;
    totalCost += costOf(sorted[s].choices, pos);
    assigned.push({ name: sorted[s].name, originalPosition: pos, rank: rankOf(sorted[s].choices, pos) });
  }
  return { assigned: assigned, log: { totalCost: totalCost, positions: P } };
}

// ---------- Mode B: Boston ----------

function assignBoston(sorted, P, rng) {
  const M = sorted.length;
  const posOf = new Array(M).fill(0); // 0 = unassigned
  const taken = new Array(P + 1).fill(false);
  let maxLen = 0;
  for (let s = 0; s < M; s++) maxLen = Math.max(maxLen, sorted[s].choices.length);

  const rounds = [];
  for (let k = 1; k <= maxLen; k++) {
    const applicants = {}; // position -> [student index], in name order
    const applications = [];
    const blocked = [];
    for (let s = 0; s < M; s++) {
      if (posOf[s] || sorted[s].choices.length < k) continue;
      const want = sorted[s].choices[k - 1];
      if (taken[want]) {
        blocked.push({ name: sorted[s].name, position: want });
        continue;
      }
      applications.push({ name: sorted[s].name, position: want });
      (applicants[want] = applicants[want] || []).push(s);
    }
    const contested = [];
    const assignedThisRound = [];
    for (let p = 1; p <= P; p++) {
      const list = applicants[p];
      if (!list) continue;
      let winner = list[0];
      if (list.length > 1) {
        winner = list[Math.floor(rng() * list.length)];
        contested.push({
          position: p,
          applicants: list.map(function (s) { return sorted[s].name; }),
          winner: sorted[winner].name,
        });
      }
      posOf[winner] = p;
      taken[p] = true;
      assignedThisRound.push({ name: sorted[winner].name, position: p });
    }
    rounds.push({ round: k, applications: applications, blocked: blocked, contested: contested, assigned: assignedThisRound });
  }

  // Final pool: seeded Fisher–Yates, then pair with free positions ascending.
  const pool = [];
  for (let s = 0; s < M; s++) if (!posOf[s]) pool.push(s);
  const before = pool.map(function (s) { return sorted[s].name; });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  const free = [];
  for (let p = 1; p <= P; p++) if (!taken[p]) free.push(p);
  const poolPairs = [];
  for (let i = 0; i < pool.length; i++) {
    posOf[pool[i]] = free[i];
    poolPairs.push({ name: sorted[pool[i]].name, position: free[i] });
  }

  const assigned = [];
  for (let s = 0; s < M; s++) {
    assigned.push({ name: sorted[s].name, originalPosition: posOf[s], rank: rankOf(sorted[s].choices, posOf[s]) });
  }
  return {
    assigned: assigned,
    log: { positions: P, rounds: rounds, finalPool: { before: before, after: poolPairs.map(function (x) { return x.name; }), pairs: poolPairs } },
  };
}

// ---------- Ordering and stats ----------

// Order by position. Positions keep the numbers students entered: empty
// positions are left as gaps, not renumbered away. originalPosition always
// equals position; it stays for callers written against the first version.
function sortByPosition(assigned) {
  return assigned
    .slice()
    .sort(function (a, b) { return a.originalPosition - b.originalPosition; })
    .map(function (a) {
      return { position: a.originalPosition, originalPosition: a.originalPosition, name: a.name, rank: a.rank };
    });
}

// Positions 1..P that nobody was given.
function emptyPositions(order, P) {
  const used = {};
  for (let i = 0; i < order.length; i++) used[order[i].position] = true;
  const empty = [];
  for (let p = 1; p <= P; p++) if (!used[p]) empty.push(p);
  return empty;
}

function computeStats(order, sorted, P) {
  const listLength = {};
  for (let i = 0; i < sorted.length; i++) listLength[sorted[i].key] = sorted[i].choices.length;
  const stats = { students: order.length, firstChoice: 0, topThree: 0, notOnList: 0, noChoices: 0, averageRank: null, worstRank: null, emptyPositions: emptyPositions(order, P || order.length) };
  let sum = 0, listed = 0;
  for (let i = 0; i < order.length; i++) {
    const r = order[i].rank;
    if (r === null) {
      if (listLength[nameKey(order[i].name)] === 0) stats.noChoices++;
      else stats.notOnList++;
      continue;
    }
    listed++;
    sum += r;
    if (r === 1) stats.firstChoice++;
    if (r <= 3) stats.topThree++;
    if (stats.worstRank === null || r > stats.worstRank) stats.worstRank = r;
  }
  if (listed) stats.averageRank = sum / listed;
  return stats;
}

// ---------- Entry point ----------

// students: [{ name, choices: [int] }]; options: { mode: "hungarian" | "boston", seed }
// Returns { order: [{ position, originalPosition, name, rank }], stats, log }.
function assign(students, options) {
  const mode = String((options && options.mode) || "hungarian").toLowerCase();
  if (mode !== "hungarian" && mode !== "boston") throw new Error("Unknown mode: " + mode);
  const seed = String(options && options.seed != null ? options.seed : "");
  const sorted = sortStudents(students || []);
  const M = sorted.length;
  let P = M;
  for (let s = 0; s < M; s++) for (let c = 0; c < sorted[s].choices.length; c++) P = Math.max(P, sorted[s].choices[c]);
  const rng = makeRng(seed);
  const result = M === 0 ? { assigned: [], log: { positions: 0 } } : mode === "boston" ? assignBoston(sorted, P, rng) : assignHungarian(sorted, P, rng);
  const order = sortByPosition(result.assigned);
  result.log.mode = mode;
  result.log.seed = seed;
  return { order: order, stats: computeStats(order, sorted, P), log: result.log };
}

if (typeof module !== "undefined") module.exports = { cyrb128, mulberry32, makeRng, nameKey, sortStudents, rankOf, costOf, hungarian, sortByPosition, emptyPositions, computeStats, assign };
