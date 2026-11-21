// ohmycar (らくがきダッシュ) Worker
// 静的アセット配信 + ランキング用 records API（フライングディスクと同じ
// POST /actions {action, args} 方式: records.list / records.create）
const COLLECTION = "rakugaki_dash_distance_scores";
const PREFIX = "s:";
const RANKS = ["金", "銀", "銅", "−"];
const DIFFS = ["easy", "normal", "hard"];

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function cleanName(v) {
  if (typeof v !== "string") return null;
  const name = v.replace(/[<>&"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 12);
  return name.length >= 1 ? name : null;
}

async function listRecords(env) {
  const out = [];
  let cursor = undefined;
  for (let page = 0; page < 5; page++) {
    const res = await env.SCORES.list({ prefix: PREFIX, limit: 1000, cursor });
    for (const k of res.keys) {
      const raw = await env.SCORES.get(k.name);
      if (!raw) continue;
      try {
        const value = JSON.parse(raw);
        if (value && typeof value.best === "number" && typeof value.name === "string") {
          out.push({ value });
        }
      } catch (e) { /* skip broken record */ }
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  out.sort((a, b) => (b.value.best || 0) - (a.value.best || 0));
  return out.slice(0, 100);
}

async function createRecord(env, args) {
  const v = (args && args.value) || {};
  const name = cleanName(v.name);
  if (!name) return { error: "invalid name" };
  const best = Math.floor(Number(v.best));
  if (!isFinite(best) || best < 0 || best > 999999) return { error: "invalid best" };
  const rank = RANKS.includes(v.rank) ? v.rank : "−";
  const diff = DIFFS.includes(v.diff) ? v.diff : "normal";
  const playedAt = typeof v.playedAt === "string" ? v.playedAt.slice(0, 40) : new Date().toISOString();
  const key = PREFIX + name;
  const existingRaw = await env.SCORES.get(key);
  let existing = null;
  if (existingRaw) { try { existing = JSON.parse(existingRaw); } catch (e) { existing = null; } }
  if (existing && typeof existing.best === "number" && existing.best >= best) {
    return { record: { value: existing }, updated: false };
  }
  const value = { name, best, total: best, rank, diff, playedAt };
  await env.SCORES.put(key, JSON.stringify(value));
  return { record: { value }, updated: true };
}

async function handleActions(request, env) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "invalid json" }, 400); }
  const action = body && body.action;
  const args = (body && body.args) || {};
  if (args.collection !== COLLECTION) return json({ error: "unknown collection" }, 404);
  if (action === "records.list") {
    return json({ data: { records: await listRecords(env) } });
  }
  if (action === "records.create") {
    const r = await createRecord(env, args);
    if (r.error) return json({ error: r.error }, 400);
    return json({ data: r });
  }
  return json({ error: "unknown action" }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/actions") return handleActions(request, env);
    return env.ASSETS.fetch(request);
  },
};
