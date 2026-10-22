// CAAD Feedback Lists Algorithm: UI wiring for index.html.
// Relies on parse.js, scheduler.js and Papa Parse being loaded first.
(function () {
  "use strict";

  const MODE_LABEL = { hungarian: "Hungarian", boston: "Boston" };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const el = {
    tabRun: document.getElementById("tab-run"),
    tabCompare: document.getElementById("tab-compare"),
    panel: document.getElementById("panel"),
    form: document.getElementById("inputs"),
    file: document.getElementById("file"),
    date: document.getElementById("date"),
    dateSource: document.getElementById("date-source"),
    modeField: document.getElementById("mode-field"),
    run: document.getElementById("run"),
    messages: document.getElementById("messages"),
    output: document.getElementById("output"),
    template: document.getElementById("download-template"),
  };

  const state = {
    view: "run",
    rows: null, // parsed CSV rows of the chosen file
    fileName: "",
    dateWarning: null, // shown when the file name had no date
  };

  // ---------- Small helpers ----------

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key in attrs) {
        if (attrs[key] == null || attrs[key] === false) continue;
        if (key === "text") node.textContent = attrs[key];
        else if (key === "class") node.className = attrs[key];
        else node.setAttribute(key, attrs[key]);
      }
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function ordinal(n) {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return n + "th";
    return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  }

  function resultLabel(item, listLengths) {
    if (item.rank !== null) return ordinal(item.rank) + " choice";
    return listLengths[nameKey(item.name)] === 0 ? "No choices listed" : "Not on list";
  }

  // "2026-10-26" -> "Mon 26 Oct 2026", independent of the viewer's locale.
  function longDate(iso) {
    const p = iso.split("-").map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return DAYS[d.getUTCDay()] + " " + p[2] + " " + MONTHS[p[1] - 1] + " " + p[0];
  }

  function validIso(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && dateFromFileName(value) === value;
  }

  function csvCell(value) {
    const s = String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function download(fileName, text) {
    const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: fileName });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyText(text, statusNode) {
    function done(ok) {
      statusNode.textContent = ok ? "Copied." : "Couldn't copy. Select the text and copy it by hand.";
      setTimeout(function () { statusNode.textContent = ""; }, 4000);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  }

  function fallbackCopy(text) {
    const ta = h("textarea", { readonly: "", style: "position:fixed;opacity:0" });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function selectedMode() {
    return el.form.querySelector('input[name="mode"]:checked').value;
  }

  // ---------- Tabs ----------

  function setView(view, focus) {
    state.view = view;
    const isRun = view === "run";
    el.tabRun.setAttribute("aria-selected", String(isRun));
    el.tabCompare.setAttribute("aria-selected", String(!isRun));
    el.tabRun.tabIndex = isRun ? 0 : -1;
    el.tabCompare.tabIndex = isRun ? -1 : 0;
    el.panel.setAttribute("aria-labelledby", isRun ? "tab-run" : "tab-compare");
    el.modeField.hidden = !isRun;
    el.run.textContent = isRun ? "Run" : "Compare both methods";
    if (focus) (isRun ? el.tabRun : el.tabCompare).focus();
    // Keep results in step with the view when a file is already loaded.
    if (state.rows) run();
    else clearOutput();
  }

  el.tabRun.addEventListener("click", function () { setView("run"); });
  el.tabCompare.addEventListener("click", function () { setView("compare"); });
  [el.tabRun, el.tabCompare].forEach(function (tab) {
    tab.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const next = e.key === "Home" ? "run" : e.key === "End" ? "compare" : state.view === "run" ? "compare" : "run";
        setView(next, true);
      }
    });
  });

  // ---------- Inputs ----------

  el.file.addEventListener("change", function () {
    const file = el.file.files && el.file.files[0];
    state.rows = null;
    clearOutput();
    if (!file) return;
    state.fileName = file.name;
    const sd = sessionDate(file.name, new Date());
    el.date.value = sd.date;
    state.dateWarning = sd.warning;
    el.dateSource.textContent = sd.source === "file" ? "From file name." : "Set to today: no date in the file name.";
    Papa.parse(file, {
      skipEmptyLines: false,
      complete: function (res) { state.rows = res.data; },
      error: function () {
        state.rows = []; // parseRows reports an empty file
      },
    });
  });

  el.date.addEventListener("input", function () {
    state.dateWarning = null;
    el.dateSource.textContent = "Entered manually.";
  });

  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    run();
  });

  el.template.addEventListener("click", function (e) {
    e.preventDefault();
    const header = ["Name"];
    for (let i = 1; i <= MAX_POSITION; i++) header.push(ordinal(i) + " choice");
    download("Feedback Order - template.csv", header.join(",") + "\r\n");
  });

  // ---------- Running ----------

  function clearOutput() {
    el.messages.textContent = "";
    el.output.textContent = "";
    el.output.hidden = true;
  }

  function showMessages(errors, warnings) {
    el.messages.textContent = "";
    if (errors.length) {
      el.messages.appendChild(h("div", { class: "msg msg-error", role: "alert" }, [
        h("strong", { text: errors.length === 1 ? "Can't make an order yet" : "Can't make an order yet (" + errors.length + " problems)" }),
        h("ul", null, errors.map(function (m) { return h("li", { text: m }); })),
      ]));
    }
    if (warnings.length) {
      el.messages.appendChild(h("div", { class: "msg msg-warn" }, [
        h("strong", { text: warnings.length === 1 ? "1 thing to check" : warnings.length + " things to check" }),
        h("ul", null, warnings.map(function (m) { return h("li", { text: m }); })),
      ]));
    }
  }

  function run() {
    clearOutput();
    if (!el.file.files || !el.file.files[0]) {
      showMessages(["Choose a CSV file first."], []);
      el.file.focus();
      return;
    }
    if (!state.rows) {
      // Papa Parse reads the file asynchronously; try again once it's done.
      setTimeout(run, 50);
      return;
    }
    const seed = el.date.value;
    if (!validIso(seed)) {
      showMessages(["Enter a valid session date."], []);
      el.date.focus();
      return;
    }
    const parsed = parseRows(state.rows);
    const warnings = (state.dateWarning ? [state.dateWarning] : []).concat(parsed.warnings);
    showMessages(parsed.errors, warnings);
    if (parsed.errors.length) return;

    const listLengths = {};
    parsed.students.forEach(function (s) { listLengths[nameKey(s.name)] = s.choices.length; });
    const ctx = { students: parsed.students, seed: seed, listLengths: listLengths };
    if (state.view === "run") renderRun(ctx, selectedMode());
    else renderCompare(ctx);
    el.output.hidden = false;
  }

  // ---------- Rendering ----------

  function headerLine(mode, seed, count) {
    return MODE_LABEL[mode] + " · seed " + seed + " · " + count + (count === 1 ? " student" : " students");
  }

  function chatText(mode, seed, order) {
    const lines = ["Feedback order — " + longDate(seed) + " (" + MODE_LABEL[mode] + ", seed " + seed + ")"];
    order.forEach(function (o) { lines.push(o.position + ". " + o.name); });
    return lines.join("\n");
  }

  function resultTable(order, listLengths, diffNames, caption) {
    const rows = order.map(function (o) {
      const label = resultLabel(o, listLengths);
      const differs = diffNames && diffNames[nameKey(o.name)];
      return h("tr", { class: differs ? "diff" : null }, [
        h("td", { class: "num", text: String(o.position) }),
        h("td", { class: "name" }, [o.name, differs ? h("span", { class: "diff-mark", text: "differs" }) : null]),
        h("td", { class: o.rank === null ? "result-off" : null, text: label }),
      ]);
    });
    return h("div", { class: "table-wrap" }, [
      h("table", null, [
        h("caption", { class: "sr-only", text: caption }),
        h("thead", null, [h("tr", null, [
          h("th", { class: "num", scope: "col", text: "Position" }),
          h("th", { scope: "col", text: "Name" }),
          h("th", { scope: "col", text: "Result" }),
        ])]),
        h("tbody", null, rows),
      ]),
    ]);
  }

  function statsList(stats) {
    const items = [
      ["Got their 1st choice", stats.firstChoice],
      ["Got a top-3 choice", stats.topThree],
      ["Placed off their list", stats.notOnList],
      ["Average rank (listed)", stats.averageRank === null ? "—" : stats.averageRank.toFixed(2)],
      ["Worst listed rank", stats.worstRank === null ? "—" : ordinal(stats.worstRank)],
    ];
    if (stats.noChoices) items.push(["Listed no choices", stats.noChoices]);
    return h("dl", { class: "stats" }, items.map(function (it) {
      return h("div", null, [h("dt", { text: it[0] }), h("dd", { text: String(it[1]) })]);
    }));
  }

  function auditLog(log) {
    const body = [h("p", { class: "hint", text: "Positions here are the numbers students entered, before empty positions were removed. Positions 1–" + log.positions + " were in play." })];
    log.rounds.forEach(function (r) {
      const parts = [h("h3", { text: "Round " + r.round + ": " + ordinal(r.round) + " choices" })];
      if (!r.applications.length && !r.blocked.length) {
        parts.push(h("p", { text: "Nobody still waiting had a " + ordinal(r.round) + " choice." }));
      }
      if (r.applications.length) {
        parts.push(h("p", { text: "Applied: " + r.applications.map(function (a) { return a.name + " → " + a.position; }).join(", ") + "." }));
      }
      if (r.blocked.length) {
        parts.push(h("p", { text: "Sat out (position already taken): " + r.blocked.map(function (a) { return a.name + " (wanted " + a.position + ")"; }).join(", ") + "." }));
      }
      if (r.contested.length) {
        parts.push(h("p", { text: "Contested:" }));
        parts.push(h("ul", null, r.contested.map(function (c) {
          return h("li", { text: "Position " + c.position + ": " + c.applicants.join(", ") + ". Draw won by " + c.winner + "." });
        })));
      } else if (r.applications.length) {
        parts.push(h("p", { text: "No contested positions." }));
      }
      if (r.assigned.length) {
        parts.push(h("p", { text: "Placed: " + r.assigned.map(function (a) { return a.name + " → " + a.position; }).join(", ") + "." }));
      }
      body.push(h("div", { class: "log-round" }, parts));
    });
    const pool = log.finalPool;
    const poolParts = [h("h3", { text: "Final pool" })];
    if (!pool.before.length) {
      poolParts.push(h("p", { text: "Everyone was placed in the rounds above." }));
    } else {
      poolParts.push(h("p", { text: "Still waiting, in name order: " + pool.before.join(", ") + "." }));
      poolParts.push(h("p", { text: "After the seeded shuffle, paired with the free positions in order: " + pool.pairs.map(function (p) { return p.name + " → " + p.position; }).join(", ") + "." }));
    }
    body.push(h("div", { class: "log-round" }, poolParts));
    return h("details", { class: "log" }, [h("summary", { text: "Audit log" })].concat(body));
  }

  function copyRow(label, getText) {
    const status = h("p", { class: "status", role: "status" });
    const btn = h("button", { type: "button", class: "btn btn-primary", text: label });
    btn.addEventListener("click", function () { copyText(getText(), status); });
    return { button: btn, status: status };
  }

  function renderRun(ctx, mode) {
    const result = assign(ctx.students, { mode: mode, seed: ctx.seed });
    const copy = copyRow("Copy for group chat", function () { return chatText(mode, ctx.seed, result.order); });
    const dl = h("button", { type: "button", class: "btn", text: "Download result CSV" });
    dl.addEventListener("click", function () {
      const lines = ["Position,Name,Result"];
      result.order.forEach(function (o) { lines.push([o.position, o.name, resultLabel(o, ctx.listLengths)].map(csvCell).join(",")); });
      download("Feedback Order Result - " + ctx.seed + " (" + MODE_LABEL[mode] + ").csv", lines.join("\r\n") + "\r\n");
    });
    el.output.appendChild(h("div", { class: "card" }, [
      h("h2", { class: "run-header", text: headerLine(mode, ctx.seed, result.order.length) }),
      resultTable(result.order, ctx.listLengths, null, "Feedback order, " + MODE_LABEL[mode]),
      statsList(result.stats),
      h("div", { class: "actions" }, [copy.button, dl]),
      copy.status,
      mode === "boston" ? auditLog(result.log) : null,
    ]));
  }

  function renderCompare(ctx) {
    const results = {
      hungarian: assign(ctx.students, { mode: "hungarian", seed: ctx.seed }),
      boston: assign(ctx.students, { mode: "boston", seed: ctx.seed }),
    };
    // A student differs when their final position or their result differs.
    const summaryOf = function (order) {
      const map = {};
      order.forEach(function (o) { map[nameKey(o.name)] = o.position + "|" + resultLabel(o, ctx.listLengths); });
      return map;
    };
    const sh = summaryOf(results.hungarian.order), sb = summaryOf(results.boston.order);
    const diff = {};
    let diffCount = 0;
    Object.keys(sh).forEach(function (k) { if (sh[k] !== sb[k]) { diff[k] = true; diffCount++; } });

    const copy = copyRow("Copy both orders", function () {
      return chatText("hungarian", ctx.seed, results.hungarian.order) + "\n\n" + chatText("boston", ctx.seed, results.boston.order);
    });

    const summary = diffCount === 0
      ? "Both methods give the same order."
      : diffCount + " of " + results.hungarian.order.length + " students get a different position or result. They're marked “differs”.";

    el.output.appendChild(h("div", { class: "card" }, [
      h("h2", { class: "run-header", text: "Compare · seed " + ctx.seed + " · " + results.hungarian.order.length + (results.hungarian.order.length === 1 ? " student" : " students") }),
      h("p", { class: "legend", text: summary }),
      h("div", { class: "actions" }, [copy.button]),
      copy.status,
    ]));
    el.output.appendChild(h("div", { class: "compare-grid" }, ["hungarian", "boston"].map(function (mode) {
      return h("div", { class: "card" }, [
        h("h2", { text: MODE_LABEL[mode] }),
        resultTable(results[mode].order, ctx.listLengths, diff, "Feedback order, " + MODE_LABEL[mode]),
        statsList(results[mode].stats),
        mode === "boston" ? auditLog(results[mode].log) : null,
      ]);
    })));
  }
})();
