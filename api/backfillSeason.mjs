// api/backfillSeason.mjs
// Backfill NFL sin usar "calendar": escanea fechas día a día (agosto→febrero)
// Upsert por external_id, deduplicando por event.id

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;
const CRON_TOKEN = process.env.CRON_TOKEN;

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// Ajusta abreviaturas a tus IDs de teams
const TEAM_MAP = { JAX: "JAC", WSH: "WAS", LVR: "LV" };
const norm = (a) => TEAM_MAP[a] || a;

function yyyymmdd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function fetchJSON(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const r = await fetch(url, { headers: { "User-Agent": "SurvivorBackfill/1.0" } });
    if (r.ok) return r.json();
    if (i === retries) throw new Error(`ESPN HTTP ${r.status} - ${url}`);
    await new Promise((res) => setTimeout(res, 200 + 150 * i));
  }
}

function parseEvent(ev, season, seasonType, weekNumberFromResp) {
  const comp = (ev.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");

  const homeId = norm(home?.team?.abbreviation || "");
  const awayId = norm(away?.team?.abbreviation || "");

  const home_score = home?.score != null ? Number(home.score) : null;
  const away_score = away?.score != null ? Number(away.score) : null;

  const state = ev?.status?.type?.state || "pre";
  const status =
    state === "post" ? "final" : state === "in" ? "in_progress" : "scheduled";

  const venue = comp.venue || {};
  const venue_city = venue?.address?.city || null;

  const external_id = `${season}:${seasonType}:${weekNumberFromResp}:${ev.id}`;

  return {
    external_id,
    season,
    week: weekNumberFromResp ?? null,
    start_time: ev?.date || null,
    status,
    home_team: homeId,
    away_team: awayId,
    home_score,
    away_score,
    venue_city,
  };
}

async function scanByDates({ season, seasonType, from, to }) {
  // from/to son Date
  const seen = new Set();
  const rows = [];

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = yyyymmdd(d);
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateStr}`;
    try {
      const j = await fetchJSON(url);
      // Filtros por temporada y tipo
      const respSeasonYear = j?.season?.year;
      const respSeasonType = j?.season?.type; // 2 regular, 3 post
      const weekNumber = j?.week?.number ?? null;

      // Si no coincide la season o type, ignora ese día (a veces ESPN mete otros eventos)
      if (respSeasonYear !== season || respSeasonType !== seasonType) continue;

      const events = j?.events || [];
      for (const ev of events) {
        const id = ev?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push(parseEvent(ev, season, seasonType, weekNumber));
      }
    } catch {
      // día con error → continuamos
    }
    // respirito
    await new Promise((r) => setTimeout(r, 80));
  }
  return rows;
}

async function upsertGames(rows) {
  if (!rows.length) return 0;
  const { error } = await sb.from("games").upsert(rows, { onConflict: "external_id" });
  if (error) throw error;
  return rows.length;
}

export default async function handler(req, res) {
  try {
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

    if (token !== CRON_TOKEN) return res.status(401).json({ ok: false, error: "Bad token" });
    if (!season || season < 2010 || season > 2025)
      return res.status(400).json({ ok: false, error: "season inválido (2010–2025)" });

    let total = 0;

    // ----- Regular Season (type=2) => de 1 Ago a 15 Ene del siguiente año -----
    {
      const from = new Date(season, 7, 1); // 1 ago (mes 7)
      const to = new Date(season + 1, 0, 15); // 15 ene del siguiente año
      const rows = await scanByDates({ season, seasonType: 2, from, to });
      if (rows.length) total += await upsertGames(rows);
    }

    // ----- Playoffs (type=3) si pidió playoffs => 10 Ene a 20 Feb -----
    if (playoffs) {
      const from = new Date(season + 1, 0, 10); // 10 ene siguiente año
      const to = new Date(season + 1, 1, 20); // 20 feb
      const rows = await scanByDates({ season, seasonType: 3, from, to });
      if (rows.length) total += await upsertGames(rows);
    }

    return res.json({ ok: true, season, playoffs, upserted: total });
  } catch (e) {
    console.error("backfillSeason error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

