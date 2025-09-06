// api/backfillSeason.mjs
// Backfill NFL (ESPN) a "games" usando external_id para upsert seguro.
// Llamado: /api/backfillSeason?season=2021&token=CRON_TOKEN[&playoffs=true]

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;
const CRON_TOKEN = process.env.CRON_TOKEN;

if (!globalThis.fetch) {
  // Node 18+ ya trae fetch. Esto es por si tu runtime es más viejo.
  // pero en Vercel es Node 18/20/22, así que fetch existe.
}

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// Normaliza abreviaturas para que coincidan con tus teams.id
const TEAM_MAP = {
  JAX: "JAC",
  WSH: "WAS",
  // Ajusta si fuera necesario: LV/LVR, LAR, LAC etc.
};
const normTeam = (a) => TEAM_MAP[a] || a;

function parseGame(event, season, week, seasonType) {
  const comp = (event.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");

  const homeId = normTeam(home?.team?.abbreviation || "");
  const awayId = normTeam(away?.team?.abbreviation || "");

  const home_score = home?.score != null ? Number(home.score) : null;
  const away_score = away?.score != null ? Number(away.score) : null;

  const state = event?.status?.type?.state || "pre";
  const status =
    state === "post" ? "final" : state === "in" ? "in_progress" : "scheduled";

  const venue = comp.venue || {};
  const venue_city = venue?.address?.city || null;

  // external_id único por temporada/evento (no usamos games.id)
  const external_id = `${season}:${seasonType}:${week}:${event.id}`;

  return {
    external_id,
    season,
    week,
    start_time: event?.date || null,
    status,
    home_team: homeId,
    away_team: awayId,
    home_score,
    away_score,
    venue_city,
  };
}

async function fetchWeek(season, week, seasonType) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=${season}&seasontype=${seasonType}&week=${week}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status} - ${url}`);
  const j = await r.json();
  const events = j?.events || [];
  return events.map((ev) => parseGame(ev, season, week, seasonType));
}

async function upsertGames(rows) {
  if (!rows.length) return 0;
  const { error } = await sb.from("games").upsert(rows, {
    onConflict: "external_id", // usa el índice único
  });
  if (error) throw error;
  return rows.length;
}

export default async function handler(req, res) {
  try {
    // Validación básica
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ ok: false, error: "Missing SUPABASE envs" });
    }
    if (!CRON_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing CRON_TOKEN env" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    const season = Number(url.searchParams.get("season"));
    const playoffs = url.searchParams.get("playoffs") === "true";

    if (token !== CRON_TOKEN) {
      return res.status(401).json({ ok: false, error: "Bad token" });
    }
    if (!season || season < 2010 || season > 2025) {
      return res.status(400).json({ ok: false, error: "season inválido (2010–2025)" });
    }

    let total = 0;

    // Regular (seasontype=2)
    for (let w = 1; w <= 18; w++) {
      const rows = await fetchWeek(season, w, 2);
      if (rows.length) total += await upsertGames(rows);
      await new Promise((r) => setTimeout(r, 120));
    }

    // Playoffs (seasontype=3) — 1..5 suele bastar
    if (playoffs) {
      for (let w = 1; w <= 5; w++) {
        const rows = await fetchWeek(season, w, 3);
        if (rows.length) total += await upsertGames(rows);
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    return res.json({ ok: true, season, playoffs, upserted: total });
  } catch (e) {
    console.error("backfillSeason error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
