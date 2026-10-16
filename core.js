// Серверная часть сайта Magic Spices: общее хранилище (Netlify Blobs), пароль и чат через OpenAI.
// Переменные окружения (Netlify → Site configuration → Environment variables):
//   SITE_PASSWORD   — пароль для входа на сайт (обязательно задайте)
//   OPENAI_API_KEY  — ключ OpenAI для чата (без него чат выключен, подсказки работают)
//   OPENAI_MODEL    — модель, по умолчанию gpt-5-mini
import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const MAX_BODY = 5 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function store() {
  return globalThis.__TEST_STORE__ || getStore({ name: "magicspices", consistency: "strong" });
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
      return json({ ok: true, authorized: authorized(req), passwordSet: !!env("SITE_PASSWORD"), ai: !!env("OPENAI_API_KEY"), model: env("OPENAI_MODEL") || "gpt-5-mini" });
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
      const model = env("OPENAI_MODEL") || "gpt-5-mini";
      const history = (Array.isArray(p.messages) ? p.messages : [])
        .filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
        .slice(-12).map((x) => ({ role: x.role, content: x.content.slice(0, 8000) }));
      if (!history.length || history[history.length - 1].role !== "user") return err(400, "Нет вопроса");
      const context = String(p.context || "").slice(0, 150000);
      const system = [
        "Ты — помощник по бизнесу компании Magic Spices (специи и приправы, склад и продажи).",
        "Отвечай по-русски, коротко и по делу. Опирайся только на данные ниже; если данных не хватает — так и скажи, ничего не выдумывай.",
        "Каналы продаж: «А» (реализация А) и «ВС» (реал ВС). Количества в штуках. Суммы продаж — в валюте отчётов; суммы прихода — в валюте накладных поставщика.",
        "Когда советуешь, что заказать, объясняй расчёт: средние продажи в месяц, текущий остаток, на сколько месяцев хватит.",
        "ДАННЫЕ:\n" + context,
      ].join("\n");
      const payload = { model, messages: [{ role: "system", content: system }, ...history] };
      if (/^(gpt-5|o\d)/.test(model)) { payload.max_completion_tokens = 4000; payload.reasoning_effort = "low"; }
      else { payload.max_tokens = 1500; payload.temperature = 0.2; }
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return err(502, "OpenAI: " + (data.error && data.error.message || r.status));
      const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return json({ reply: reply || "(пустой ответ)", model, usage: data.usage || null });
    }

    return err(404, "Не найдено");
  } catch (e) {
    return err(e.status || 500, e.message || "Ошибка сервера");
  }
};

export const config = { path: "/api/*" };
