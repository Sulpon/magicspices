/* Сводный по кварталу — интерфейс расчёта */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var files = [];          // {id, name, size, sheets:[parsed]}
  var model = null, filter = 'all', query = '';
  var overrides = {};
  function saveOv() { if (window.App) App.saveSettings({ overrides: overrides }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var F = Core.fmt;
  function monthY(k) { return Core.ymLabel(k) + ' ' + Core.ymYear(k); }

  // ---- загрузка ----
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
  $('fileInput').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  $('clearAll').addEventListener('click', function () { files = []; refresh(); });
  $('resetOv').addEventListener('click', function () { overrides = {}; saveOv(); refresh(); });

  function addFiles(list) {
    if (typeof XLSX === 'undefined' || typeof ExcelJS === 'undefined') { showMsg('Не загрузились библиотеки для чтения Excel. Обновите страницу.', 'err'); return; }
    var jobs = Array.prototype.map.call(list, function (f) {
      if (files.some(function (x) { return x.name === f.name && x.size === f.size; })) return Promise.resolve();
      return f.arrayBuffer().then(function (buf) {
        var sheets;
        try { sheets = Core.readWorkbook(new Uint8Array(buf), f.name); }
        catch (e) { sheets = [{ kind: 'error', file: f.name, warnings: ['Не удалось открыть файл: ' + e.message], items: [] }]; }
        if (!sheets.length) sheets = [{ kind: 'unknown', file: f.name, warnings: ['Не узнал формат: нет ни накладной, ни отчёта о реализации, ни сводного'], items: [] }];
        files.push({ id: Math.random().toString(36).slice(2), name: f.name, size: f.size, buf: buf, sheets: sheets });
      });
    });
    Promise.all(jobs).then(refresh);
  }

  function dashBase() {
    var P = window.App && App.periods;
    if (!P || !P.length) return null;
    if (files.some(function (f) { return f.sheets.some(function (s) { return s.kind === 'summary'; }); })) return null;
    var minYm = Infinity;
    files.forEach(function (f) { f.sheets.forEach(function (x) { if ((x.kind === 'prihod' || x.kind === 'report') && x.ym < minYm) minYm = x.ym; }); });
    var cand = P.filter(function (q) { return q.months[q.months.length - 1] < minYm; });
    if (!cand.length) return null;
    var p = cand[cand.length - 1], last = p.months[p.months.length - 1];
    return { name: 'Дашборд', size: 0, virtual: true, sheets: [{ kind: 'summary', file: 'сохранённый сводный в дашборде', sheet: '', title: 'Остатки из дашборда на ' + (p.closeLabel || ''),
      ym: last, dateLabel: p.closeLabel, items: p.rows.map(function (r) { return { name: r.name, unit: r.unit || 'шт', stock: r.close }; }), warnings: [], hash: 'dash-' + p.id }] };
  }
  function allFiles() { var b = files.length ? dashBase() : null; return b ? files.concat([b]) : files; }
  function allSources() { var a = []; allFiles().forEach(function (f) { f.sheets.forEach(function (s) { a.push(s); }); }); return a; }

  function refresh() {
    var src = allSources();
    $('intro').hidden = files.length > 0;
    $('filesPanel').hidden = !files.length;
    model = src.some(function (s) { return s.kind === 'summary' || s.kind === 'prihod' || s.kind === 'report'; }) ? Core.build(src, DEFAULT_DICT, overrides) : null;
    renderFiles();
    renderSummary();
    renderReview();
    renderTable();
  }

  var KIND = { summary: 'Сводный', prihod: 'Приход', report: 'Реализация', error: 'Ошибка', unknown: 'Не распознан' };
  function renderFiles() {
    var box = $('files'); box.innerHTML = '';
    allFiles().forEach(function (f) {
      f.sheets.forEach(function (s, i) {
        var el = document.createElement('div');
        el.className = 'file' + (s.skipped ? ' skip' : '');
        var tag = s.kind === 'report' ? (s.channel === 'A' ? 'Реализация А' : 'Реал ВС') : KIND[s.kind];
        var meta = [esc(f.virtual ? s.file : f.name) + (!f.virtual && (f.sheets.length > 1 || s.sheet) ? ' · лист «' + esc(s.sheet || '') + '»' : '')];
        if (s.org) meta.push(esc(s.org));
        if (s.items) meta.push(s.items.length + ' поз.');
        var html = '<span class="tag ' + s.kind + '">' + esc(tag) + '</span>' +
          '<div style="min-width:0"><div class="t">' + esc(s.title || f.name) + '</div><div class="meta">' + meta.join(' · ') + '</div>' +
          (s.skipped ? '<div class="meta">Пропущено: ' + esc(s.skipped) + '</div>' : '') +
          (s.warnings && s.warnings.length ? '<div class="warn">' + s.warnings.map(esc).join('<br>') + '</div>' : '') + '</div>' +
          '<div class="row">';
        if (s.kind === 'report') html += '<div class="seg"><button type="button" data-ch="A" aria-pressed="' + (s.channel === 'A') + '">А</button><button type="button" data-ch="VS" aria-pressed="' + (s.channel === 'VS') + '">ВС</button></div>';
        if ((s.kind === 'prihod' || s.kind === 'report') && !f.virtual) {
          if (s.ym0 == null) s.ym0 = s.ym;
          var mv = Math.floor(s.ym / 12) + '-' + ('0' + (s.ym % 12 + 1)).slice(-2);
          html += '<label class="small muted" style="display:grid;gap:2px">Записать за месяц<input type="month" data-ym="1" value="' + mv + '" style="font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)"></label>';
          if (s.ym !== s.ym0) html += '<span class="badge" title="Месяц в самом файле">в файле: ' + esc(monthY(s.ym0)) + '</span>';
        }
        if (i === 0 && !f.virtual) html += '<button class="ghost" type="button" data-rm="1" aria-label="Убрать файл">Убрать</button>';
        html += '</div>';
        el.innerHTML = html;
        el.querySelectorAll('[data-ch]').forEach(function (b) { b.addEventListener('click', function () { s.channel = b.dataset.ch; refresh(); }); });
        var mi = el.querySelector('[data-ym]');
        if (mi) mi.addEventListener('change', function () {
          var m = /^(\d{4})-(\d{2})$/.exec(mi.value); if (!m) return;
          s.ym = +m[1] * 12 + (+m[2] - 1); refresh();
        });
        var rm = el.querySelector('[data-rm]');
        if (rm) rm.addEventListener('click', function () { files = files.filter(function (x) { return x !== f; }); refresh(); });
        box.appendChild(el);
      });
    });
  }

  function renderSummary() {
    var p = $('sumPanel');
    if (!model || !model.months.length) {
      p.hidden = !model;
      if (model) { $('period').textContent = 'Нет данных за новые месяцы'; $('tiles').innerHTML = ''; $('dl').disabled = true; $('notes').textContent = 'Добавьте накладные или отчёты о реализации за месяцы после ' + (model.openLabel || 'прошлого сводного') + '.'; }
      return;
    }
    p.hidden = false; $('dl').disabled = false;
    var M = model.months, t = model.totals;
    $('period').textContent = (M.length > 1 ? Core.ymLabel(M[0]) + ' – ' : '') + monthY(M[M.length - 1]);
    function s(o) { return M.reduce(function (a, k) { return a + (o[k] || 0); }, 0); }
    function per(o) { return M.map(function (k) { return Core.ymLabel(k).slice(0, 3) + ' ' + F(o[k] || 0); }).join(' · '); }
    var neg = model.rows.filter(function (r) { return r.close < 0; }).length;
    var tiles = [
      ['Остаток на ' + (model.openLabel || 'начало'), F(t.open), model.base ? model.base.items.length + ' позиций' : 'прошлый сводный не загружен'],
      ['Приход', F(s(t.prihod)), per(t.prihod)],
      ['Реал ВС', F(s(t.vs)), per(t.vs)],
      ['Реализация А', F(s(t.a)), per(t.a)],
      ['Остаток на ' + model.closeLabel, F(t.close), model.rows.length + ' позиций'],
      ['Минус на конец', String(neg), neg ? 'продано больше, чем было' : 'нет', neg ? 'bad' : '']
    ];
    $('tiles').innerHTML = tiles.map(function (x) { return '<div class="tile ' + (x[3] || '') + '"><span class="l">' + esc(x[0]) + '</span><span class="v">' + esc(x[1]) + '</span><span class="d">' + esc(x[2]) + '</span></div>'; }).join('');
    var notes = model.notes.slice();
    if (!model.base) notes.push('Прошлый сводный не загружен, остаток на начало считается нулевым.');
    $('notes').innerHTML = notes.map(esc).join('<br>');
  }

  var CH = { prihod: 'приход', A: 'А', VS: 'ВС' };
  function renderReview() {
    var p = $('revPanel');
    if (!model || !model.review.length) { p.hidden = true; return; }
    p.hidden = false;
    var dl = $('names');
    dl.innerHTML = model.rows.map(function (r) { return '<option value="' + esc(r.name) + '">'; }).join('');
    var items = model.review.slice().sort(function (a, b) { return (a.match.confirmed ? 1 : 0) - (b.match.confirmed ? 1 : 0); });
    var open = items.filter(function (r) { return !r.match.confirmed; }).length;
    $('revTitle').textContent = open ? 'Проверьте названия · ' + open + ' из ' + items.length : 'Названия проверены';
    var box = $('rev'); box.innerHTML = '';
    items.forEach(function (it) {
      var m = it.match, isNew = m.row.isNew, conf = !!m.confirmed;
      var chip = conf ? '<span class="chip ok">подтверждено</span>' : isNew ? '<span class="chip new">новая позиция</span>' : '<span class="chip check">' + (m.how === 'manual' ? 'выбрано вручную' : 'похоже') + '</span>';
      var uses = {};
      it.uses.forEach(function (u) { var k = CH[u.ch] + ' · ' + Core.ymLabel(u.ym); uses[k] = (uses[k] || 0) + u.qty; });
      var el = document.createElement('div');
      el.className = 'ri' + (conf ? ' done' : '');
      var hint = isNew && m.suggestion ? 'Ближайшее в сводном: «' + esc(m.suggestion) + '»' : (!isNew ? 'В строке сводного: «' + esc(m.row.name) + '»' : '');
      el.innerHTML = '<div class="src"><div class="row">' + chip + '</div><div class="n">' + esc(it.name) + '</div><div class="row">' +
        Object.keys(uses).map(function (k) { return '<span class="chip use">' + esc(k) + ' · ' + F(uses[k]) + '</span>'; }).join('') + '</div></div>' +
        '<div class="dst"><label class="small muted" for="d_' + it.key + '">Куда отнести</label>' +
        '<input type="text" id="d_' + it.key + '" list="names" value="' + esc(isNew ? '' : m.row.name) + '" placeholder="новая позиция">' +
        (hint ? '<div class="hint">' + hint + '</div>' : '') +
        '<div class="row"><button type="button" data-a="ok">' + (conf ? 'Снять отметку' : 'Верно') + '</button>' +
        '<button type="button" data-a="new">Сделать новой</button>' +
        (isNew && m.suggestion ? '<button type="button" data-a="sug">Взять ближайшее</button>' : '') + '</div></div>';
      var inp = el.querySelector('input');
      inp.addEventListener('change', function () {
        var v = inp.value.trim();
        overrides[it.key] = { target: v || null, confirmed: false }; saveOv(); refresh();
      });
      el.querySelector('[data-a="ok"]').addEventListener('click', function () {
        var cur = inp.value.trim();
        overrides[it.key] = { target: cur ? cur : null, confirmed: !conf }; saveOv(); refresh();
      });
      el.querySelector('[data-a="new"]').addEventListener('click', function () { overrides[it.key] = { target: null, confirmed: false }; saveOv(); refresh(); });
      var sg = el.querySelector('[data-a="sug"]');
      if (sg) sg.addEventListener('click', function () { overrides[it.key] = { target: m.suggestion, confirmed: false }; saveOv(); refresh(); });
      box.appendChild(el);
    });
  }

  $('q').addEventListener('input', function (e) { query = Core.key(e.target.value); renderTable(); });
  $('flt').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.f;
      $('flt').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      renderTable();
    });
  });

  function renderTable() {
    var p = $('tablePanel');
    if (!model || !model.months.length) { p.hidden = true; return; }
    p.hidden = false;
    var M = model.months;
    var h1 = '<tr><th rowspan="2">№</th><th rowspan="2">Номенклатура</th><th rowspan="2">Ед.</th><th rowspan="2">остаток на ' + esc(model.openLabel || 'начало') + '</th>' +
      '<th colspan="' + M.length + '">ПРИХОД</th><th colspan="' + 2 * M.length + '">РЕАЛИЗАЦИЯ</th><th rowspan="2">Остатки на ' + esc(model.closeLabel) + '</th></tr>';
    var h2 = '<tr>' + M.map(function (k) { return '<th>' + Core.ymLabel(k) + '</th>'; }).join('') +
      M.map(function (k) { return '<th>ВС ' + Core.ymLabel(k) + '</th><th>А ' + Core.ymLabel(k) + '</th>'; }).join('') + '</tr>';
    function sum(a) { return a ? a.reduce(function (x, y) { return x + y; }, 0) : null; }
    function cell(arr, cls) { var v = sum(arr); return '<td class="n ' + (cls || '') + '"' + (arr && arr.length > 1 ? ' title="' + arr.join(' + ') + '"' : '') + '>' + (v == null ? '' : F(v)) + '</td>'; }
    var body = model.rows.filter(function (r) {
      if (query && Core.key(r.name).indexOf(query) < 0) return false;
      if (filter === 'neg') return r.close < 0;
      if (filter === 'hl') return r.isNew || r.flagName || Object.keys(r.flags).length;
      return true;
    }).map(function (r) {
      var tds = '<td class="n">' + r.n + '</td><td class="name' + (!r.isNew && r.flagName ? ' hl-check' : '') + '">' + esc(r.name) + '</td><td>' + esc(r.unit) + '</td><td class="n">' + F(r.open) + '</td>';
      M.forEach(function (k) { tds += cell(r.prihod[k], r.flags['prihod' + k] ? 'hl-check' : ''); });
      M.forEach(function (k) { tds += cell(r.vs[k], r.flags['vs' + k] ? 'hl-vs' : '') + cell(r.a[k], r.flags['a' + k] ? 'hl-check' : ''); });
      tds += '<td class="n' + (r.close < 0 ? ' neg' : '') + '">' + F(r.close) + '</td>';
      return '<tr' + (r.isNew ? ' class="isnew"' : '') + '>' + tds + '</tr>';
    }).join('');
    var t = model.totals;
    var tot = '<tr class="total"><td></td><td>ИТОГО</td><td></td><td class="n">' + F(t.open) + '</td>' +
      M.map(function (k) { return '<td class="n">' + F(t.prihod[k]) + '</td>'; }).join('') +
      M.map(function (k) { return '<td class="n">' + F(t.vs[k]) + '</td><td class="n">' + F(t.a[k]) + '</td>'; }).join('') +
      '<td class="n">' + F(t.close) + '</td></tr>';
    $('tbl').innerHTML = '<thead>' + h1 + h2 + '</thead><tbody>' + (body || '<tr><td colspan="' + (5 + 3 * M.length) + '" class="muted">Ничего не найдено</td></tr>') + tot + '</tbody>';
  }

  // ---- скачивание ----
  function fileName() {
    var M = model.months, y = Core.ymYear(M[0]);
    var q0 = Math.floor((M[0] % 12) / 3), q1 = Math.floor((M[M.length - 1] % 12) / 3);
    if (q0 === q1 && Core.ymYear(M[M.length - 1]) === y) return 'Сводный_' + (q0 + 1) + 'кв_' + y + '.xlsx';
    return 'Сводный_' + Core.ymLabel(M[0]) + '-' + Core.ymLabel(M[M.length - 1]) + '_' + Core.ymYear(M[M.length - 1]) + '.xlsx';
  }
  function showMsg(text, kind) { var m = $('dlMsg'); m.hidden = false; m.className = 'msg ' + (kind || ''); m.textContent = text; }
  // Внутри claude.ai файл сохраняется через окно подтверждения Claude.
  // Если страница открыта отдельно (своя вкладка или скачанный .html) — обычное скачивание браузером.
  var dlCap = null, dlReady = (window.claude && typeof window.claude.use === 'function')
    ? window.claude.use('downloads').then(function (d) { dlCap = d; return d; }, function () { return null; })
    : Promise.resolve(null);
  function asciiName(n) {
    var T = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
    return String(n).replace(/[а-яё]/gi, function (c) { var l = c.toLowerCase(), t = T[l] || ''; return c === l ? t : t.charAt(0).toUpperCase() + t.slice(1); }).replace(/[^\w.\-]+/g, '_');
  }
  function browserDownload(buf, name) {
    var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, name); return; }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = asciiName(name); a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }
  $('dl').addEventListener('click', function () {
    if (!model) return;
    var btn = $('dl'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Собираю файл…';
    var name = fileName();
    Promise.all([Core.toExcel(model), Promise.race([dlReady, new Promise(function (r) { setTimeout(function () { r(dlCap); }, 1500); })])])
      .then(function (res) {
        var buf = res[0], dl = res[1];
        if (!dl) { browserDownload(buf, name); showMsg('Файл ' + name + ' скачан. Если загрузка не началась, откройте страницу в отдельной вкладке браузера.', 'ok'); return; }
        return dl.save({ filename: name, data: new Blob([buf]) }).then(function () { showMsg('Готово: ' + name, 'ok'); }, function (e) {
          var code = e && e.code;
          if (code === 'declined') showMsg('Сохранение отменено. Нажмите «Скачать» ещё раз.');
          else if (code === 'rate_limited') showMsg('Окно сохранения уже открыто. Подтвердите его или попробуйте через пару секунд.');
          else { browserDownload(buf, name); showMsg('Встроенное сохранение недоступно (' + (code || 'ошибка') + '), пробую обычное скачивание. Если файл не появился, откройте страницу в отдельной вкладке.', 'err'); }
        });
      })
      .catch(function (e) { showMsg('Ошибка при сборке Excel: ' + (e && e.message ? e.message : e), 'err'); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });

  var saveArmed = false;
  $('saveDash').addEventListener('click', function () {
    if (!model || !model.months.length || !window.App) return;
    var p = Core.toPeriod(model), btn = $('saveDash');
    var exists = App.periods.some(function (x) { return x.id === p.id; });
    if (exists && !saveArmed) { saveArmed = true; btn.textContent = 'Заменить «' + p.label + '»?'; return; }
    saveArmed = false; btn.disabled = true; btn.textContent = 'Сохраняю…';
    var fname = fileName(), real = files.slice();
    App.savePeriod(p).then(function () {
      btn.textContent = 'Сохраняю файлы…';
      var jobs = real.map(function (f) { return App.uploadFile(p.id, 'source', f.name, f.buf); });
      jobs.push(Core.toExcel(model).then(function (b) { return App.uploadFile(p.id, 'svodny', fname, b); }));
      return Promise.all(jobs.map(function (j) { return j.then(function () { return null; }, function (e) { return e.message; }); })).then(function (errs) {
        errs = errs.filter(Boolean);
        showMsg('Сохранено в дашборд: ' + p.label + '. Файлов в архиве: ' + (jobs.length - errs.length) + (errs.length ? '. Не сохранились: ' + errs.join('; ') : '') + '. Скачать их можно на вкладке «Дашборд».', errs.length ? 'err' : 'ok');
      });
    }, function (e) { showMsg('Не сохранилось: ' + e.message, 'err'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Сохранить в дашборд'; });
  });
  window.Calc = { reload: function () { overrides = (window.App && App.settings.overrides) || {}; refresh(); } };
  refresh();
})();
