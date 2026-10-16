/* Magic Spices — дашборд, помощник, страницы, настройки */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
  var MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function mLabel(k) { return MON[k % 12] + ' ' + String(Math.floor(k / 12)).slice(2); }
  function mFull(k) { return Core.ymLabel(k) + ' ' + Core.ymYear(k); }
  function sum(o) { var s = 0; if (o) for (var k in o) s += +o[k] || 0; return s; }
  function nf(n, d) {
    if (n == null || !isFinite(n)) return '—';
    var r = Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0);
    var parts = String(Math.abs(r)).split('.');
    return (r < 0 ? '−' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (parts[1] ? ',' + parts[1] : '');
  }
  function money(n) { var c = App.settings.currency || ''; return nf(n) + (c ? ' ' + c : ''); }
  function short(n) {
    var a = Math.abs(n);
    if (a >= 1e6) return nf(n / 1e6, 1) + ' млн';
    if (a >= 1e4) return nf(n / 1e3, 0) + ' тыс';
    return nf(n);
  }

  // ======================= API =======================
  var App = window.App = { key: lsGet('ms.key', ''), status: null, periods: [], settings: {}, pages: [] };
  function api(path, opts) {
    opts = opts || {};
    var h = { 'x-site-key': App.key };
    if (opts.body !== undefined) h['content-type'] = 'application/json';
    return fetch('/api/' + path, { method: opts.method || 'GET', headers: h, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401) { showLogin('Пароль не подошёл или устарел. Введите его ещё раз.'); throw new Error('auth'); }
          if (!r.ok) throw new Error(d.error || ('Ошибка ' + r.status));
          return d;
        });
      });
  }
  App.api = api;
  var settingsTimer = null, settingsPatch = {};
  App.saveSettings = function (patch) {
    Object.assign(App.settings, patch); Object.assign(settingsPatch, patch);
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function () {
      var p = settingsPatch; settingsPatch = {};
      api('settings', { method: 'PUT', body: p }).catch(function (e) { if (e.message !== 'auth') toast('Настройки не сохранились: ' + e.message); });
    }, 600);
  };
  App.savePeriod = function (p) {
    return api('periods/' + encodeURIComponent(p.id), { method: 'PUT', body: p }).then(function () {
      var i = App.periods.findIndex(function (x) { return x.id === p.id; });
      if (i >= 0) App.periods[i] = p; else App.periods.push(p);
      sortPeriods(); route(); return p;
    });
  };
  function sortPeriods() { App.periods.sort(function (a, b) { return a.months[a.months.length - 1] - b.months[b.months.length - 1]; }); }

  // ======================= вход =======================
  function showLogin(msg) {
    document.body.classList.add('locked');
    $('loginView').hidden = false; $('appView').hidden = true;
    $('loginErr').textContent = msg || '';
    setTimeout(function () { $('loginPass').focus(); }, 50);
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    App.key = $('loginPass').value; lsSet('ms.key', App.key);
    loadAll();
  });
  $('logout').addEventListener('click', function () { App.key = ''; lsSet('ms.key', ''); showLogin(''); });

  function loadAll() {
    return Promise.all([api('periods'), api('settings'), api('pages')]).then(function (r) {
      App.periods = r[0] || []; App.settings = r[1] || {}; App.pages = r[2] || [];
      sortPeriods();
      $('loginView').hidden = true; $('appView').hidden = false; document.body.classList.remove('locked');
      if (window.Calc) window.Calc.reload();
      route();
    }).catch(function (e) { if (e.message !== 'auth') showLogin('Сервер не отвечает: ' + e.message); });
  }

  // ======================= маршруты =======================
  var VIEWS = ['dash', 'ai', 'calc', 'pages', 'settings'];
  function route() {
    var h = (location.hash || '#dash').slice(1).split('/');
    var v = VIEWS.indexOf(h[0]) >= 0 ? h[0] : 'dash';
    VIEWS.forEach(function (x) { $('v-' + x).hidden = x !== v; });
    document.querySelectorAll('nav.tabs a').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('href') === '#' + v ? 'page' : 'false'); });
    if (v === 'dash') renderDash();
    if (v === 'ai') renderAI();
    if (v === 'pages') renderPages(h[1]);
    if (v === 'settings') renderSettings();
  }
  window.addEventListener('hashchange', function () { route(); window.scrollTo(0, 0); });

  // ======================= аналитика =======================
  function packOf(name) { var m = String(name).match(/[*\/х]\s*(\d{1,3})\s*(?:шт)?\s*(?:[^\d\/*]*)$/i); var n = m ? +m[1] : 0; return n >= 2 && n <= 200 ? n : 1; }
  function analyze(pid) {
    var P = App.periods;
    if (!P.length) return null;
    var idx = pid ? P.findIndex(function (p) { return p.id === pid; }) : P.length - 1;
    if (idx < 0) idx = P.length - 1;
    var cur = P[idx], prev = idx > 0 ? P[idx - 1] : null;
    var target = +App.settings.targetMonths || 2;
    // помесячно по всем периодам
    var months = {};
    P.forEach(function (p) {
      p.rows.forEach(function (r) {
        [['a', 'a'], ['vs', 'vs'], ['p', 'p'], ['aS', 'aS'], ['vsS', 'vsS'], ['pS', 'pS']].forEach(function (k) {
          var o = r[k[0]]; if (!o) return;
          for (var m in o) { months[m] = months[m] || { a: 0, vs: 0, p: 0, aS: 0, vsS: 0, pS: 0, money: false }; months[m][k[1]] += +o[m] || 0; if (k[0].slice(-1) === 'S') months[m].money = true; }
        });
      });
      p.months.forEach(function (m) { months[m] = months[m] || { a: 0, vs: 0, p: 0, aS: 0, vsS: 0, pS: 0, money: false }; });
    });
    var mkeys = Object.keys(months).map(Number).sort(function (a, b) { return a - b; });
    var prevMap = {};
    if (prev) prev.rows.forEach(function (r) { prevMap[Core.key(r.name)] = r; });
    var n = cur.months.length;
    var items = cur.rows.map(function (r) {
      var sales = sum(r.a) + sum(r.vs), rev = sum(r.aS) + sum(r.vsS);
      var avg = sales / n;
      var pr = prevMap[Core.key(r.name)], prevAvg = pr ? (sum(pr.a) + sum(pr.vs)) / prev.months.length : null;
      var pack = packOf(r.name);
      var need = avg > 0 ? Math.ceil(target * avg - Math.max(r.close, 0)) : 0;
      if (need > 0 && pack > 1) need = Math.ceil(need / pack) * pack;
      var lastIn = null; cur.months.forEach(function (m) { if (r.p && r.p[m]) lastIn = m; });
      return { name: r.name, unit: r.unit, open: r.open, close: r.close, sales: sales, a: sum(r.a), vs: sum(r.vs), receipts: sum(r.p), rev: rev,
        avg: avg, cover: avg > 0 ? r.close / avg : (r.close > 0 ? Infinity : 0), prevAvg: prevAvg, pack: pack, need: need > 0 ? need : 0, lastIn: lastIn, row: r };
    });
    var hints = [];
    items.forEach(function (it) {
      if (it.close < 0) hints.push({ sev: 'critical', ic: '!', h: 'Минус: ' + it.name, b: 'Остаток на ' + cur.closeLabel + ': ' + nf(it.close) + ' шт. Продано больше, чем было на складе и пришло — проверьте приход и названия.', it: it });
      else if (it.avg > 0 && it.cover < 1) hints.push({ sev: 'warning', ic: '↓', h: 'Заканчивается: ' + it.name, b: 'Остаток ' + nf(it.close) + ' шт — это ' + nf(it.cover, 1) + ' мес. продаж (в среднем ' + nf(it.avg) + ' шт/мес). Заказать ≈ ' + nf(it.need) + ' шт.', it: it });
    });
    items.forEach(function (it) {
      if (it.prevAvg != null && it.prevAvg >= 10 && it.avg < it.prevAvg * 0.6) hints.push({ sev: 'warning', ic: '↘', h: 'Продажи упали: ' + it.name, b: 'В среднем ' + nf(it.avg) + ' шт/мес против ' + nf(it.prevAvg) + ' в прошлом периоде (' + nf((it.avg / it.prevAvg - 1) * 100) + '%).', it: it });
    });
    items.forEach(function (it) {
      if (it.close > 0 && it.sales === 0) hints.push({ sev: 'info', ic: '·', h: 'Без продаж: ' + it.name, b: 'Лежит ' + nf(it.close) + ' шт, за период ни одной продажи.', it: it });
    });
    items.forEach(function (it) {
      if (it.prevAvg != null && it.prevAvg >= 10 && it.avg > it.prevAvg * 1.5) hints.push({ sev: 'good', ic: '↗', h: 'Рост продаж: ' + it.name, b: nf(it.avg) + ' шт/мес против ' + nf(it.prevAvg) + ' в прошлом периоде (+' + nf((it.avg / it.prevAvg - 1) * 100) + '%).', it: it });
    });
    var t = { close: 0, sales: 0, rev: 0, a: 0, vs: 0, receipts: 0, neg: 0, order: 0, dead: 0 };
    items.forEach(function (it) {
      t.close += it.close; t.sales += it.sales; t.rev += it.rev; t.a += it.a; t.vs += it.vs; t.receipts += it.receipts;
      if (it.close < 0) t.neg++; if (it.need > 0) t.order++; if (it.close > 0 && it.sales === 0) t.dead++;
    });
    var tp = null;
    if (prev) { tp = { sales: 0, rev: 0 }; prev.rows.forEach(function (r) { tp.sales += sum(r.a) + sum(r.vs); tp.rev += sum(r.aS) + sum(r.vsS); }); }
    var hasMoney = cur.rows.some(function (r) { return r.aS || r.vsS; });
    return { cur: cur, prev: prev, items: items, hints: hints, t: t, tp: tp, months: months, mkeys: mkeys, hasMoney: hasMoney, target: target };
  }
  App.analyze = analyze;

  // ======================= графики =======================
  var tipEl = null;
  function tip(html, x, y, box) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; }
    if (html == null) { tipEl.remove(); return; }
    box.appendChild(tipEl); tipEl.innerHTML = html;
    var w = box.clientWidth, tw = tipEl.offsetWidth;
    tipEl.style.left = Math.min(Math.max(x, tw / 2 + 4), w - tw / 2 - 4) + 'px'; tipEl.style.top = (y - 8) + 'px';
  }
  // сгруппированные столбцы: categories × series
  function barChart(box, cats, series, fmtV, fmtTip) {
    var W = Math.max(box.clientWidth, 280), H = 240, padL = 52, padB = 26, padT = 10, padR = 8;
    var max = 0; series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    if (!max) { box.innerHTML = '<p class="small muted">Нет данных для графика.</p>'; return; }
    var step = Math.pow(10, Math.floor(Math.log10(max))), nice = Math.ceil(max / step) * step;
    if (nice / step > 6) step *= 2; nice = Math.ceil(max / step) * step;
    var ih = H - padT - padB, iw = W - padL - padR, gw = iw / cats.length, gap = 2, bw = Math.max(3, Math.min(26, (gw * 0.7 - gap * (series.length - 1)) / series.length));
    var y = function (v) { return padT + ih - v / nice * ih; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(series.map(function (x) { return x.name; }).join(', ')) + '">';
    for (var g = 0; g <= nice + 1e-9; g += step) s += '<line class="gl" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(g) + '" y2="' + y(g) + '"/><text x="' + (padL - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + esc(fmtV(g)) + '</text>';
    var every = Math.ceil(cats.length / Math.max(1, Math.floor(iw / 56)));
    cats.forEach(function (c, i) {
      var x0 = padL + i * gw + (gw - (bw * series.length + gap * (series.length - 1))) / 2;
      s += '<g data-i="' + i + '">';
      series.forEach(function (se, j) {
        var v = se.values[i] || 0, x = x0 + j * (bw + gap), yy = y(v), h = padT + ih - yy;
        if (h > 0) s += '<path d="M' + x + ' ' + (padT + ih) + 'V' + (yy + Math.min(4, h)) + 'q0 -' + Math.min(4, h) + ' ' + Math.min(4, bw / 2) + ' -' + Math.min(4, h) + 'H' + (x + bw - Math.min(4, bw / 2)) + 'q' + Math.min(4, bw / 2) + ' 0 ' + Math.min(4, bw / 2) + ' ' + Math.min(4, h) + 'V' + (padT + ih) + 'Z" fill="var(' + se.color + ')"/>';
      });
      s += '</g>';
      if (i % every === 0) s += '<text x="' + (padL + i * gw + gw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(c) + '</text>';
      s += '<rect class="hit" data-i="' + i + '" x="' + (padL + i * gw) + '" y="' + padT + '" width="' + gw + '" height="' + ih + '"/>';
    });
    s += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + ih) + '" y2="' + (padT + ih) + '" stroke="var(--muted)" stroke-width="1"/></svg>';
    box.innerHTML = s;
    box.querySelectorAll('.hit').forEach(function (r) {
      r.addEventListener('mousemove', function (e) {
        var i = +r.dataset.i, b = box.getBoundingClientRect();
        tip(fmtTip(i), e.clientX - b.left, e.clientY - b.top, box);
      });
      r.addEventListener('mouseleave', function () { tip(null); });
    });
  }
  function legend(series) { return '<div class="legend2">' + series.map(function (s) { return '<span><i style="background:var(' + s.color + ')"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>'; }

  // ======================= дашборд =======================
  var dashState = { pid: null, unit: 'money', topBy: 'money' };
  function renderDash() {
    var box = $('dash');
    if (!App.periods.length) {
      box.innerHTML = '<div class="empty-state"><h2>Пока нет данных</h2><p class="muted">Дашборд строится по сохранённым сводным. Соберите сводный во вкладке «Сводный» и нажмите «Сохранить в дашборд», или загрузите уже готовый сводный Excel в «Настройках».</p>' +
        '<div class="row"><a class="lbtn primary" href="#calc">Собрать сводный</a><a class="lbtn" href="#settings">Загрузить готовый</a></div></div>';
      return;
    }
    var A = analyze(dashState.pid);
    if (!A.hasMoney && dashState.unit === 'money') dashState.unit = 'qty';
    var cur = A.cur, t = A.t, tp = A.tp;
    function delta(a, b) {
      if (b == null || !b) return '';
      var d = (a / b - 1) * 100;
      return '<span class="' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '▲ +' : '▼ ') + nf(d) + '%</span> к пред. периоду';
    }
    var html = '<div class="periodbar"><div style="display:grid;gap:2px"><span class="small muted">Период</span><span class="period">' + esc(cur.label) + '</span></div>' +
      '<div class="row"><label class="small muted" for="pSel">Показать</label><select id="pSel" class="btn" style="font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)">' +
      App.periods.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === cur.id ? ' selected' : '') + '>' + esc(p.label) + (p.source === 'import' ? ' (импорт)' : '') + '</option>'; }).join('') + '</select></div></div>';
    html += '<div class="kpis">' +
      kpi('Остаток на ' + (cur.closeLabel || 'конец'), nf(t.close) + ' шт', A.items.length + ' позиций') +
      kpi('Продажи за период', nf(t.sales) + ' шт', delta(t.sales, tp && tp.sales) || ('А ' + nf(t.a) + ' · ВС ' + nf(t.vs))) +
      (A.hasMoney ? kpi('Выручка за период', short(t.rev) + (App.settings.currency ? ' ' + esc(App.settings.currency) : ''), delta(t.rev, tp && tp.rev) || 'А + ВС') : kpi('Выручка', '—', 'в этом периоде нет сумм')) +
      kpi('Приход', nf(t.receipts) + ' шт', 'за ' + cur.months.length + ' мес.') +
      kpi('Минус на конец', String(t.neg), t.neg ? 'позиций ушло в минус' : 'всё в порядке', t.neg ? 'alert' : '') +
      kpi('Пора заказать', String(t.order), 'запас меньше ' + A.target + ' мес.') + '</div>';
    html += '<div class="two">' +
      '<section class="panel"><div class="row spread"><h2>Продажи по месяцам</h2><div class="seg" id="unitSeg">' +
      (A.hasMoney || A.mkeys.some(function (m) { return A.months[m].money; }) ? '<button type="button" data-u="money" aria-pressed="' + (dashState.unit === 'money') + '">Деньги</button>' : '') +
      '<button type="button" data-u="qty" aria-pressed="' + (dashState.unit === 'qty') + '">Штуки</button></div></div>' +
      legend([{ name: 'Реализация А', color: '--s1' }, { name: 'Реал ВС', color: '--s2' }]) + '<div class="chart" id="chMonths"></div>' +
      (dashState.unit === 'money' && A.mkeys.some(function (m) { return !A.months[m].money; }) ? '<p class="small muted">За ' + A.mkeys.filter(function (m) { return !A.months[m].money; }).map(mLabel).join(', ') + ' сумм нет: эти месяцы загружены из готового Excel. Переключите на «Штуки», чтобы сравнить.</p>' : '') +
      '<details><summary class="small muted">Таблица</summary><div class="scrollbox" style="max-height:260px;margin-top:8px"><table class="dtable"><thead><tr><th>Месяц</th><th class="n">А, шт</th><th class="n">ВС, шт</th><th class="n">А, сумма</th><th class="n">ВС, сумма</th><th class="n">Приход, шт</th></tr></thead><tbody>' +
      A.mkeys.map(function (m) { var x = A.months[m]; return '<tr><td>' + esc(mFull(m)) + '</td><td class="n">' + nf(x.a) + '</td><td class="n">' + nf(x.vs) + '</td><td class="n">' + (x.money ? nf(x.aS) : '—') + '</td><td class="n">' + (x.money ? nf(x.vsS) : '—') + '</td><td class="n">' + nf(x.p) + '</td></tr>'; }).join('') +
      '</tbody></table></div></details></section>' +
      '<section class="panel"><div class="row spread"><h2>Топ-10 товаров</h2><div class="seg" id="topSeg">' +
      (A.hasMoney ? '<button type="button" data-t="money" aria-pressed="' + (dashState.topBy === 'money') + '">Выручка</button>' : '') +
      '<button type="button" data-t="qty" aria-pressed="' + (dashState.topBy === 'qty' || !A.hasMoney) + '">Штуки</button></div></div><div id="top"></div></section></div>';
    html += '<div class="two"><section class="panel"><div class="row spread"><h2>Что требует внимания</h2><span class="small muted">' + A.hints.length + '</span></div><div class="hints" id="hints"></div></section>' +
      '<section class="panel"><div class="row spread"><h2>Что заказать</h2><span class="small muted">запас на ' + A.target + ' мес.</span></div>' +
      '<div class="scrollbox" style="max-height:900px"><table class="dtable"><thead><tr><th>Товар</th><th class="n">Остаток</th><th class="n">шт/мес</th><th class="n">Хватит, мес</th><th class="n">Заказать</th></tr></thead><tbody>' +
      A.items.filter(function (i) { return i.need > 0; }).sort(function (a, b) { return a.cover - b.cover; }).map(function (i) {
        return '<tr><td class="link" data-prod="' + esc(i.name) + '">' + esc(i.name) + '</td><td class="n">' + nf(i.close) + '</td><td class="n">' + nf(i.avg) + '</td><td class="n">' + (i.close <= 0 ? '0' : isFinite(i.cover) ? nf(i.cover, 1) : '—') + '</td><td class="n"><b>' + nf(i.need) + '</b></td></tr>';
      }).join('') + '</tbody></table></div></section></div>';
    html += '<section class="panel"><div class="row spread"><h2>Товар</h2><span class="small muted">история по всем сохранённым периодам</span></div>' +
      '<div class="prod-search"><input type="search" id="prodQ" list="prodList" placeholder="Начните вводить название товара"><datalist id="prodList">' +
      A.items.map(function (i) { return '<option value="' + esc(i.name) + '">'; }).join('') + '</datalist></div></section>';
    box.innerHTML = html;

    $('pSel').onchange = function () { dashState.pid = this.value; renderDash(); };
    box.querySelectorAll('#unitSeg button').forEach(function (b) { b.onclick = function () { dashState.unit = b.dataset.u; renderDash(); }; });
    box.querySelectorAll('#topSeg button').forEach(function (b) { b.onclick = function () { dashState.topBy = b.dataset.t; renderDash(); }; });
    box.querySelectorAll('[data-prod]').forEach(function (td) { td.onclick = function () { openProduct(td.dataset.prod); }; });
    $('prodQ').onchange = function () { var v = this.value.trim(); if (A.items.some(function (i) { return i.name === v; })) openProduct(v); };

    // график
    var mk = A.mkeys, isM = dashState.unit === 'money';
    var cats = mk.map(mLabel);
    var ser = [{ name: 'Реализация А', color: '--s1', values: mk.map(function (m) { return isM ? A.months[m].aS : A.months[m].a; }) },
               { name: 'Реал ВС', color: '--s2', values: mk.map(function (m) { return isM ? A.months[m].vsS : A.months[m].vs; }) }];
    var drawMonths = function () {
      barChart($('chMonths'), cats, ser, short, function (i) {
        var x = A.months[mk[i]];
        return '<b>' + esc(mFull(mk[i])) + '</b><br>А: ' + (isM ? (x.money ? money(x.aS) : 'нет сумм') : nf(x.a) + ' шт') + '<br>ВС: ' + (isM ? (x.money ? money(x.vsS) : 'нет сумм') : nf(x.vs) + ' шт');
      });
    };
    drawMonths();
    lastDraw = drawMonths;

    // топ
    var byM = dashState.topBy === 'money' && A.hasMoney;
    var top = A.items.slice().sort(function (a, b) { return byM ? b.rev - a.rev : b.sales - a.sales; }).slice(0, 10);
    var mx = top.length ? (byM ? top[0].rev : top[0].sales) : 1;
    $('top').innerHTML = top.map(function (i) {
      var v = byM ? i.rev : i.sales;
      return '<div class="hbar"><span class="nm" data-prod="' + esc(i.name) + '" title="' + esc(i.name) + '">' + esc(i.name) + '</span><div class="track"><div class="fill" style="width:' + Math.max(1, v / mx * 100) + '%"></div></div><span class="val">' + (byM ? short(v) : nf(v)) + '</span></div>';
    }).join('');
    $('top').querySelectorAll('[data-prod]').forEach(function (el) { el.onclick = function () { openProduct(el.dataset.prod); }; });

    // подсказки
    var order = { critical: 0, warning: 1, info: 3, good: 2 };
    var hs = A.hints.slice().sort(function (a, b) { return order[a.sev] - order[b.sev]; });
    var SEVN = { critical: 'срочно', warning: 'внимание', info: 'к сведению', good: 'хорошо' };
    var showN = dashState.allHints ? hs.length : 12;
    $('hints').innerHTML = hs.length ? hs.slice(0, showN).map(function (h, k) {
      return '<div class="hint ' + h.sev + '"><span class="ic" aria-hidden="true">' + h.ic + '</span><div style="min-width:0"><div class="row" style="gap:6px"><span class="sev ' + h.sev + '">' + SEVN[h.sev] + '</span><span class="h">' + esc(h.h) + '</span></div><div class="b">' + esc(h.b) + '</div></div>' +
        '<button type="button" class="ghost" data-ask="' + k + '">Спросить</button></div>';
    }).join('') + (hs.length > showN ? '<button type="button" id="moreHints">Показать все (' + hs.length + ')</button>' : (dashState.allHints && hs.length > 12 ? '<button type="button" id="moreHints">Свернуть</button>' : '')) : '<p class="small muted">Ничего срочного.</p>';
    var mh = $('moreHints'); if (mh) mh.onclick = function () { dashState.allHints = !dashState.allHints; renderDash(); };
    $('hints').querySelectorAll('[data-ask]').forEach(function (b) {
      b.onclick = function () { var h = hs[+b.dataset.ask]; askAI('Разбери ситуацию: «' + h.h + '». ' + h.b + ' Что посоветуешь сделать?'); };
    });
  }
  function kpi(l, v, d, cls) { return '<div class="kpi ' + (cls || '') + '"><span class="l">' + esc(l) + '</span><span class="v">' + v + '</span><span class="d">' + (d || '') + '</span></div>'; }
  var lastDraw = null, rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (lastDraw && !$('v-dash').hidden) lastDraw(); }, 150); });

  function openProduct(name) {
    var k = Core.key(name), hist = [];
    App.periods.forEach(function (p) {
      var r = p.rows.find(function (x) { return Core.key(x.name) === k; });
      if (r) hist.push({ p: p, r: r });
    });
    var mk = {};
    hist.forEach(function (h) { h.p.months.forEach(function (m) { mk[m] = { a: (h.r.a || {})[m] || 0, vs: (h.r.vs || {})[m] || 0, p: (h.r.p || {})[m] || 0, s: ((h.r.aS || {})[m] || 0) + ((h.r.vsS || {})[m] || 0) }; }); });
    var keys = Object.keys(mk).map(Number).sort(function (a, b) { return a - b; });
    var back = document.createElement('div'); back.className = 'dialog-back';
    back.innerHTML = '<div class="dialog" role="dialog" aria-modal="true" aria-label="' + esc(name) + '"><div class="row spread"><h2>' + esc(name) + '</h2><button type="button" class="ghost" id="dlgClose">Закрыть</button></div>' +
      '<div class="kpis">' + hist.map(function (h) { return kpi(h.p.label, nf(h.r.close) + ' шт', 'остаток на ' + (h.p.closeLabel || 'конец')); }).join('') + '</div>' +
      legend([{ name: 'Реализация А', color: '--s1' }, { name: 'Реал ВС', color: '--s2' }]) + '<div class="chart" id="pChart"></div>' +
      '<div class="scrollbox" style="max-height:300px"><table class="dtable"><thead><tr><th>Месяц</th><th class="n">Приход</th><th class="n">А</th><th class="n">ВС</th><th class="n">Выручка</th></tr></thead><tbody>' +
      keys.map(function (m) { var x = mk[m]; return '<tr><td>' + esc(mFull(m)) + '</td><td class="n">' + nf(x.p) + '</td><td class="n">' + nf(x.a) + '</td><td class="n">' + nf(x.vs) + '</td><td class="n">' + (x.s ? nf(x.s) : '—') + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="row"><button type="button" class="primary" id="dlgAsk">Спросить помощника про этот товар</button></div></div>';
    document.body.appendChild(back);
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    $('dlgClose').onclick = close;
    $('dlgAsk').onclick = function () { close(); askAI('Проанализируй товар «' + name + '»: динамика продаж по каналам, остаток, хватит ли до следующей поставки и сколько заказать.'); };
    barChart($('pChart'), keys.map(mLabel), [{ name: 'А', color: '--s1', values: keys.map(function (m) { return mk[m].a; }) }, { name: 'ВС', color: '--s2', values: keys.map(function (m) { return mk[m].vs; }) }], nf,
      function (i) { var x = mk[keys[i]]; return '<b>' + esc(mFull(keys[i])) + '</b><br>А: ' + nf(x.a) + ' шт<br>ВС: ' + nf(x.vs) + ' шт<br>Приход: ' + nf(x.p) + ' шт'; });
    $('dlgClose').focus();
  }

  // ======================= помощник =======================
  var chat = lsGet('ms.chat', []), sending = false;
  var SUGGEST = ['Что заказать в первую очередь и сколько?', 'Какие товары продаются хуже, чем в прошлом периоде?', 'Сравни выручку А и ВС по месяцам', 'Почему некоторые позиции ушли в минус?', 'Какие 10 товаров дают больше всего выручки?'];
  function buildContext() {
    var P = App.periods; if (!P.length) return 'Данных пока нет.';
    var A = analyze(), L = [];
    L.push('Сохранённые периоды: ' + P.map(function (p) { return p.label + ' (остаток на начало ' + (p.openLabel || '?') + ', на конец ' + (p.closeLabel || '?') + (p.source === 'import' ? ', без сумм' : '') + ')'; }).join('; '));
    if (App.settings.currency) L.push('Валюта продаж: ' + App.settings.currency);
    L.push('\nПОМЕСЯЧНО — месяц; А шт; ВС шт; приход шт; А сумма; ВС сумма; приход сумма (валюта накладных поставщика)');
    A.mkeys.forEach(function (m) { var x = A.months[m]; L.push(mFull(m) + '; ' + x.a + '; ' + x.vs + '; ' + x.p + '; ' + (x.money ? Math.round(x.aS) : '-') + '; ' + (x.money ? Math.round(x.vsS) : '-') + '; ' + (x.money ? Math.round(x.pS) : '-')); });
    var cur = A.cur;
    L.push('\nТОВАРЫ — последний период «' + cur.label + '». Колонки: название; остаток на начало; приход; продажи А; продажи ВС; выручка; остаток на ' + cur.closeLabel + '; продажи по месяцам ' + cur.months.map(mLabel).join('/') + ' (А+ВС)');
    A.items.forEach(function (i) {
      L.push(i.name + '; ' + nf(i.open) + '; ' + i.receipts + '; ' + i.a + '; ' + i.vs + '; ' + Math.round(i.rev) + '; ' + i.close + '; ' + cur.months.map(function (m) { return ((i.row.a || {})[m] || 0) + ((i.row.vs || {})[m] || 0); }).join('/'));
    });
    P.slice(0, -1).reverse().slice(0, 3).forEach(function (p) {
      L.push('\nТОВАРЫ — более ранний период «' + p.label + '»: название; продажи А+ВС; остаток на ' + (p.closeLabel || 'конец'));
      p.rows.forEach(function (r) { var s = sum(r.a) + sum(r.vs); if (s || r.close) L.push(r.name + '; ' + s + '; ' + r.close); });
    });
    L.push('\nПОДСКАЗКИ СИСТЕМЫ (запас ' + A.target + ' мес.):');
    A.hints.slice(0, 80).forEach(function (h) { L.push('- ' + h.h + ': ' + h.b); });
    return L.join('\n').slice(0, 140000);
  }
  function md(text) {
    var lines = esc(text).split('\n'), out = '', list = null, tbl = null;
    function flush() { if (list) { out += '</' + list + '>'; list = null; } if (tbl) { out += '<table>' + tbl + '</table>'; tbl = null; } }
    lines.forEach(function (l) {
      var t = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
      var mUl = t.match(/^\s*[-*•]\s+(.*)/), mOl = t.match(/^\s*\d+[.)]\s+(.*)/);
      if (/^\s*\|.*\|\s*$/.test(t)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(t)) return;
        if (list) { out += '</' + list + '>'; list = null; }
        tbl = (tbl || '') + '<tr>' + t.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return '<td>' + c.trim() + '</td>'; }).join('') + '</tr>';
        return;
      }
      if (tbl) { out += '<table>' + tbl + '</table>'; tbl = null; }
      if (mUl || mOl) { var tp = mUl ? 'ul' : 'ol'; if (list !== tp) { if (list) out += '</' + list + '>'; out += '<' + tp + '>'; list = tp; } out += '<li>' + (mUl || mOl)[1] + '</li>'; return; }
      if (list) { out += '</' + list + '>'; list = null; }
      var h = t.match(/^#{1,4}\s+(.*)/);
      if (h) out += '<p><b>' + h[1] + '</b></p>'; else if (t.trim()) out += '<p>' + t + '</p>';
    });
    flush();
    return out;
  }
  function renderAI() {
    var on = App.status && App.status.ai;
    var box = $('ai');
    box.innerHTML = '<div class="row spread"><div style="display:grid;gap:4px"><h1>Помощник</h1><p class="sub">' +
      (on ? 'Задайте вопрос о складе и продажах. Помощник видит все сохранённые сводные и подсказки дашборда. Модель: ' + esc(App.status.model) + '.'
          : 'Чат с ChatGPT не настроен: добавьте ключ OPENAI_API_KEY в настройках Netlify. Подсказки на дашборде работают и без него.') + '</p></div>' +
      (chat.length ? '<button type="button" class="ghost" id="chatClear">Очистить переписку</button>' : '') + '</div>' +
      '<div class="chat"><div class="msgs" id="msgs">' +
      (chat.length ? chat.map(function (m) { return m.role === 'user' ? '<div class="msg-u">' + esc(m.content) + '</div>' : '<div class="msg-a">' + md(m.content) + '</div>'; }).join('')
                   : '<div class="chips">' + SUGGEST.map(function (s, i) { return '<button type="button" data-sg="' + i + '">' + esc(s) + '</button>'; }).join('') + '</div>') +
      (sending ? '<div class="msg-a muted">Думаю…</div>' : '') + '</div>' +
      '<form class="chat-input" id="chatForm"><textarea id="chatIn" placeholder="' + (on ? 'Например: что заказать к следующему месяцу?' : 'Чат выключен') + '"' + (on ? '' : ' disabled') + '></textarea>' +
      '<button class="primary" type="submit"' + (on && !sending ? '' : ' disabled') + '>Отправить</button></form></div>';
    box.querySelectorAll('[data-sg]').forEach(function (b) { b.onclick = function () { askAI(SUGGEST[+b.dataset.sg]); }; });
    var cl = $('chatClear'); if (cl) cl.onclick = function () { chat = []; lsSet('ms.chat', chat); renderAI(); };
    $('chatForm').onsubmit = function (e) { e.preventDefault(); var v = $('chatIn').value.trim(); if (v) askAI(v); };
    $('chatIn').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); } };
    var last = box.querySelector('.msgs > :last-child'); if (last && chat.length) last.scrollIntoView({ block: 'end' });
  }
  function askAI(q) {
    if (location.hash !== '#ai') location.hash = '#ai';
    if (!(App.status && App.status.ai)) { renderAI(); toast('Чат не настроен: нужен ключ OpenAI'); return; }
    if (sending) return;
    chat.push({ role: 'user', content: q }); sending = true; lsSet('ms.chat', chat); renderAI();
    api('chat', { method: 'POST', body: { messages: chat.slice(-12), context: buildContext() } }).then(function (d) {
      chat.push({ role: 'assistant', content: d.reply });
    }, function (e) {
      if (e.message !== 'auth') chat.push({ role: 'assistant', content: 'Не получилось получить ответ: ' + e.message });
    }).then(function () { sending = false; lsSet('ms.chat', chat.slice(-40)); if (!$('v-ai').hidden) renderAI(); });
  }
  App.askAI = askAI;

  // ======================= страницы =======================
  var pageEdit = null, pageDel = null;
  function slug(s) {
    var T = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
    return String(s).toLowerCase().replace(/[а-яё]/g, function (c) { return T[c] || ''; }).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
  }
  function renderPages(openId) {
    var box = $('pages');
    if (openId) {
      var meta = App.pages.find(function (p) { return p.id === openId; });
      box.innerHTML = '<div class="row spread"><div class="row"><a href="#pages">← Все страницы</a><b>' + esc(meta ? meta.title : openId) + '</b></div><span class="small muted" id="pgState">Загружаю…</span></div><iframe class="frame" id="pgFrame" title="' + esc(meta ? meta.title : '') + '" sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-modals allow-popups"></iframe>';
      api('pages/' + encodeURIComponent(openId)).then(function (p) { $('pgFrame').srcdoc = p.html; $('pgState').textContent = ''; }, function (e) { $('pgState').textContent = e.message; });
      return;
    }
    box.innerHTML = '<div style="display:grid;gap:6px"><h1>Страницы</h1><p class="sub">Свои расчётные страницы в формате .html. Они хранятся на сайте и видны всем, у кого есть пароль.</p></div>' +
      '<div class="cards">' + App.pages.map(function (p) {
        if (pageEdit === p.id) return '<form class="pcard" data-form="' + esc(p.id) + '"><div class="field"><label for="pe_t">Название</label><input id="pe_t" value="' + esc(p.title) + '" maxlength="120" required></div>' +
          '<div class="field"><label for="pe_d">Описание</label><textarea id="pe_d" maxlength="400">' + esc(p.desc) + '</textarea></div><div class="row"><button class="primary" type="submit">Сохранить</button><button type="button" class="ghost" data-pa="cancel">Отмена</button></div></form>';
        return '<div class="pcard">' + (p.tag ? '<span class="badge">' + esc(p.tag) + '</span>' : '<span class="badge">страница</span>') +
          '<a class="t" href="#pages/' + esc(p.id) + '">' + esc(p.title) + '</a><span class="dd">' + esc(p.desc || '') + '</span>' +
          '<div class="menu"><button type="button" class="ghost" data-pa="edit" data-id="' + esc(p.id) + '">Изменить</button><button type="button" class="ghost" data-pa="replace" data-id="' + esc(p.id) + '">Заменить файл</button>' +
          '<button type="button" class="ghost danger" data-pa="del" data-id="' + esc(p.id) + '">' + (pageDel === p.id ? 'Точно удалить?' : 'Удалить') + '</button></div></div>';
      }).join('') +
      '<label class="pcard drop" id="pgDrop" for="pgFile" style="border-style:dashed;cursor:pointer"><span class="badge">новая</span><span class="t">Добавить .html-страницу</span><span class="dd">Перетащите файлы сюда или нажмите, чтобы выбрать.</span><span></span><input type="file" id="pgFile" accept=".html,.htm" multiple style="position:absolute;width:1px;height:1px;opacity:0"></label></div>' +
      '<input type="file" id="pgReplace" accept=".html,.htm" hidden>';
    var drop = $('pgDrop'), inp = $('pgFile');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { uploadPages(e.dataTransfer.files); });
    inp.onchange = function () { uploadPages(inp.files); inp.value = ''; };
    $('pgReplace').onchange = function () {
      var f = this.files[0], id = this.dataset.id; this.value = ''; if (!f) return;
      var meta = App.pages.find(function (p) { return p.id === id; });
      f.text().then(function (html) { return api('pages/' + id, { method: 'PUT', body: { title: meta.title, desc: meta.desc, tag: meta.tag, html: html } }); })
        .then(function (r) { Object.assign(meta, r.page); toast('Страница заменена'); renderPages(); }, function (e) { toast(e.message); });
    };
    box.querySelectorAll('[data-pa]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.id, a = b.dataset.pa;
        if (a !== 'del') pageDel = null;
        if (a === 'edit') { pageEdit = id; renderPages(); }
        if (a === 'cancel') { pageEdit = null; renderPages(); }
        if (a === 'replace') { $('pgReplace').dataset.id = id; $('pgReplace').click(); }
        if (a === 'del') {
          if (pageDel !== id) { pageDel = id; renderPages(); return; }
          pageDel = null;
          api('pages/' + id, { method: 'DELETE' }).then(function () { App.pages = App.pages.filter(function (p) { return p.id !== id; }); renderPages(); toast('Страница удалена'); }, function (e) { toast(e.message); });
        }
      };
    });
    var form = box.querySelector('[data-form]');
    if (form) form.onsubmit = function (e) {
      e.preventDefault();
      var id = form.dataset.form, meta = App.pages.find(function (p) { return p.id === id; });
      api('pages/' + id).then(function (p) { return api('pages/' + id, { method: 'PUT', body: { title: $('pe_t').value.trim(), desc: $('pe_d').value.trim(), tag: meta.tag, html: p.html } }); })
        .then(function (r) { Object.assign(meta, r.page); pageEdit = null; renderPages(); }, function (er) { toast(er.message); });
    };
  }
  function uploadPages(list) {
    var fs = Array.prototype.filter.call(list, function (f) { return /\.html?$/i.test(f.name); });
    if (!fs.length) { toast('Нужны файлы .html'); return; }
    Promise.all(fs.map(function (f) {
      return f.text().then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var title = (doc.querySelector('title') && doc.querySelector('title').textContent.trim()) || f.name.replace(/\.html?$/i, '');
        var dm = doc.querySelector('meta[name="description"]'), desc = dm ? dm.getAttribute('content') || '' : '';
        var id = slug(title), n = 2; while (App.pages.some(function (p) { return p.id === id; })) id = slug(title) + '-' + n++;
        return api('pages/' + id, { method: 'PUT', body: { title: title, desc: desc, html: html } }).then(function (r) { App.pages.push(r.page); });
      });
    })).then(function () { toast(fs.length === 1 ? 'Страница добавлена' : 'Добавлено: ' + fs.length); renderPages(); }, function (e) { toast(e.message); renderPages(); });
  }

  // ======================= настройки =======================
  var perDel = null, imported = null;
  function renderSettings() {
    var box = $('settings');
    box.innerHTML = '<h1>Настройки</h1>' +
      '<section class="panel"><h2>Сохранённые сводные</h2><p class="small muted">По ним строятся дашборд и ответы помощника. Сводные из вкладки «Сводный» сохраняются вместе с суммами продаж; импорт готового Excel даёт только количества.</p>' +
      (App.periods.length ? '<div class="scrollbox" style="max-height:none"><table class="dtable"><thead><tr><th>Период</th><th>Источник</th><th class="n">Позиций</th><th>Сохранён</th><th></th></tr></thead><tbody>' +
        App.periods.map(function (p) { return '<tr><td>' + esc(p.label) + '</td><td>' + (p.source === 'import' ? 'импорт Excel' : 'расчёт') + '</td><td class="n">' + p.rows.length + '</td><td>' + new Date(p.savedAt).toLocaleDateString('ru-RU') + '</td><td><button type="button" class="ghost danger" data-pd="' + esc(p.id) + '">' + (perDel === p.id ? 'Точно удалить?' : 'Удалить') + '</button></td></tr>'; }).join('') +
        '</tbody></table></div>' : '<p class="muted">Пока ничего не сохранено.</p>') +
      '<div class="field"><label for="impFile">Загрузить готовый сводный (.xlsx)</label><input type="file" id="impFile" accept=".xlsx,.xls"></div><div id="impBox"></div></section>' +
      '<section class="panel"><h2>Расчёты</h2><div class="field"><label for="setCur">Валюта продаж (как подписывать суммы)</label><input id="setCur" maxlength="6" placeholder="например ₸" value="' + esc(App.settings.currency || '') + '"></div>' +
      '<div class="field"><label for="setTarget">Запас для заказа, месяцев</label><input id="setTarget" type="number" min="0.5" max="12" step="0.5" value="' + esc(App.settings.targetMonths || 2) + '"></div></section>' +
      '<section class="panel"><h2>Доступ</h2><p class="small muted">Пароль сайта задаётся в Netlify (переменная SITE_PASSWORD). Чат: ' + (App.status && App.status.ai ? 'включён, модель ' + esc(App.status.model) : 'выключен — нет OPENAI_API_KEY') + '.</p><div class="row"><button type="button" id="logout2">Выйти на этом устройстве</button></div></section>';
    box.querySelectorAll('[data-pd]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.pd;
        if (perDel !== id) { perDel = id; renderSettings(); return; }
        perDel = null;
        api('periods/' + id, { method: 'DELETE' }).then(function () { App.periods = App.periods.filter(function (p) { return p.id !== id; }); renderSettings(); toast('Удалено'); }, function (e) { toast(e.message); });
      };
    });
    $('setCur').onchange = function () { App.saveSettings({ currency: this.value.trim() }); };
    $('setTarget').onchange = function () { var v = parseFloat(this.value); if (v > 0) App.saveSettings({ targetMonths: v }); };
    $('logout2').onclick = function () { $('logout').click(); };
    $('impFile').onchange = function () {
      var f = this.files[0]; if (!f) return;
      f.arrayBuffer().then(function (buf) {
        var ps = [];
        try { ps = Core.readPeriods(new Uint8Array(buf), f.name); } catch (e) { $('impBox').innerHTML = '<p class="err">Не удалось прочитать: ' + esc(e.message) + '</p>'; return; }
        if (!ps.length) { $('impBox').innerHTML = '<p class="err">Не нашёл в файле сводный: нужна таблица с «Номенклатура» и «Остатки на …».</p>'; return; }
        imported = ps;
        $('impBox').innerHTML = ps.map(function (p, i) {
          var ex = App.periods.some(function (x) { return x.id === p.id; });
          var tq = function (k) { return p.rows.reduce(function (a, r) { return a + sum(r[k]); }, 0); };
          return '<div class="row" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)"><span><b>' + esc(p.label) + '</b> · ' + p.rows.length + ' позиций · приход ' + nf(tq('p')) + ' · А ' + nf(tq('a')) + ' · ВС ' + nf(tq('vs')) + ' · остаток на ' + esc(p.closeLabel) + ' ' + nf(p.rows.reduce(function (a, r) { return a + r.close; }, 0)) + '</span>' +
            '<button type="button" class="primary" data-imp="' + i + '">' + (ex ? 'Заменить сохранённый' : 'Сохранить') + '</button></div>';
        }).join('');
        $('impBox').querySelectorAll('[data-imp]').forEach(function (b) {
          b.onclick = function () { b.disabled = true; App.savePeriod(imported[+b.dataset.imp]).then(function () { toast('Сохранено'); renderSettings(); }, function (e) { b.disabled = false; toast(e.message); }); };
        });
      });
    };
  }

  // ======================= запуск =======================
  fetch('/api/status').then(function (r) { return r.json(); }).then(function (st) {
    App.status = st;
    if (st.passwordSet && !App.key) { showLogin(''); return; }
    loadAll();
  }).catch(function () { showLogin('Сервер не отвечает. Проверьте, что сайт развёрнут вместе с функциями Netlify.'); });
})();
