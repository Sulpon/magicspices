// Серверная часть сайта Magic Spices: общее хранилище (Netlify Blobs), пароль и чат через OpenAI.
// Переменные окружения (Netlify → Site configuration → Environment variables):
//   SITE_PASSWORD   — пароль для входа на сайт (обязательно задайте)
//   OPENAI_API_KEY  — ключ OpenAI для чата (без него чат выключен, подсказки работают)
//   OPENAI_MODEL    — модель, по умолчанию gpt-6-luna
import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const MAX_BODY = 5 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function store() {
  return globalThis.__TEST_STORE__ || getStore({ name: "magicspices", consistency: "strong" });
}
const recentHits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, prev = (recentHits.get(ip) || []).filter((t) => now - t < win);
  if (prev.length >= 30) return true;
  prev.push(now); recentHits.set(ip, prev);
  if (recentHits.size > 500) for (const [k, h] of recentHits) if (!h.some((t) => now - t < win)) recentHits.delete(k);
  return false;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function err(status, message) { return json({ error: message }, status); }
function env(name) {
  try { if (globalThis.Netlify && Netlify.env) { const v = Netlify.env.get(name); if (v) return v; } } catch (e) {}
  return process.env[name] || "";
}
function authorized(req) {
  const pass = env("SITE_PASSWORD");
  if (!pass) return true;
  const got = req.headers.get("x-site-key") || "";
  const a = Buffer.from(got), b = Buffer.from(pass);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error("Слишком большой запрос"), { status: 413 });
  try { return JSON.parse(text || "{}"); } catch (e) { throw Object.assign(new Error("Неверный JSON"), { status: 400 }); }
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [section, id] = parts;
  const m = req.method;
  try {
    if (section === "status") {
      return json({ ok: true, authorized: authorized(req), passwordSet: !!env("SITE_PASSWORD"), ai: !!env("OPENAI_API_KEY"), model: env("OPENAI_MODEL") || "gpt-6-luna" });
    }
    if (!authorized(req)) return err(401, "Нужен пароль");
    const s = store();

    // ---- сохранённые сводные (периоды) ----
    if (section === "periods") {
      if (m === "GET" && !id) {
        const { blobs } = await s.list({ prefix: "periods/" });
        const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
        return json(all.filter(Boolean).sort((a, b) => (a.months?.[0] || 0) - (b.months?.[0] || 0)));
      }
      if (!id || !ID_RE.test(id)) return err(400, "Неверный идентификатор");
      if (m === "PUT") {
        const p = await body(req);
        if (!Array.isArray(p.rows) || !Array.isArray(p.months) || !p.months.length) return err(400, "Нет строк или месяцев");
        p.id = id; p.savedAt = Date.now();
        await s.setJSON("periods/" + id, p);
        return json({ ok: true, id });
      }
      if (m === "DELETE") { await s.delete("periods/" + id); return json({ ok: true }); }
      return err(405, "Метод не поддерживается");
    }

    // ---- архив Excel-файлов (исходные и готовые сводные) ----
    if (section === "files") {
      if (m === "GET" && !id) {
        // Описание каждого файла лежит отдельной записью (без общего списка), чтобы параллельные загрузки не затирали друг друга.
        const [fl, ml] = await Promise.all([s.list({ prefix: "files/" }), s.list({ prefix: "filemeta/" })]);
        const have = new Set(ml.blobs.map((b) => b.key.slice(9)));
        const metas = await Promise.all(ml.blobs.map((b) => s.get(b.key, { type: "json" })));
        const out = metas.filter(Boolean);
        // самолечение: файлы, у которых нет описания (потерялись из-за старого общего списка)
        for (const b of fl.blobs) {
          const fid = b.key.slice(6);
          if (have.has(fid)) continue;
          const rec = await s.get(b.key, { type: "json" });
          if (!rec) continue;
          const meta = { id: fid, name: rec.name, kind: rec.kind, periodId: rec.periodId, size: rec.size, added: rec.added };
          await s.setJSON("filemeta/" + fid, meta);
          out.push(meta);
        }
        return json(out.sort((a, b) => (b.added || 0) - (a.added || 0)));
      }
      if (!id || !ID_RE.test(id)) return err(400, "Неверный идентификатор");
      if (m === "GET") {
        const f = await s.get("files/" + id, { type: "json" });
        return f ? json(f) : err(404, "Файл не найден");
      }
      if (m === "PUT") {
        const p = await body(req);
        if (typeof p.b64 !== "string" || !p.b64) return err(400, "Нет содержимого файла");
        if (p.b64.length > 4.6 * 1024 * 1024) return err(413, "Файл больше 3,4 МБ — слишком большой для архива");
        const rec = { id, name: String(p.name || id).slice(0, 200), kind: String(p.kind || "source").slice(0, 20), periodId: String(p.periodId || "").slice(0, 80), size: Math.floor(p.b64.length * 3 / 4), added: Date.now(), b64: p.b64 };
        await s.setJSON("files/" + id, rec);
        const meta = { id, name: rec.name, kind: rec.kind, periodId: rec.periodId, size: rec.size, added: rec.added };
        await s.setJSON("filemeta/" + id, meta);
        return json({ ok: true, file: meta });
      }
      if (m === "DELETE") {
        await Promise.all([s.delete("files/" + id), s.delete("filemeta/" + id)]);
        return json({ ok: true });
      }
      return err(405, "Метод не поддерживается");
    }

    // ---- загруженные страницы ----
    if (section === "pages") {
      if (m === "GET" && !id) {
        const idx = (await s.get("pages-index", { type: "json" })) || [];
        return json(idx);
      }
      if (!id || !ID_RE.test(id)) return err(400, "Неверный идентификатор");
      if (m === "GET") {
        const p = await s.get("pages/" + id, { type: "json" });
        return p ? json(p) : err(404, "Страница не найдена");
      }
      if (m === "PUT") {
        const p = await body(req);
        if (typeof p.html !== "string" || !p.html.trim()) return err(400, "Нет HTML");
        const page = { id, title: String(p.title || id).slice(0, 120), desc: String(p.desc || "").slice(0, 400), tag: String(p.tag || "").slice(0, 40), html: p.html, updated: Date.now() };
        await s.setJSON("pages/" + id, page);
        let idx = (await s.get("pages-index", { type: "json" })) || [];
        const meta = { id, title: page.title, desc: page.desc, tag: page.tag, updated: page.updated, size: page.html.length };
        const i = idx.findIndex((x) => x.id === id);
        if (i >= 0) idx[i] = meta; else idx.push(meta);
        if (Array.isArray(p.order)) idx.sort((a, b) => p.order.indexOf(a.id) - p.order.indexOf(b.id));
        await s.setJSON("pages-index", idx);
        return json({ ok: true, page: meta });
      }
      if (m === "DELETE") {
        await s.delete("pages/" + id);
        const idx = ((await s.get("pages-index", { type: "json" })) || []).filter((x) => x.id !== id);
        await s.setJSON("pages-index", idx);
        return json({ ok: true });
      }
      return err(405, "Метод не поддерживается");
    }

    // ---- общие настройки (исправления названий, валюта и т. п.) ----
    if (section === "settings") {
      if (m === "GET") return json((await s.get("settings", { type: "json" })) || {});
      if (m === "PUT") {
        const patch = await body(req);
        const cur = (await s.get("settings", { type: "json" })) || {};
        const next = Object.assign({}, cur, patch, { updated: Date.now() });
        await s.setJSON("settings", next);
        return json(next);
      }
      return err(405, "Метод не поддерживается");
    }

    // ---- чат с ChatGPT ----
    if (section === "chat" && m === "POST") {
      const key = env("OPENAI_API_KEY");
      if (!key) return err(503, "Чат не настроен: добавьте OPENAI_API_KEY в настройках Netlify");
      const p = await body(req);
      const model = env("OPENAI_MODEL") || "gpt-6-luna";
      const history = (Array.isArray(p.messages) ? p.messages : [])
        .filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
        .slice(-12).map((x) => ({ role: x.role, content: x.content.slice(0, 8000) }));
      if (!history.length || history[history.length - 1].role !== "user") return err(400, "Нет вопроса");
      const context = String(p.context || "").slice(0, 150000);
      const system = [
        "Ты — помощник по бизнесу компании «Волшебное дерево» / Magic Spices (специи и приправы, склад и продажи).",
        "Отвечай по-русски, коротко и по делу. Опирайся только на данные ниже; если данных не хватает — так и скажи, ничего не выдумывай.",
        "Каналы продаж: «А» (реализация А) и «ВС» (реал ВС). Количества в штуках. Суммы продаж — в валюте отчётов; суммы прихода — в валюте накладных поставщика.",
        "Когда советуешь, что заказать, объясняй расчёт: средние продажи в месяц, текущий остаток, на сколько месяцев хватит.",
        "ДАННЫЕ:\n" + context,
      ].join("\n");
      if (rateLimited(req.headers.get("x-nf-client-connection-ip") || "unknown")) return err(429, "Слишком много запросов. Подождите несколько минут.");
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({ model, instructions: system, input: history, max_output_tokens: 3000, store: false }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data.error && data.error.message) || String(r.status);
        console.error("OpenAI API error", r.status, data.error && data.error.code);
        if (r.status === 401) return err(502, "OpenAI отклонил API-ключ. Проверьте OPENAI_API_KEY в Netlify.");
        if (r.status === 429) return err(429, "Закончился баланс или лимит OpenAI. Проверьте биллинг API на platform.openai.com.");
        return err(502, "OpenAI: " + msg);
      }
      const reply = typeof data.output_text === "string" ? data.output_text.trim()
        : (data.output || []).flatMap((x) => x.content || []).filter((c) => c.type === "output_text").map((c) => c.text).join("\n").trim();
      return json({ reply: reply || "(пустой ответ)", model, usage: data.usage || null });
    }

    return err(404, "Не найдено");
  } catch (e) {
    return err(e.status || 500, e.message || "Ошибка сервера");
  }
};

export const config = { path: "/api/*" };
