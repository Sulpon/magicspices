// ===== Ядро: разбор файлов, сопоставление названий, сборка сводного =====
var Core = (function () {
  var MONTHS_NOM = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  var MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  var MONTHS_PREP = ['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];

  function monthIndex(word) {
    var w = String(word || '').toLowerCase().replace('ё', 'е');
    for (var i = 0; i < 12; i++) {
      if (w === MONTHS_NOM[i] || w === MONTHS_GEN[i] || w === MONTHS_PREP[i]) return i;
    }
    for (i = 0; i < 12; i++) if (w.indexOf(MONTHS_NOM[i].slice(0, 3)) === 0) return i;
    return -1;
  }
  function ym(y, m) { return y * 12 + m; }            // ключ месяца
  function ymLabel(k) { return MONTHS_NOM[k % 12]; }
  function ymYear(k) { return Math.floor(k / 12); }
  function lastDay(k) { var y = ymYear(k), m = k % 12; return new Date(y, m + 1, 0).getDate(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateLabel(k) { return pad(lastDay(k)) + '.' + pad(k % 12 + 1) + '.' + String(ymYear(k)).slice(2); }

  // ---------- нормализация названий ----------
  function norm(x) {
    var s = String(x == null ? '' : x).toLowerCase().replace(/ё/g, 'е');
    s = s.replace(/[«»"'“”„()]/g, ' ');
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*гр?(?![а-я])/g, '$1г');
    s = s.replace(/\s*[*\/хx]\s*(?=\d)/g, '/');
    s = s.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
    return s;
  }
  function key(x) { return norm(x).replace(/[^a-zа-я0-9]/g, ''); }
  function grams(x) { var m = norm(x).match(/(\d+(?:[.,]\d+)?)г/); return m ? m[1].replace(',', '.') : null; }
  function tokens(x) { return norm(x).split(/[^a-zа-я0-9]+/).filter(function (t) { return t.length > 1 || /\d/.test(t); }); }
  function bigrams(s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var b = s.substr(i, 2); o[b] = (o[b] || 0) + 1; } return o; }
  function dice(a, b) {
    var A = bigrams(a), B = bigrams(b), inter = 0, na = 0, nb = 0, k;
    for (k in A) { na += A[k]; if (B[k]) inter += Math.min(A[k], B[k]); }
    for (k in B) nb += B[k];
    return na + nb ? 2 * inter / (na + nb) : 0;
  }
  var STOP = {'приправа':1,'смесь':1,'для':1,'приг':1,'приготовления':1,'блюда':1,'блюдо':1,'любимое':1,'дой':1,'паках':1,'пакетом':1,
    'морской':1,'солью':1,'универсальная':1,'сушеный':1,'сушеная':1,'сушеные':1,'быст':1,'минутка':1,'шт':1,'аромат':1,'целый':1,'целая':1};
  function content(x) {
    return norm(x).split(/[^a-zа-я]+/).filter(function (t) { return t.length > 2 && !STOP[t]; }).map(function (t) { return t.slice(0, 5); });
  }
  function covered(a, b) {     // все значимые слова a есть в b
    var B = {}; content(b).forEach(function (t) { B[t] = 1; });
    var A = content(a); return A.length > 0 && A.every(function (t) { return B[t]; });
  }
  function compatible(a, b) { return covered(a, b) || covered(b, a); }
  function similarity(a, b) {
    var ta = tokens(a), tb = tokens(b), sb = {}, common = 0;
    tb.forEach(function (t) { sb[t] = 1; });
    ta.forEach(function (t) { if (sb[t]) common++; });
    var tokenScore = ta.length && tb.length ? common / Math.min(ta.length, tb.length) : 0;
    var s = 0.45 * tokenScore + 0.55 * dice(key(a), key(b));
    var ga = grams(a), gb = grams(b);
    if (ga && gb) s += ga === gb ? 0.06 : -0.18;
    return s;
  }

  // ---------- чтение ячеек ----------
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var s = String(v).replace(/[\s ]/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return parseFloat(s);
  }
  function cellAt(ws, r, c) { return ws[XLSX.utils.encode_cell({ r: r, c: c })]; }
  function evalCell(ws, addr, depth) {
    var cell = ws[addr];
    if (!cell) return 0;
    if (cell.f && depth < 6) { var fv = evalFormula(ws, cell.f, depth + 1); if (fv != null) return fv; }
    if (typeof cell.v === 'number') return cell.v;
    var n = num(cell.v); return n == null ? 0 : n;
  }
  function evalFormula(ws, f, depth) {          // только +, - , числа и ссылки
    var s = String(f).replace(/^=/, '').replace(/\$/g, '').replace(/\s/g, '');
    var re = /([+-]?)([A-Z]{1,3}\d+|\d+(?:\.\d+)?)/g, m, total = 0, used = 0;
    while ((m = re.exec(s))) {
      used += m[0].length;
      var val = /^[A-Z]/.test(m[2]) ? evalCell(ws, m[2], depth || 0) : parseFloat(m[2]);
      total += m[1] === '-' ? -val : val;
    }
    return used === s.length ? total : null;
  }
  function rowsOf(ws) {
    if (!ws['!ref']) return { rows: [], range: null };
    var range = XLSX.utils.decode_range(ws['!ref']);
    var rows = [];
    for (var r = range.s.r; r <= range.e.r; r++) {
      var row = [];
      for (var c = 0; c <= range.e.c; c++) { var cell = cellAt(ws, r, c); row[c] = cell ? cell.v : null; }
      rows.push(row);
    }
    return { rows: rows, range: range };
  }
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function hashRows(list) { var s = JSON.stringify(list), h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // ---------- определение типа листа ----------
  function parseSheet(ws, sheetName, fileName, hidden) {
    var R = rowsOf(ws), rows = R.rows;
    if (!rows.length) return null;
    if (txt(rows[0][0]) === 'Месяц') return null;          // расшифровки из нашей же выгрузки
    var top = [];
    for (var r = 0; r < Math.min(rows.length, 15); r++) top.push(rows[r].map(txt).join(' | '));
    var head = top.join('\n');

    // Приходная накладная
    var mInv = head.match(/Приходная\s+накладная\s*№\s*(\S+)\s+от\s+(\d{1,2})\s+([А-Яа-яЁё]+)\s+(\d{4})/i) ||
               head.match(/Приходная\s+накладная\s*№\s*(\S+)\s+от\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
    if (mInv) return parseInvoice(rows, mInv, sheetName, fileName);

    // Отчет о реализации
    var mRep = head.match(/Отч[её]т\s+о\s+реализации[^\n]*?за\s+([А-Яа-яЁё]+)\s+(\d{4})/i);
    if (mRep) return parseReport(rows, mRep, sheetName, fileName, hidden);

    // Сводный (предыдущий квартал)
    for (r = 0; r < Math.min(rows.length, 6); r++) {
      var low = rows[r].map(function (v) { return txt(v).toLowerCase(); });
      var nameCol = low.findIndex(function (v) { return v === 'номенклатура'; });
      if (nameCol >= 0 && low.some(function (v) { return /остат/.test(v); })) return parseSummary(ws, rows, r, nameCol, sheetName, fileName);
    }
    return null;
  }

  function parseInvoice(rows, m, sheetName, fileName) {
    var mon = /^\d+$/.test(m[3]) ? parseInt(m[3], 10) - 1 : monthIndex(m[3]);
    var res = { kind: 'prihod', number: m[1], date: pad(+m[2]) + '.' + pad(mon + 1) + '.' + m[4], ym: ym(+m[4], mon),
      title: 'Приходная накладная № ' + m[1] + ' от ' + pad(+m[2]) + '.' + pad(mon + 1) + '.' + m[4], sheet: sheetName, file: fileName, items: [], warnings: [] };
    var hr = -1, cName = -1, cQty = -1, cCode = -1, cPrice = -1, cSumI = -1;
    for (var r = 0; r < rows.length; r++) {
      var low = rows[r].map(function (v) { return txt(v).toLowerCase(); });
      var a = low.findIndex(function (v) { return v === 'товар' || v === 'наименование' || v === 'номенклатура'; });
      var b = low.findIndex(function (v) { return /^кол/.test(v); });
      if (a >= 0 && b >= 0) { hr = r; cName = a; cQty = b; cCode = low.indexOf('код'); cPrice = low.findIndex(function (v) { return /^цена/.test(v); }); cSumI = low.findIndex(function (v) { return /^сумма/.test(v); }); break; }
    }
    if (hr < 0) { res.warnings.push('Не нашёл строку заголовков «Товар / Количество»'); return res; }
    for (r = hr + 1; r < rows.length; r++) {
      var row = rows[r], name = txt(row[cName]);
      if (/^итого/i.test(row.map(txt).join(' ').trim()) || row.some(function (v) { return /^итого/i.test(txt(v)); })) break;
      var q = num(row[cQty]);
      if (!name || q == null) continue;
      var unit = 'шт';
      for (var c = cQty + 1; c < (cPrice > cQty ? cPrice : cQty + 6); c++) if (typeof row[c] === 'string' && txt(row[c])) { unit = txt(row[c]); break; }
      res.items.push({ name: name, qty: q, code: cCode >= 0 ? txt(row[cCode]) : '', unit: unit, sum: cSumI >= 0 ? num(row[cSumI]) : null });
    }
    res.hash = hashRows(res.items);
    return res;
  }

  function parseReport(rows, m, sheetName, fileName, hidden) {
    var mon = monthIndex(m[1]);
    var org = txt(rows[0] && rows[0].find(function (v) { return txt(v); }));
    var res = { kind: 'report', ym: ym(+m[2], mon), org: org, sheet: sheetName, file: fileName, hidden: !!hidden, items: [], warnings: [],
      channel: /cosmo/i.test(org) ? 'A' : 'VS', title: 'Отчёт о реализации за ' + MONTHS_NOM[mon] + ' ' + m[2] };
    var cQty = -1, cSum = -1, hr = -1;
    for (var r = 0; r < Math.min(rows.length, 15); r++) {
      var low = rows[r].map(function (v) { return txt(v).toLowerCase(); });
      var q = low.findIndex(function (v) { return /^количество/.test(v); });
      if (q >= 0) { cQty = q; cSum = low.findIndex(function (v) { return /^сумма/.test(v); }); hr = r; }
      if (low[0] === 'номенклатура') hr = Math.max(hr, r);
    }
    if (cQty < 0) { res.warnings.push('Не нашёл столбец «Количество»'); return res; }
    var orgTotal = null;
    for (r = hr + 1; r < rows.length; r++) {
      var row = rows[r], name = txt(row[0]), qn = num(row[cQty]), sm = cSum >= 0 ? num(row[cSum]) : null;
      if (!name) { if (qn != null && orgTotal == null) orgTotal = qn; continue; }
      if (/^(ТОО|ООО|ИП|АО)\s/i.test(name)) { if (qn != null && orgTotal == null) orgTotal = qn; continue; }
      if (/^итого/i.test(name)) continue;
      if (qn == null) { res.warnings.push('Нет количества: ' + name + ' (посчитано как 0)'); continue; }
      res.items.push({ name: name, qty: qn, sum: sm });
    }
    var s = res.items.reduce(function (a, b) { return a + b.qty; }, 0);
    res.total = orgTotal;
    if (orgTotal != null && Math.abs(orgTotal - s) > 0.001) res.warnings.push('Итог в отчёте ' + fmt(orgTotal) + ', сумма строк ' + fmt(s));
    res.hash = hashRows([res.ym, res.items]);
    return res;
  }

  function parseSummary(ws, rows, hr, nameCol, sheetName, fileName) {
    var low = rows[hr].map(function (v) { return txt(v).toLowerCase(); });
    var openCol = low.findIndex(function (v) { return /остат/.test(v); });
    var closeCol = -1;
    for (var c = low.length - 1; c > openCol; c--) if (/остат/.test(low[c])) { closeCol = c; break; }
    var res = { kind: 'summary', sheet: sheetName, file: fileName, items: [], warnings: [] };
    var hdr = closeCol >= 0 ? low[closeCol] : low[openCol];
    var dm = hdr.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (dm) { var y = +dm[3]; if (y < 100) y += 2000; res.ym = ym(y, +dm[2] - 1); res.dateLabel = pad(+dm[1]) + '.' + pad(+dm[2]) + '.' + String(y).slice(2); }
    else res.warnings.push('Не нашёл дату в заголовке «' + hdr + '»');
    var useCol = closeCol >= 0 ? closeCol : openCol;
    var unitCol = low.findIndex(function (v) { return /^ед/.test(v); });
    var start = hr + 1;
    if (rows[start] && !txt(rows[start][nameCol])) start++;      // вторая строка шапки
    for (var r = start; r < rows.length; r++) {
      var name = txt(rows[r][nameCol]);
      if (!name || /^итого/i.test(name)) continue;
      var addr = XLSX.utils.encode_cell({ r: r, c: useCol }), cell = ws[addr], v = null;
      if (cell && cell.f) v = evalFormula(ws, cell.f, 0);
      if (v == null && cell) v = typeof cell.v === 'number' ? cell.v : num(cell.v);
      res.items.push({ name: name, unit: unitCol >= 0 ? txt(rows[r][unitCol]) || 'шт' : 'шт', stock: v == null ? 0 : v });
    }
    res.hash = hashRows(res.items);
    res.title = 'Сводный, остатки на ' + (res.dateLabel || '?');
    return res;
  }

  function readWorkbook(data, fileName) {
    var wb = XLSX.read(data, { type: 'array', cellFormula: true, sheetStubs: true, cellNF: false, cellDates: false });
    var out = [];
    wb.SheetNames.forEach(function (n, i) {
      var hidden = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[i] && wb.Workbook.Sheets[i].Hidden;
      try {
        var p = parseSheet(wb.Sheets[n], n, fileName, hidden);
        if (p) out.push(p);
      } catch (e) { out.push({ kind: 'error', file: fileName, sheet: n, warnings: ['Ошибка чтения: ' + e.message], items: [] }); }
    });
    return out;
  }

  function fmt(n) { if (n == null) return ''; var r = Math.round(n * 1000) / 1000; return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ','); }

  // ---------- сборка модели ----------
  // sources: результаты readWorkbook; dict: {исходное название: название в сводной}; overrides: {key(исх): {target: name|null(новая), confirmed}}
  function build(sources, dict, overrides) {
    overrides = overrides || {};
    var notes = [];
    var summaries = sources.filter(function (s) { return s.kind === 'summary' && s.items.length; });
    var base = null;
    if (summaries.length) {
      base = summaries.slice().sort(function (a, b) { return (b.ym || 0) - (a.ym || 0); })[0];
      if (summaries.length > 1) notes.push('Загружено несколько сводных — беру самый поздний: ' + base.title + '.');
    }
    var startYm = base && base.ym != null ? base.ym : null;
    var seen = {};
    var data = sources.filter(function (s) {
      if (s.kind !== 'prihod' && s.kind !== 'report') return false;
      if (startYm != null && s.ym <= startYm) { s.skipped = 'месяц не позже ' + base.dateLabel; return false; }
      var h = s.kind + '|' + (s.channel || '') + '|' + s.hash;
      if (seen[h]) { s.skipped = 'дубликат ' + seen[h]; return false; }
      seen[h] = (s.file + (s.sheet ? ' / ' + s.sheet : ''));
      s.skipped = null;
      return true;
    });
    var monthsSet = {};
    data.forEach(function (s) { monthsSet[s.ym] = 1; });
    var months = Object.keys(monthsSet).map(Number).sort(function (a, b) { return a - b; });
    if (startYm != null && months.length) {
      for (var k = startYm + 1; k < months[months.length - 1]; k++) if (!monthsSet[k]) months.push(k);
      months.sort(function (a, b) { return a - b; });
    }

    // строки сводной
    var rows = [], byKey = {};
    function addRow(name, unit, stock, isNew) {
      var row = { n: rows.length + 1, name: name, unit: unit || 'шт', open: stock || 0, isNew: !!isNew, prihod: {}, vs: {}, a: {}, prihodSum: {}, vsSum: {}, aSum: {}, flags: {} };
      rows.push(row); byKey[key(name)] = row; return row;
    }
    if (base) base.items.forEach(function (it) { if (!byKey[key(it.name)]) addRow(it.name, it.unit, it.stock, false); });

    var dictKey = {};
    Object.keys(dict || {}).forEach(function (src) { dictKey[key(src)] = dict[src]; });
    var summaryNames = rows.map(function (r) { return r.name; });

    var matchCache = {}, newNames = [];
    function resolve(srcName, unit) {
      var k = key(srcName);
      if (matchCache[k]) return matchCache[k];
      var m;
      var ov = overrides[k];
      if (ov) {
        if (ov.target === null) m = { how: 'new', confirmed: !!ov.confirmed };
        else if (byKey[key(ov.target)]) m = { how: 'manual', row: byKey[key(ov.target)], confirmed: !!ov.confirmed };
        else { var cr = addRow(String(ov.target).trim(), unit, 0, true); newNames.push(cr.name); m = { how: 'manual', row: cr, confirmed: !!ov.confirmed }; }
        if (m.how === 'manual' && key(m.row.name) === k) m.how = m.row.isNew ? 'new' : 'exact';
      }
      if (!m && byKey[k] && !byKey[k].isNew) m = { how: 'exact', row: byKey[k] };
      if (!m && dictKey[k] && byKey[key(dictKey[k])]) m = { how: 'dict', row: byKey[key(dictKey[k])] };
      if (!m) {
        var best = null, bestS = 0, second = 0;
        var bestAny = null, bestAnyS = 0;
        summaryNames.forEach(function (nm) {
          var s = similarity(srcName, nm);
          if (s > bestAnyS) { bestAnyS = s; bestAny = nm; }
          if (!compatible(srcName, nm)) return;
          var g1 = grams(srcName), g2 = grams(nm); if (g1 && g2 && g1 !== g2) return;
          if (s > bestS) { second = bestS; bestS = s; best = nm; } else if (s > second) second = s;
        });
        if (best && bestS >= 0.5) m = { how: 'fuzzy', row: byKey[key(best)], score: bestS };
        else m = { how: 'new', suggestion: best || bestAny, score: best ? bestS : bestAnyS };
      }
      if (m.how === 'new') {
        var nr = byKey[k];
        if (!nr) newNames.forEach(function (nm) {
          if (!nr && compatible(srcName, nm) && grams(srcName) === grams(nm) && similarity(srcName, nm) >= 0.6) nr = byKey[key(nm)];
        });
        if (!nr) { nr = addRow(String(srcName).replace(/\s+/g, ' ').trim(), unit, 0, true); newNames.push(nr.name); }
        m.row = nr;
      }
      m.key = k;
      matchCache[k] = m;
      return m;
    }

    var lines = { prihod: [], A: [], VS: [] };
    data.slice().sort(function (a, b) { var o = { prihod: 0, report: 1 }; return a.ym - b.ym || o[a.kind] - o[b.kind]; }).forEach(function (s) {
      s.items.forEach(function (it) {
        var m = resolve(it.name, it.unit);
        var row = m.row;
        var bucket = s.kind === 'prihod' ? 'prihod' : (s.channel === 'A' ? 'a' : 'vs');
        (row[bucket][s.ym] = row[bucket][s.ym] || []).push(it.qty);
        if (it.sum != null) row[bucket + 'Sum'][s.ym] = (row[bucket + 'Sum'][s.ym] || 0) + it.sum;
        var flagged = (m.how === 'fuzzy' || m.how === 'manual') && !m.confirmed;
        if (flagged) row.flags[bucket + s.ym] = true;
        if (flagged || m.how === 'fuzzy') row.flagName = true;
        var ln = { ym: s.ym, src: s, name: it.name, qty: it.qty, sum: it.sum, code: it.code, unit: it.unit, match: m, row: row };
        lines[s.kind === 'prihod' ? 'prihod' : s.channel].push(ln);
      });
    });

    function sum(arr) { return (arr || []).reduce(function (a, b) { return a + b; }, 0); }
    rows.forEach(function (r) {
      var t = r.open;
      months.forEach(function (k) { t += sum(r.prihod[k]) - sum(r.vs[k]) - sum(r.a[k]); });
      r.close = Math.round(t * 1000) / 1000;
    });
    var totals = { open: sum(rows.map(function (r) { return r.open; })), close: sum(rows.map(function (r) { return r.close; })), prihod: {}, vs: {}, a: {} };
    months.forEach(function (k) {
      ['prihod', 'vs', 'a'].forEach(function (b) { totals[b][k] = sum(rows.map(function (r) { return sum(r[b][k]); })); });
    });

    // список для проверки: всё, что не точное и не из словаря
    var review = [], rk = {};
    ['prihod', 'A', 'VS'].forEach(function (ch) {
      lines[ch].forEach(function (ln) {
        var m = ln.match;
        if (m.how === 'exact' || m.how === 'dict') return;
        var id = m.key;
        if (!rk[id]) { rk[id] = { key: id, name: ln.name, match: m, uses: [] }; review.push(rk[id]); }
        rk[id].uses.push({ ch: ch, ym: ln.ym, qty: ln.qty });
      });
    });

    var closeYm = months.length ? months[months.length - 1] : null;
    return {
      base: base, months: months, rows: rows, lines: lines, totals: totals, review: review, notes: notes,
      openLabel: base && base.dateLabel ? base.dateLabel : null,
      closeLabel: closeYm != null ? dateLabel(closeYm) : null,
      sources: sources, summaryNames: rows.filter(function (r) { return !r.isNew; }).map(function (r) { return r.name; })
    };
  }

  // ---------- выгрузка в Excel ----------
  var C = { yellow: 'FFFFFF00', orange: 'FFF4B084', green: 'FF92D050', grey: 'FFD9D9D9', head: 'FFE7ECEF' };
  function colL(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function fill(cell, argb) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } }; }
  var thin = { style: 'thin', color: { argb: 'FF808080' } };
  var border = { top: thin, left: thin, bottom: thin, right: thin };

  async function toExcel(model) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Сводный по кварталу';
    var ws = wb.addWorksheet('сводный', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
    var M = model.months, n = M.length;
    var cOpen = 3, cPr = 4, cRe = 4 + n, cClose = 4 + n + 2 * n;
    var last = cClose;
    function at(r, c) { return ws.getCell(r, c + 1); }

    // шапка
    [['№ п/п', 0], ['Номенклатура', 1], ['Ед.изм.', 2]].forEach(function (h) { at(1, h[1]).value = h[0]; ws.mergeCells(1, h[1] + 1, 2, h[1] + 1); });
    at(1, cOpen).value = 'остаток на ' + (model.openLabel || 'начало'); ws.mergeCells(1, cOpen + 1, 2, cOpen + 1);
    at(1, cPr).value = 'ПРИХОД'; if (n > 1) ws.mergeCells(1, cPr + 1, 1, cPr + n);
    at(1, cRe).value = 'РЕАЛИЗАЦИЯ'; if (n > 0) ws.mergeCells(1, cRe + 1, 1, cRe + 2 * n);
    at(1, cClose).value = 'Остатки на ' + (model.closeLabel || 'конец'); ws.mergeCells(1, cClose + 1, 2, cClose + 1);
    M.forEach(function (k, i) {
      at(2, cPr + i).value = ymLabel(k) + ' ' + fmt(model.totals.prihod[k]).replace(/ /g, '') + 'шт';
      at(2, cRe + 2 * i).value = 'реал ВС ' + ymLabel(k);
      at(2, cRe + 2 * i + 1).value = 'реализация за ' + ymLabel(k) + ' А';
    });
    for (var r = 1; r <= 2; r++) for (var c = 0; c <= last; c++) {
      var h = at(r, c); h.font = { bold: true }; h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; h.border = border; fill(h, C.head);
    }
    ws.getRow(2).height = 42;

    var first = 3;
    model.rows.forEach(function (row, i) {
      var R = first + i;
      at(R, 0).value = row.n; at(R, 1).value = row.name; at(R, 2).value = row.unit; at(R, cOpen).value = row.open;
      M.forEach(function (k, j) {
        setQty(at(R, cPr + j), row.prihod[k]);
        setQty(at(R, cRe + 2 * j), row.vs[k]);
        setQty(at(R, cRe + 2 * j + 1), row.a[k]);
        if (row.flags['prihod' + k]) fill(at(R, cPr + j), C.orange);
        if (row.flags['vs' + k]) fill(at(R, cRe + 2 * j), C.green);
        if (row.flags['a' + k]) fill(at(R, cRe + 2 * j + 1), C.orange);
      });
      var f = colL(cOpen) + R;
      for (var j = 0; j < n; j++) f += '+' + colL(cPr + j) + R;
      for (j = 0; j < 2 * n; j++) f += '-' + colL(cRe + j) + R;
      at(R, cClose).value = { formula: f, result: row.close };
      for (var c = 0; c <= last; c++) { at(R, c).border = border; if (c >= cOpen) at(R, c).numFmt = '0'; }
      if (row.isNew) for (c = 0; c <= last; c++) fill(at(R, c), C.yellow);
      else if (row.flagName) fill(at(R, 1), C.orange);
    });
    var T = first + model.rows.length;
    at(T, 1).value = 'ИТОГО';
    for (var c2 = cOpen; c2 <= last; c2++) {
      var L = colL(c2), res = 0;
      model.rows.forEach(function (row, i) { var v = ws.getCell(first + i, c2 + 1).value; res += typeof v === 'number' ? v : (v && v.result) || 0; });
      at(T, c2).value = { formula: 'SUM(' + L + first + ':' + L + (T - 1) + ')', result: Math.round(res * 1000) / 1000 };
      at(T, c2).numFmt = '0';
    }
    for (c2 = 0; c2 <= last; c2++) { at(T, c2).font = { bold: true }; at(T, c2).border = border; fill(at(T, c2), C.grey); }
    ws.addConditionalFormatting({ ref: colL(cClose) + first + ':' + colL(cClose) + (T - 1), rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'],
      style: { font: { color: { argb: 'FF9C0006' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } } }] });
    ws.getColumn(1).width = 5; ws.getColumn(2).width = 48; ws.getColumn(3).width = 8;
    for (c2 = cOpen; c2 <= last; c2++) ws.getColumn(c2 + 1).width = 11;
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: T - 1, column: 4 } };

    // листы-расшифровки
    var howTxt = { exact: 'точно', dict: 'по словарю', fuzzy: 'похоже — проверить', manual: 'выбрано вручную', new: 'новая позиция' };
    function detail(title, list, withCode) {
      var d = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
      var hdr = withCode ? ['Месяц', 'Документ', 'Код', 'Товар (как в файле)', 'Кол-во', 'Ед.', 'Строка в сводной', 'Номенклатура в сводной', 'Сопоставление']
                         : ['Месяц', 'Отчёт', 'Товар (как в файле)', 'Кол-во', 'Сумма', 'Строка в сводной', 'Номенклатура в сводной', 'Сопоставление'];
      d.addRow(hdr).eachCell(function (c) { c.font = { bold: true }; fill(c, C.head); });
      var qCol = withCode ? 5 : 4, sCol = withCode ? null : 5;
      list.forEach(function (ln) {
        var m = ln.match, rowN = first + model.rows.indexOf(ln.row);
        var vals = withCode ? [ymLabel(ln.ym), ln.src.title, ln.code || '', ln.name, ln.qty, ln.unit || 'шт', rowN, ln.row.name, howTxt[m.how] + (m.confirmed ? ' (подтверждено)' : '')]
                            : [ymLabel(ln.ym), (ln.src.org || '') + ' — ' + ln.src.file, ln.name, ln.qty, ln.sum, rowN, ln.row.name, howTxt[m.how] + (m.confirmed ? ' (подтверждено)' : '')];
        var added = d.addRow(vals);
        var col = m.how === 'new' ? C.yellow : ((m.how === 'fuzzy' || m.how === 'manual') && !m.confirmed ? (title === 'реал ВС' ? C.green : C.orange) : null);
        if (col) added.eachCell({ includeEmpty: true }, function (c) { fill(c, col); });
      });
      var nRows = list.length + 1, r0 = nRows + 2;
      var tr = d.getRow(r0); tr.getCell(1).value = 'ИТОГО'; tr.getCell(qCol).value = 'Количество'; if (sCol) tr.getCell(sCol).value = 'Сумма';
      var Lq = colL(qCol - 1), Ls = sCol ? colL(sCol - 1) : null;
      M.forEach(function (k, i) {
        var rr = d.getRow(r0 + 1 + i), lab = ymLabel(k);
        var qs = 0, ss = 0; list.forEach(function (ln) { if (ln.ym === k) { qs += ln.qty || 0; ss += ln.sum || 0; } });
        rr.getCell(1).value = lab;
        rr.getCell(qCol).value = { formula: 'SUMIF($A$2:$A$' + nRows + ',A' + (r0 + 1 + i) + ',' + Lq + '$2:' + Lq + '$' + nRows + ')', result: qs };
        if (sCol) rr.getCell(sCol).value = { formula: 'SUMIF($A$2:$A$' + nRows + ',A' + (r0 + 1 + i) + ',' + Ls + '$2:' + Ls + '$' + nRows + ')', result: Math.round(ss * 100) / 100 };
      });
      var rq = d.getRow(r0 + 1 + n); rq.getCell(1).value = 'итого за период';
      var tq = list.reduce(function (a, l) { return a + (l.qty || 0); }, 0), ts = list.reduce(function (a, l) { return a + (l.sum || 0); }, 0);
      rq.getCell(qCol).value = { formula: 'SUM(' + Lq + (r0 + 1) + ':' + Lq + (r0 + n) + ')', result: tq };
      if (sCol) rq.getCell(sCol).value = { formula: 'SUM(' + Ls + (r0 + 1) + ':' + Ls + (r0 + n) + ')', result: Math.round(ts * 100) / 100 };
      for (var x = r0; x <= r0 + 1 + n; x++) for (var y = 1; y <= hdr.length; y++) { var cc = d.getCell(x, y); cc.font = { bold: true }; fill(cc, C.grey); }
      if (sCol) for (x = 2; x <= r0 + 1 + n; x++) d.getCell(x, sCol).numFmt = '#,##0.00';
      var widths = withCode ? [10, 42, 13, 55, 9, 6, 10, 55, 22] : [10, 40, 55, 9, 14, 10, 55, 22];
      widths.forEach(function (w, i) { d.getColumn(i + 1).width = w; });
      d.autoFilter = { from: { row: 1, column: 1 }, to: { row: nRows, column: hdr.length } };
    }
    detail('приход', model.lines.prihod, true);
    detail('реализация А', model.lines.A, false);
    detail('реал ВС', model.lines.VS, false);

    return wb.xlsx.writeBuffer();

    function setQty(cell, arr) {
      if (!arr || !arr.length) return;
      var s = arr.reduce(function (a, b) { return a + b; }, 0);
      cell.value = arr.length === 1 ? arr[0] : { formula: arr.join('+').replace(/\+-/g, '-'), result: s };
    }
  }


  // ---------- период для дашборда ----------
  function sumArr(a) { return a ? a.reduce(function (x, y) { return x + y; }, 0) : 0; }
  function compact(o, arrays) {
    var r = {}, any = false;
    Object.keys(o || {}).forEach(function (k) { var v = arrays ? sumArr(o[k]) : o[k]; if (v) { r[k] = Math.round(v * 100) / 100; any = true; } });
    return any ? r : undefined;
  }
  function ym2id(k) { return ymYear(k) + '-' + pad(k % 12 + 1); }
  function periodLabel(M) { return (M.length > 1 ? MONTHS_NOM[M[0] % 12] + ' – ' : '') + MONTHS_NOM[M[M.length - 1] % 12] + ' ' + ymYear(M[M.length - 1]); }
  function toPeriod(model) {
    var M = model.months;
    return {
      id: ym2id(M[0]) + '_' + ym2id(M[M.length - 1]), label: periodLabel(M),
      months: M.slice(), openLabel: model.openLabel, closeLabel: model.closeLabel, source: 'calc', savedAt: Date.now(),
      rows: model.rows.map(function (r) {
        return { name: r.name, unit: r.unit, open: r.open, close: r.close,
          p: compact(r.prihod, true), vs: compact(r.vs, true), a: compact(r.a, true),
          pS: compact(r.prihodSum), vsS: compact(r.vsSum), aS: compact(r.aSum) };
      })
    };
  }
  var MSTEM = [/янв/, /фев/, /мар/, /апр/, /ма[йя]/, /июн/, /июл/, /авг/, /сен/, /окт/, /ноя/, /дек/];
  function monthIn(label) { for (var i = 0; i < 12; i++) if (MSTEM[i].test(label)) return i; return -1; }
  function dateOf(t) {
    var d = String(t).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/); if (!d) return null;
    var y = +d[3]; if (y < 100) y += 2000;
    return { ym: ym(y, +d[2] - 1), label: pad(+d[1]) + '.' + pad(+d[2]) + '.' + String(y).slice(2) };
  }

  // готовый сводный (.xlsx) → период (только количества, без сумм)
  function readPeriods(data, fileName) {
    var wb = XLSX.read(data, { type: 'array', cellFormula: true, sheetStubs: true });
    var out = [];
    wb.SheetNames.forEach(function (n) {
      var ws = wb.Sheets[n], rows = rowsOf(ws).rows;
      for (var hr = 0; hr < Math.min(rows.length, 6); hr++) {
        var low = rows[hr].map(function (v) { return txt(v).toLowerCase(); });
        var nameCol = low.indexOf('номенклатура');
        if (nameCol < 0 || !low.some(function (v) { return /остат/.test(v); })) continue;
        var openCol = low.findIndex(function (v) { return /остат/.test(v); }), closeCol = -1, c;
        for (c = low.length - 1; c > openCol; c--) if (/остат/.test(low[c])) { closeCol = c; break; }
        if (closeCol < 0) break;
        var cd = dateOf(low[closeCol]), od = dateOf(low[openCol]);
        if (!cd) break;
        var sub = rows[hr + 1] || [], grp = '', cols = [];
        for (c = openCol + 1; c < closeCol; c++) {
          var top = txt(rows[hr][c]).toLowerCase(); if (top) grp = top;
          var lab = (txt(sub[c]) || txt(rows[hr][c])).toLowerCase(), mi = monthIn(lab);
          if (mi < 0) continue;
          var yy = ymYear(cd.ym); if (mi > cd.ym % 12) yy--;
          var kind = /вс/.test(lab) ? 'vs' : /реал/.test(lab) ? 'a' : /реал/.test(grp) ? 'a' : 'p';
          cols.push({ c: c, ym: ym(yy, mi), kind: kind });
        }
        var months = [];
        cols.forEach(function (x) { if (months.indexOf(x.ym) < 0) months.push(x.ym); });
        months.sort(function (a, b) { return a - b; });
        var start = hr + 1; if (rows[start] && !txt(rows[start][nameCol])) start++;
        var unitCol = low.findIndex(function (v) { return /^ед/.test(v); });
        var prows = [];
        for (var r = start; r < rows.length; r++) {
          var name = txt(rows[r][nameCol]); if (!name || /^итого/i.test(name)) continue;
          var pr = { name: name, unit: unitCol >= 0 ? txt(rows[r][unitCol]) || 'шт' : 'шт',
            open: evalCell(ws, XLSX.utils.encode_cell({ r: r, c: openCol }), 0), close: evalCell(ws, XLSX.utils.encode_cell({ r: r, c: closeCol }), 0) };
          cols.forEach(function (x) {
            var v = evalCell(ws, XLSX.utils.encode_cell({ r: r, c: x.c }), 0);
            if (v) { pr[x.kind] = pr[x.kind] || {}; pr[x.kind][x.ym] = (pr[x.kind][x.ym] || 0) + v; }
          });
          prows.push(pr);
        }
        if (months.length && prows.length) out.push({ id: ym2id(months[0]) + '_' + ym2id(months[months.length - 1]), label: periodLabel(months),
          months: months, openLabel: od ? od.label : null, closeLabel: cd.label, source: 'import', file: fileName, savedAt: Date.now(), rows: prows });
        break;
      }
    });
    return out;
  }

  return { toPeriod: toPeriod, readPeriods: readPeriods, MONTHS_NOM: MONTHS_NOM, readWorkbook: readWorkbook, build: build, toExcel: toExcel, key: key, norm: norm, fmt: fmt, ymLabel: ymLabel, ymYear: ymYear, dateLabel: dateLabel, similarity: similarity, compatible: compatible };
})();
if (typeof module !== 'undefined') module.exports = Core;
