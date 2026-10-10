(() => {
  const D = window.SAMPLE;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const STORE = "investcap.v1";
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch {}
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ holdings: state.holdings, watch: state.watch })); } catch {} };

  const state = {
    holdings: (saved && Array.isArray(saved.holdings) ? saved.holdings : D.holdings).map((h) => ({ ...h })),
    watch: (saved && Array.isArray(saved.watch) ? saved.watch : D.watchlist).map((w) => ({ ...w })),
    viewRange: "1Y",
    view: null, // a searched/watchlist stock that is not in the portfolio
    indices: D.indices.map((i) => ({ ...i })),
    news: D.news.map((n) => ({ ...n })),
    live: false,
    selected: (saved && Array.isArray(saved.holdings) ? (saved.holdings[0] || {}).symbol : "SPYG") || null,
    range: "1D",
    metric: "1D return",
    sort: "A to Z",
    group: "Single list",
    rollup: false,
    tab: "filter",
  };
  // draft copy of sheet choices, committed on Apply
  let draft = null;

  const money = (n, sign = false) => {
    const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
    return (n < 0 ? "-" : sign && n > 0 ? "+" : "") + s;
  };
  const pct = (n, sign = true) => (n > 0 && sign ? "+" : "") + n.toFixed(2) + "%";
  const cls = (n) => (n >= 0 ? "up" : "down");
  const num = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 5 });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- derived numbers ----------
  const value = (h) => h.shares * h.price;
  const costTotal = (h) => h.shares * h.cost;
  const dayChange = (h) => h.shares * (h.price - h.prev);
  const dayPct = (h) => ((h.price - h.prev) / h.prev) * 100;
  const gain = (h) => value(h) - costTotal(h);
  const gainPct = (h) => (costTotal(h) ? (gain(h) / costTotal(h)) * 100 : 0);
  const totals = () => {
    const v = state.holdings.reduce((a, h) => a + value(h), 0);
    const c = state.holdings.reduce((a, h) => a + dayChange(h), 0);
    return { v, c, p: v - c ? (c / (v - c)) * 100 : 0 };
  };

  // ---------- price history (real data via /api/history) ----------
  const histCache = {}; // key -> { at, data } ; data === null means the request failed
  const histKey = (symbols, range) => range + ":" + [...symbols].sort().join(",");
  // undefined = not requested yet, null = failed recently, object = {SYM: {t, c}}
  function cachedHist(symbols, range) {
    const hit = histCache[histKey(symbols, range)];
    if (!hit) return undefined;
    return Date.now() - hit.at < (hit.data ? 300000 : 60000) ? hit.data : undefined;
  }
  async function history(symbols, range) {
    const hit = cachedHist(symbols, range);
    if (hit !== undefined) return hit;
    const res = await api(`/api/history?range=${range}&symbols=${encodeURIComponent(symbols.join(","))}`);
    const data = res && Object.keys(res.series).length ? res.series : null;
    histCache[histKey(symbols, range)] = { at: Date.now(), data };
    return data;
  }

  // Value of the current holdings over time (assumes today's share counts were held throughout).
  function portfolioSeries(sr) {
    const held = state.holdings.filter((h) => sr[h.symbol] && sr[h.symbol].t.length);
    if (!held.length) return null;
    const axis = held.map((h) => sr[h.symbol].t).reduce((a, b) => (b.length > a.length ? b : a));
    const tol = ((axis[axis.length - 1] - axis[0]) / Math.max(axis.length - 1, 1)) * 1.5;
    const idx = held.map(() => 0);
    const v = axis.map((ts) => {
      let sum = 0;
      held.forEach((h, k) => {
        const { t, c } = sr[h.symbol];
        let i = idx[k];
        while (i + 1 < t.length && t[i + 1] <= ts) i++;
        idx[k] = i;
        if (t[i] <= ts || t[0] - ts <= tol) sum += h.shares * c[i];
      });
      return sum;
    });
    return { t: axis, v };
  }

  function path(data, w, h, pad = 6) {
    const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
    const pts = data.map((v, i) => [(i / Math.max(data.length - 1, 1)) * w, h - pad - ((v - min) / span) * (h - pad * 2)]);
    return { pts, d: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") };
  }
  const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const color = (up) => cssv(up ? "--green" : "--red");
  const RANGE_LABEL = { "1D": "past day", "1W": "past week", "1M": "past month", "3M": "past 3 months", "1Y": "past year", "2Y": "past 2 years", "5Y": "past 5 years", "10Y": "past 10 years" };
  const fmtTs = (ts, range) => {
    const d = new Date(ts * 1000), tz = "America/New_York";
    if (range === "1D" || range === "1W") return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });
    if (range === "5Y" || range === "10Y") return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: tz });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
  };

  // ---------- hero ----------
  function renderTotals() {
    const t = totals();
    $("#total-value").textContent = money(t.v);
    const el = $("#total-change");
    el.className = "change " + cls(t.c);
    el.innerHTML = `${money(t.c, true)} (${pct(t.p)}) <span class="muted">${isMarketOpen() ? "today" : "last session"}</span>`;
  }

  let chartSeq = 0;
  async function renderChart() {
    const box = $("#chart"), note = $("#range-change"), seq = ++chartSeq, range = state.range;
    const syms = state.holdings.map((h) => h.symbol);
    const msg = (m) => { box.innerHTML = `<div class="chart-msg">${m}</div>`; note.innerHTML = ""; };
    if (!syms.length) return msg("Add a stock to see your portfolio chart.");
    if (!box.firstChild) msg("Loading…");
    const sr = await history(syms, range);
    if (seq !== chartSeq) return;
    const pf = sr && portfolioSeries(sr);
    if (!pf || pf.v.length < 2) return msg("Price history is unavailable right now.");
    const data = pf.v;
    const diff = data[data.length - 1] - data[0];
    note.innerHTML = `<span class="${cls(diff)}"><b>${money(diff, true)} (${pct((diff / data[0]) * 100)})</b></span> <span class="muted">${RANGE_LABEL[range]} · based on your current holdings</span>`;
    drawSeries(box, pf.t, data, range);
  }

  function drawSeries(box, t, data, range) {
    const w = 800, h = 240;
    const { pts, d } = path(data, w, h, 14);
    const diff = data[data.length - 1] - data[0];
    const c = color(diff >= 0);
    box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Price history, ${range}">
      <defs><linearGradient id="g-${box.id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#g-${box.id})" stroke="none"/>
      <path d="${d}" stroke="${c}" vector-effect="non-scaling-stroke"/>
      <line id="xh" y1="0" y2="${h}" stroke="${cssv("--muted")}" stroke-dasharray="3 4" vector-effect="non-scaling-stroke" visibility="hidden"/>
      <circle id="xd" r="5" fill="${c}" stroke="${cssv("--bg")}" stroke-width="2" visibility="hidden"/>
    </svg><div class="chart-tip" hidden></div>`;
    const svg = $("svg", box), tip = $(".chart-tip", box), xh = $("#xh", box), xd = $("#xd", box);
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      const i = Math.round(x * (data.length - 1));
      const [px, py] = pts[i];
      xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("visibility", "visible");
      xd.setAttribute("cx", px); xd.setAttribute("cy", py); xd.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.style.left = Math.min(Math.max((px / w) * r.width, 90), r.width - 90) + "px";
      const df = data[i] - data[0];
      tip.innerHTML = `<span class="muted">${fmtTs(t[i], range)}</span> · ${money(data[i])} <span class="${cls(df)}">${pct((df / data[0]) * 100)}</span>`;
    };
    const leave = () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); xd.setAttribute("visibility", "hidden"); };
    box.onpointermove = move; box.onpointerleave = leave; box.onpointerdown = move;
  }

  // Sparklines and the position chart use the same history cache.
  async function loadSparks() {
    const syms = state.holdings.map((h) => h.symbol);
    if (!syms.length || cachedHist(syms, "1M") !== undefined) return;
    await history(syms, "1M");
    renderHoldings();
  }

  // ---------- indices ----------
  function renderIndices() {
    $("#indices").innerHTML = state.indices.map((i) => {
      const ch = i.price - i.prev, p = (ch / i.prev) * 100;
      return `<div class="card index"><div class="name">${esc(i.symbol)} <span class="small">· ${esc(i.proxy)}</span></div><div class="px">${i.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div class="${cls(ch)} small"><b>${pct(p)}</b></div></div>`;
    }).join("");
  }

  // ---------- holdings ----------
  const metricOf = (h) => {
    switch (state.metric) {
      case "Holdings": return { top: money(value(h)), sub: `${num(h.shares)} sh`, subCls: "muted" };
      case "Unrealized return": return { top: money(gain(h), true), sub: pct(gainPct(h)), subCls: cls(gain(h)), topCls: cls(gain(h)) };
      case "price": return { top: money(h.price), sub: pct(dayPct(h)), subCls: cls(dayPct(h)) };
      default: return { top: pct(dayPct(h)), sub: money(dayChange(h), true), subCls: cls(dayChange(h)), topCls: cls(dayPct(h)) };
    }
  };
  const sortKey = {
    "Top movers": (a, b) => Math.abs(dayPct(b)) - Math.abs(dayPct(a)),
    Highest: (a, b) => value(b) - value(a),
    Lowest: (a, b) => value(a) - value(b),
    "A to Z": (a, b) => a.symbol.localeCompare(b.symbol),
  };
  function holdingRow(h) {
    const m = metricOf(h);
    const one = sparkData && sparkData[h.symbol];
    const sp = one ? one.c : null;
    const d = sp && sp.length > 1 ? path(sp, 64, 28, 3).d : "";
    const c = color(sp ? sp[sp.length - 1] >= sp[0] : h.price >= h.prev);
    return `<button class="holding ${h.symbol === state.selected ? "sel" : ""}" data-sym="${h.symbol}" aria-pressed="${h.symbol === state.selected}">
      <span class="tkr">${esc(h.symbol.slice(0, 4))}</span>
      <span class="info"><span class="sym">${esc(h.symbol)}</span><span class="nm" style="display:block">${esc(h.name)}</span></span>
      <span class="spark">${d ? `<svg viewBox="0 0 64 28" preserveAspectRatio="none" stroke="${c}"><path d="${d}"/></svg>` : ""}</span>
      <span class="val"><b class="${m.topCls || ""}">${m.top}</b><span class="${m.subCls}">${m.sub}</span></span></button>`;
  }
  let sparkData = null;
  function renderHoldings() {
    sparkData = cachedHist(state.holdings.map((h) => h.symbol), "1M") || null;
    const list = [...state.holdings].sort(sortKey[state.sort]);
    let html = "";
    if (state.group === "Single list") {
      html = `<div class="group-label"><span>Holdings</span><span>${esc(state.metric)}</span></div>` + list.map(holdingRow).join("");
    } else {
      const key = state.group === "Asset class" ? "cls" : "issuer";
      const groups = {};
      list.forEach((h) => (groups[h[key]] ||= []).push(h));
      html = Object.keys(groups).sort().map((g) =>
        `<div class="group-label"><span>${esc(g === "Stock" ? "Equities" : g === "ETF" ? "ETFs" : g)}</span><span>${esc(state.metric)}</span></div>` + groups[g].map(holdingRow).join("")
      ).join("");
    }
    $("#holdings").innerHTML = html || `<div class="card pad muted">No holdings yet.</div>`;
    $("#metric-label").textContent = state.metric;
  }

  // ---------- detail ----------
  const find = (sym) => state.holdings.find((h) => h.symbol === sym) || state.watch.find((w) => w.symbol === sym) || (state.view && state.view.symbol === sym ? state.view : null);
  const closeDate = (t) => (t ? new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "");
  const badge = (x) => {
    const open = isMarketOpen();
    return open
      ? `<span class="badge live"><i></i>Live</span>`
      : `<span class="badge">At close${x.t ? " · " + closeDate(x.t) : ""}</span>`;
  };
  const isWatched = (sym) => state.watch.some((w) => w.symbol === sym);

  function head(h) {
    return `<div class="card pad d-head">
        <span class="tkr">${esc(h.symbol.slice(0, 4))}</span>
        <div class="t"><h3>${esc(h.symbol)}</h3><div class="nm muted small">${esc(h.name)}</div></div>
        <div style="text-align:right"><b class="px-now">${money(h.price)}</b><div class="small ${cls(dayPct(h))}"><b>${pct(dayPct(h))}</b></div>${badge(h)}</div>
      </div>`;
  }

  function renderDetail() {
    const el = $("#detail");
    const h = state.holdings.find((x) => x.symbol === state.selected);
    if (!h && state.view) return renderQuote(el, state.view);
    if (!h) { el.innerHTML = `<div class="card pad muted">Select a holding, or search for a stock to see its price.</div>`; return; }
    const t = totals();
    const weight = (value(h) / t.v) * 100;
    const hs = cachedHist([h.symbol], "1Y");
    if (hs === undefined) history([h.symbol], "1Y").then(() => { if (state.selected === h.symbol) renderDetail(); });
    const one = hs && hs[h.symbol];
    const dd = one && one.c.length > 1 ? path(one.c, 400, 90, 6).d : "";
    const c = color(one ? one.c[one.c.length - 1] >= one.c[0] : true);
    el.innerHTML = `
      <div class="section-head"><h2>Position</h2></div>
      ${head(h)}
      <div class="card pad" style="margin-bottom:12px;padding-bottom:8px">${dd ? `<svg viewBox="0 0 400 90" preserveAspectRatio="none" style="width:100%;height:90px;stroke:${c};stroke-width:2"><path d="${dd}" vector-effect="non-scaling-stroke"/></svg>` : `<div class="chart-msg" style="height:90px">${hs === undefined ? "Loading…" : "History unavailable"}</div>`}<div class="muted small">Past year</div></div>
      <div class="card stat-card">
        <div class="row"><span>Current value</span><span>${money(value(h))}</span></div>
        <div class="row"><span>Total cost</span><span>${money(costTotal(h))}</span></div>
        <div class="row"><span>Unrealized return</span><span class="${cls(gain(h))}">${money(gain(h), true)} (${pct(gainPct(h))})</span></div>
        <div class="row"><span>Current quantity</span><span>${num(h.shares)} shares</span></div>
      </div>
      <div class="card stat-card">
        <div class="row"><span>${isMarketOpen() ? "Current price" : "Closing price"}</span><span>${money(h.price)}</span></div>
        <div class="row"><span>Average cost basis</span><span>${money(h.cost)}/share</span></div>
        <div class="row"><span>${isMarketOpen() ? "Today's return" : "Last session's return"}</span><span class="${cls(dayChange(h))}">${money(dayChange(h), true)}</span></div>
      </div>
      <div class="card stat-card">
        <div class="row"><span>Portfolio weighting</span><span>${weight.toFixed(2)}% of portfolio</span></div>
        <div class="row"><span>Asset class</span><span>${esc(h.cls)}</span></div>
      </div>
      <div class="d-actions"><button class="cta" data-buy="${esc(h.symbol)}">Buy more</button><button class="cta ghost danger" data-remove="${esc(h.symbol)}">Remove</button></div>`;
  }

  function renderQuote(el, v) {
    const open = isMarketOpen();
    const hasRange = v.high && v.low && v.high > v.low;
    const pos = hasRange ? Math.min(100, Math.max(0, ((v.price - v.low) / (v.high - v.low)) * 100)) : 50;
    const ch = v.price - v.prev;
    el.innerHTML = `
      <div class="section-head"><h2>Stock</h2><button class="icon-btn" data-closeview aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="card pad quote-hero">
        <div class="d-head" style="margin-bottom:6px"><span class="tkr">${esc(v.symbol.slice(0, 4))}</span><div class="t"><h3>${esc(v.symbol)}</h3><div class="nm muted small">${esc(v.name)}</div></div></div>
        <div class="big px-now" style="font-size:36px">${money(v.price)}</div>
        <div class="${cls(ch)}"><b>${money(ch, true)} (${pct(dayPct(v))})</b> <span class="muted small">${open ? "today" : "last session"}</span></div>
        <div style="margin-top:8px">${badge(v)}${open ? "" : ` <span class="muted small">Market closed — showing the closing price</span>`}</div>
      </div>
      <div class="card pad" style="margin-bottom:12px">
        <div class="range" id="qrange" role="tablist" aria-label="Chart range">${["1D", "1W", "1M", "3M", "1Y", "2Y", "5Y", "10Y"].map((r) => `<button data-vr="${r}" class="${r === state.viewRange ? "on" : ""}">${r}</button>`).join("")}</div>
        <p id="qrange-change" class="small range-change" style="margin-top:10px"></p>
        <div id="qchart" class="chart" style="height:200px"></div>
      </div>
      <div class="card stat-card">
        <div class="row"><span>${open ? "Previous close" : "Prior close"}</span><span>${money(v.prev)}</span></div>
        <div class="row"><span>Open</span><span>${v.open ? money(v.open) : "—"}</span></div>
        <div class="row"><span>Day high</span><span>${v.high ? money(v.high) : "—"}</span></div>
        <div class="row"><span>Day low</span><span>${v.low ? money(v.low) : "—"}</span></div>
        ${hasRange ? `<div class="range-bar" aria-label="Day range"><span>${money(v.low)}</span><div class="track"><i style="left:${pos}%"></i></div><span>${money(v.high)}</span></div>` : ""}
      </div>
      <div class="d-actions"><button class="cta" data-buy="${esc(v.symbol)}">Add to portfolio</button><button class="cta ghost" data-watch="${esc(v.symbol)}">${isWatched(v.symbol) ? "Unwatch" : "Watch"}</button></div>
      <div class="section-head" style="margin-top:22px"><h2>${esc(v.symbol)} news</h2></div>
      <div id="quote-news" class="card list"><div class="muted small" style="padding:12px 0">Loading…</div></div>`;
    paintQuoteChart(v.symbol);
    loadQuoteNews(v.symbol);
  }

  let qSeq = 0;
  async function paintQuoteChart(sym) {
    const box = $("#qchart"), note = $("#qrange-change"), seq = ++qSeq, range = state.viewRange;
    if (!box) return;
    const msg = (m) => { box.innerHTML = `<div class="chart-msg">${m}</div>`; note.innerHTML = ""; };
    msg("Loading…");
    const sr = await history([sym], range);
    if (seq !== qSeq || !state.view || state.view.symbol !== sym || $("#qchart") !== box) return;
    const one = sr && sr[sym];
    if (!one || one.c.length < 2) return msg("Price history is unavailable right now.");
    const diff = one.c[one.c.length - 1] - one.c[0];
    note.innerHTML = `<span class="${cls(diff)}"><b>${money(diff, true)} (${pct((diff / one.c[0]) * 100)})</b></span> <span class="muted">${RANGE_LABEL[range]}</span>`;
    drawSeries(box, one.t, one.c, range);
  }
  const quoteNews = {};
  function paintQuoteNews(sym) {
    const box = $("#quote-news");
    if (!box || !state.view || state.view.symbol !== sym) return;
    const items = quoteNews[sym] || [];
    box.innerHTML = items.length
      ? items.map((n) => { const link = safeUrl(n.url); return `<article class="news-item"><div class="meta"><span>${esc(n.src)}</span><span>· ${ago(n.t)} ago</span></div><p>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>` : esc(n.title)}</p></article>`; }).join("")
      : `<div class="muted small" style="padding:12px 0">No recent news.</div>`;
  }
  async function loadQuoteNews(sym) {
    if (quoteNews[sym]) return paintQuoteNews(sym);
    const data = await api("/api/news?symbol=" + encodeURIComponent(sym));
    if (!data) return;
    quoteNews[sym] = data.news.slice(0, 4);
    paintQuoteNews(sym);
  }

  async function openQuote(sym, name) {
    const known = state.watch.find((w) => w.symbol === sym) || state.view;
    state.selected = null;
    state.view = { symbol: sym, name: name || (known && known.name) || sym, cls: "Stock", issuer: name || sym, price: 0, prev: 0 };
    if (known && known.symbol === sym) Object.assign(state.view, known);
    const data = await api("/api/quotes?symbols=" + encodeURIComponent(sym));
    const q = data && data.quotes[sym];
    if (q) Object.assign(state.view, { price: q.price, prev: q.prev, high: q.high, low: q.low, open: q.open, t: q.t });
    else if (!state.view.price) { state.view = null; state.selected = (state.holdings[0] || {}).symbol || null; renderHoldings(); renderDetail(); toast("No live quote available for " + sym); return; }
    renderHoldings(); renderDetail();
    $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleWatch(sym) {
    const i = state.watch.findIndex((w) => w.symbol === sym);
    if (i >= 0) { state.watch.splice(i, 1); toast(sym + " removed from watchlist"); }
    else if (state.view && state.view.symbol === sym) { const v = state.view; state.watch.push({ symbol: v.symbol, name: v.name, cls: v.cls, issuer: v.issuer, price: v.price, prev: v.prev, t: v.t }); toast(sym + " added to watchlist"); }
    save(); renderWatch(); renderDetail();
  }

  function confirmRemove(sym) {
    const h = state.holdings.find((x) => x.symbol === sym); if (!h) return;
    $("#order").innerHTML = `<div class="grab"></div><h3>Remove ${esc(sym)}?</h3>
      <p class="muted" style="text-align:center;margin-bottom:18px">This removes your position of ${num(h.shares)} shares (${money(value(h))}) from your portfolio.</p>
      <div class="d-actions"><button class="cta ghost" id="rm-cancel">Cancel</button><button class="cta danger-fill" id="rm-ok">Remove</button></div>`;
    $("#rm-cancel").onclick = closeSheets;
    $("#rm-ok").onclick = () => {
      state.holdings = state.holdings.filter((x) => x.symbol !== sym);
      state.selected = (state.holdings[0] || {}).symbol || null;
      save(); closeSheets(); renderAll(); toast(sym + " removed from portfolio");
    };
    openSheet($("#order"));
  }

  // ---------- watchlist & news ----------
  function renderWatch() {
    $("#watch").innerHTML = state.watch.length ? state.watch.map((w) => {
      const p = dayPct(w);
      return `<div class="item"><button class="item-main" data-view="${esc(w.symbol)}" aria-label="View ${esc(w.symbol)}"><span class="tkr">${esc(w.symbol.slice(0, 4))}</span>
        <span class="info"><b>${esc(w.symbol)}</b><span class="nm" style="display:block">${esc(w.name)}</span></span>
        <span class="val"><b>${money(w.price)}</b><span class="${cls(p)}">${pct(p)}</span></span></button>
        <button class="add-btn" data-buy="${esc(w.symbol)}" aria-label="Add ${esc(w.symbol)} to portfolio" title="Add to portfolio"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="add-btn rm" data-watch="${esc(w.symbol)}" aria-label="Remove ${esc(w.symbol)} from watchlist" title="Remove from watchlist"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
    }).join("") : `<div class="muted small" style="padding:14px 0">Your watchlist is empty. Search for a stock and tap Watch.</div>`;
  }
  const ago = (t) => { const m = Math.max(1, Math.round((Date.now() / 1000 - t) / 60)); return m < 60 ? m + "m" : m < 1440 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; };
  const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : "");
  function renderNews() {
    $("#news-list").innerHTML = state.news.map((n) => {
      const link = n.url && safeUrl(n.url);
      const title = link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>` : esc(n.title);
      return `<article class="news-item"><div class="meta"><span class="tag">${esc(n.tag)}</span><span>${esc(n.src)}</span><span>· ${n.t ? ago(n.t) + " ago" : esc(n.ago)}</span></div><p>${title}</p></article>`;
    }).join("");
  }

  // ---------- overlay / sheets ----------
  const overlay = $("#overlay");
  function openSheet(el) { overlay.hidden = false; el.hidden = false; }
  function closeSheets() { overlay.hidden = true; $("#sheet").hidden = true; $("#order").hidden = true; }
  overlay.addEventListener("click", closeSheets);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });

  const chip = (label, on, attr) => `<button class="chip ${on ? "on" : ""}" ${attr}="${esc(label)}" aria-pressed="${on}">${esc(label)}</button>`;
  function renderSheet() {
    $$("#sheet-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
    const body = $("#sheet-body");
    if (state.tab === "filter") {
      body.innerHTML = `<p class="desc">Customize what data you see, as well as how your positions are sorted and grouped.</p>
        <h4>Portfolio data display</h4><div class="chips">${["1D return", "Holdings", "Unrealized return", "price"].map((l) => chip(l, draft.metric === l, "data-metric")).join("")}</div>
        <h4>Sorting</h4><div class="chips">${["A to Z", "Top movers", "Highest", "Lowest"].map((l) => chip(l, draft.sort === l, "data-sort")).join("")}</div>`;
    } else if (state.tab === "groups") {
      body.innerHTML = `<p class="desc">Choose how your holdings are grouped.</p>
        <h4>Grouping</h4><div class="chips three">${["Single list", "Asset class", "Issuer"].map((l) => chip(l, draft.group === l, "data-group")).join("")}</div>
        <div class="switch-row"><span>Roll up options strategies</span><button class="switch" role="switch" aria-checked="${draft.rollup}" aria-label="Roll up options strategies" data-rollup></button></div>`;
    } else {
      body.innerHTML = `<p class="desc">Sections let you show or hide parts of the dashboard.</p><p class="muted small">Coming soon.</p><div style="height:90px"></div>`;
    }
  }
  $("#sheet-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.tab = b.dataset.tab; renderSheet();
  });
  $("#sheet-body").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.metric) draft.metric = b.dataset.metric;
    if (b.dataset.sort) draft.sort = b.dataset.sort;
    if (b.dataset.group) draft.group = b.dataset.group;
    if (b.hasAttribute("data-rollup")) draft.rollup = !draft.rollup;
    renderSheet();
  });
  const openFilter = () => { draft = { metric: state.metric, sort: state.sort, group: state.group, rollup: state.rollup }; state.tab = "filter"; renderSheet(); openSheet($("#sheet")); };
  $("#open-sheet").onclick = openFilter;
  $("#metric-pill").onclick = openFilter;
  $("#sheet-done").onclick = () => { Object.assign(state, draft); closeSheets(); renderHoldings(); };

  // ---------- buy order ----------
  const TIP = 0.06;
  let order = null;
  function openOrder(sym) {
    const item = find(sym); if (!item) return;
    order = { sym, amount: 5, tip: true };
    renderOrder(); openSheet($("#order"));
    const inp = $("#order input"); inp && inp.focus();
  }
  function renderOrder() {
    const it = find(order.sym);
    const shares = order.amount / it.price;
    const total = order.amount + (order.tip && order.amount > 0 ? TIP : 0);
    $("#order").innerHTML = `<div class="grab"></div>
      <div class="order-top"><button class="icon-btn" id="order-back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button><h3>Buy ${esc(it.symbol)}</h3><button class="icon-btn" id="order-close" aria-label="Close without placing order"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <label class="amount-wrap" aria-label="Order amount in dollars">$<input id="amt" inputmode="decimal" value="${order.amount}" style="width:${Math.max(String(order.amount).length, 2) + 1}ch"></label>
      <div class="card stat-card">
        <div class="row"><span class="muted">Payment method</span><span class="muted">Buying power</span></div>
        <div class="row"><span>Market price</span><span>${money(it.price)}</span></div>
        <div class="row"><span>Est. shares</span><span>${shares.toFixed(5)}</span></div>
        <div class="row"><span>Order amount</span><span>${money(order.amount)}</span></div>
        <div class="row"><span>One-time tip</span><span>${order.tip && order.amount > 0 ? "+" + money(TIP) : "$0.00"}</span></div>
        <div class="row total"><span>Total cost</span><span>${money(total)}</span></div>
      </div>
      <div class="tip"><button class="check" role="checkbox" aria-checked="${order.tip}" aria-label="Include tip" id="tipchk"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></button>
        <div>Tip ${money(TIP)} to support fair markets.<small>We don't accept payment for order flow on equities trades.</small></div></div>
      <button class="cta" id="place" ${order.amount > 0 ? "" : "disabled style=\"opacity:.4\""}>Place order</button>`;
    $("#order-close").onclick = closeSheets;
    $("#order-back").onclick = closeSheets;
    $("#tipchk").onclick = () => { order.tip = !order.tip; renderOrder(); };
    const a = $("#amt");
    a.oninput = () => { const v = parseFloat(a.value); order.amount = isFinite(v) && v >= 0 ? v : 0; const pos = a.selectionStart; renderOrder(); const n = $("#amt"); n.focus(); n.setSelectionRange(pos, pos); };
    $("#place").onclick = placeOrder;
  }
  function placeOrder() {
    const it = find(order.sym);
    const shares = order.amount / it.price;
    let h = state.holdings.find((x) => x.symbol === it.symbol);
    if (h) {
      h.cost = (h.shares * h.cost + shares * it.price) / (h.shares + shares);
      h.shares += shares;
    } else {
      state.holdings.push({ symbol: it.symbol, name: it.name, cls: it.cls || "Stock", issuer: it.issuer || it.name, price: it.price, prev: it.prev, t: it.t, shares, cost: it.price });
    }
    state.watch = state.watch.filter((w) => w.symbol !== it.symbol);
    state.view = null;
    state.selected = it.symbol;
    save(); closeSheets(); renderAll();
    toast(`Bought ${shares.toFixed(5)} ${it.symbol} for ${money(order.amount)}`);
  }
  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

  // ---------- search ----------
  const universe = () => [...state.holdings, ...state.watch.filter((w) => !state.holdings.some((h) => h.symbol === w.symbol))];
  const input = $("#search"), results = $("#search-results");
  let searchSeq = 0, searchTimer;
  const showResults = (hits, q) => {
    results.innerHTML = hits.length
      ? hits.map((s) => `<li data-sym="${esc(s.symbol)}" data-name="${esc(s.name)}"><span class="tkr">${esc(s.symbol.slice(0, 4))}</span><span><b>${esc(s.symbol)}</b><div class="muted small">${esc(s.name)}</div></span></li>`).join("")
      : `<li class="empty">No matches for "${esc(q)}"</li>`;
    results.hidden = false;
  };
  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(searchTimer);
    if (!q) { results.hidden = true; return; }
    const local = universe().filter((s) => s.symbol.toLowerCase().includes(q.toLowerCase()) || s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
    if (!state.live) { showResults(local, q); return; }
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      const data = await api("/api/search?q=" + encodeURIComponent(q));
      if (seq !== searchSeq) return;
      showResults(data ? data.results : local, q);
    }, 250);
  });
  results.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-sym]"); if (!li) return;
    const sym = li.dataset.sym, name = li.dataset.name;
    results.hidden = true; input.value = "";
    if (state.holdings.some((h) => h.symbol === sym)) { state.view = null; state.selected = sym; renderHoldings(); renderDetail(); $("#detail").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    openQuote(sym, name);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) results.hidden = true; });

  // ---------- events ----------
  $("#range").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.range = b.dataset.r;
    $$("#range button").forEach((x) => x.classList.toggle("on", x === b));
    renderChart();
  });
  $("#holdings").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sym]"); if (!b) return;
    state.view = null; state.selected = b.dataset.sym; renderHoldings(); renderDetail();
    if (matchMedia("(max-width:1080px)").matches) $("#detail").scrollIntoView({ behavior: "smooth" });
  });
  document.addEventListener("click", (e) => {
    const vr = e.target.closest("[data-vr]");
    if (vr) { state.viewRange = vr.dataset.vr; $$("#qrange button").forEach((x) => x.classList.toggle("on", x === vr)); return paintQuoteChart(state.view.symbol); }
    const b = e.target.closest("[data-buy]"); if (b) return openOrder(b.dataset.buy);
    const r = e.target.closest("[data-remove]"); if (r) return confirmRemove(r.dataset.remove);
    const w = e.target.closest("[data-watch]"); if (w) return toggleWatch(w.dataset.watch);
    const v = e.target.closest("[data-view]"); if (v) return openQuote(v.dataset.view);
    if (e.target.closest("[data-closeview]")) { state.view = null; state.selected = (state.holdings[0] || {}).symbol || null; renderHoldings(); renderDetail(); }
  });

  // nav highlight
  const links = $$("[data-nav]");
  const secs = ["overview", "portfolio", "watchlist", "news"].map((id) => document.getElementById(id));
  const io = new IntersectionObserver((ents) => {
    ents.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id)); });
  }, { rootMargin: "-30% 0px -60% 0px" });
  secs.forEach((s) => io.observe(s));

  // ---------- live data (Finnhub via local proxy) ----------
  async function api(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) { const e = await r.json().catch(() => ({})); lastError = e.error || "HTTP " + r.status; return null; }
      lastError = "";
      return await r.json();
    } catch { lastError = "Server unreachable"; return null; }
  }
  let lastError = "";
  function setStatus() {
    const open = isMarketOpen();
    $(".market-status").innerHTML = state.live
      ? `<span class="dot"></span><span id="market-label">${open ? "Market open · live" : "Market closed · last close"}</span>`
      : `<span class="dot" style="background:var(--red);animation:none;box-shadow:none"></span><span id="market-label">Sample data${lastError ? " · " + esc(lastError) : ""}</span>`;
    $(".side-foot").textContent = (state.live ? "Live data via Finnhub" : "Sample data") + " · not financial advice";
  }
  function isMarketOpen() {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
    const g = (t) => p.find((x) => x.type === t).value;
    const mins = (+g("hour") % 24) * 60 + +g("minute");
    return !["Sat", "Sun"].includes(g("weekday")) && mins >= 570 && mins < 960;
  }
  async function poll() {
    if (document.hidden) return;
    const syms = [...new Set([...state.holdings, ...state.watch, ...(state.view ? [state.view] : []), ...state.indices.map((i) => ({ symbol: i.proxy }))].map((x) => x.symbol))];
    const data = await api("/api/quotes?symbols=" + syms.join(","));
    state.live = !!data;
    if (data) {
      const prev = Object.fromEntries(state.holdings.map((h) => [h.symbol, h.price]));
      const apply = (x) => { const q = data.quotes[x.symbol]; if (q) { x.price = q.price; x.prev = q.prev; x.t = q.t; if (x === state.view) { x.high = q.high; x.low = q.low; x.open = q.open; } } };
      state.holdings.forEach(apply); state.watch.forEach(apply); if (state.view) apply(state.view);
      save();
      state.indices.forEach((i) => { const q = data.quotes[i.proxy]; if (q) { i.price = q.price; i.prev = q.prev; } });
      renderTotals(); renderIndices(); renderHoldings(); renderDetail(); renderWatch();
      state.holdings.forEach((h) => {
        if (h.price === prev[h.symbol]) return;
        const el = $(`.holding[data-sym="${h.symbol}"] .val b`);
        if (el) el.classList.add(h.price > prev[h.symbol] ? "flash-up" : "flash-down");
      });
    }
    setStatus();
  }
  async function loadNews() {
    const data = await api("/api/news");
    if (data && data.news.length) { state.news = data.news; renderNews(); }
  }


  // ---------- theme: light / dark / auto ----------
  const THEME_KEY = "investcap.theme";
  function currentMode() { try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; } }
  function applyTheme(mode, persist) {
    const root = document.documentElement;
    if (mode === "auto") delete root.dataset.theme; else root.dataset.theme = mode;
    if (persist) { try { mode === "auto" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, mode); } catch {} }
    $$("#theme-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === mode)));
    const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    $('meta[name="theme-color"]').setAttribute("content", dark ? "#0a0e0b" : "#f3f6f4");
    // SVG colors are read from CSS variables at draw time, so redraw anything that uses them
    if (typeof renderAll === "function" && state.holdings) { renderChart(); renderHoldings(); renderDetail(); if (state.view) paintQuoteChart(state.view.symbol); }
  }
  $("#theme-switch").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) applyTheme(b.dataset.theme, true); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (currentMode() === "auto") applyTheme("auto", false); });

  function renderAll() { renderTotals(); renderChart(); loadSparks(); renderIndices(); renderHoldings(); renderDetail(); renderWatch(); renderNews(); }
  renderAll();
  applyTheme(currentMode(), false);
  setStatus();
  poll();
  loadNews();
  // Free Finnhub plan allows ~60 calls/min: poll every 30s while the market is open, every 5 min when closed.
  (function loop() { setTimeout(async () => { await poll(); loop(); }, isMarketOpen() ? 30000 : 300000); })();
  setInterval(loadNews, 300000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); // installable + offline shell (needs https or localhost)
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
})();
