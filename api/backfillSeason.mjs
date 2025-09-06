// api/backfillSeason.mjs
// Backfill de temporadas históricas NFL (ESPN) a la tabla "games" de Supabase
// Uso:
//   Regular season:   /api/backfillSeason?season=2021&token=CRON_TOKEN
//   Con playoffs:     /api/backfillSeason?season=2021&playoffs=true&token=CRON_TOKEN
//
// Requiere env:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE (o anon con políticas que permitan upsert en games; recomendable service role)
//   - CRON_TOKEN
//
// Nota: usa fetch nativo de Node 18+ (Vercel OK). No instales node-fetch.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;
const CRON_TOKEN = process.env.CRON_TOKEN;

const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// Normaliza abreviaturas de ESPN a tus IDs en tabla teams
const TEAM_MAP = {
  JAX: "JAC", // ESPN usa JAX, tabla suele tener JAC
  WSH: "WAS", // Washington
  // Si en tu tabla usas LVR o LA, ajusta aquí. NFL actual: LV (Raiders), LAR (Rams), LAC (Chargers)
  LV: "LV",
  LVR: "LV",
  LAR: "LAR",
  LAC: "LAC",
  NO: "NO",
  SF: "SF",
  TB: "TB",
  // agrega aquí cualquier otro mapeo especial que tengas
};

function normTeam(id) {
  return TEAM_MAP[id] || id;
}

function pickScore(obj, teamAbbr) {
  // Devuelve {homeScore, awayScore} según team order
  // pero vamos a leer del array de competitors directamente
  return obj;
}

function parseGame(event, season, week) {
  // ESPN structure:
  // event.competitions[0].competitors -> [{homeAway:'home'|'away', team:{abbreviation}, score}, ...]
  // event.status.type.state -> 'pre' | 'in' | 'post'
  const comp = (event.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");

  const homeId = normTeam(home?.team?.abbreviation || "");
  const awayId = normTeam(away?.team?.abbreviation || "");

  const home_score = home?.score != null ? Number(home.score) : null;
  const away_score = away?.score != null ? Number(away.score) : null;

  const statusState = event?.status?.type?.state || "pre";
  // nuestro campo status admite: 'scheduled' | 'in_progress' | 'final'
  const status =
    statusState === "post"
      ? "final"
      : statusState === "in"
      ? "in_progress"
      : "scheduled";

  const venue = comp.venue || {};
  const venue_city = venue?.address?.city || null;

  // id estable: usa event.id + season + week para evitar colisiones multi-temporada
  // si ya tienes una convención distinta, ajústalo (por ej. event.id string ya es único por temporada)
  const id = `${season}-W${week}-${awayId}@${homeId}-${event.id}`;

  return {
    id,
    season,
    week,
    start_time: event?.date || null,
    status,
    home_team: homeId,
    away_team: awayId,
    home_score,
    away_score,
    venue_city,
    // Opcionales si tu tabla los tiene: period, clock, possession, red_zone...
  };
}

async function fetchWeek(season, week, seasonType) {
  // seasonType: 2=regular, 3=postseason
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=${season}&seasontype=${seasonType}&week=${week}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN ${season}/${week} (${seasonType}) HTTP ${r.status}`);
  const j = await r.json();
  const events = j?.events || [];
  return events.map((ev) => parseGame(ev, season, week));
}

async function upsertGames(rows) {
  if (!rows.length) return { count: 0 };
  // Ajusta columnas según tu schema real de "games"
  const { data, error } = await sb
    .from("games")
    .upsert(rows, { onConflict: "id" });
  if (error) throw error;
  return { count: rows.length };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    const season = Number(url.searchParams.get("season"));
    const playoffs = url.searchParams.get("playoffs") === "true";

    if (!CRON_TOKEN) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing CRON_TOKEN env" });
    }
    if (!token || token !== CRON_TOKEN) {
      return res.status(401).json({ ok: false, error: "Bad token" });
    }
    if (!season || season < 2010 || season > 2025) {
      return res
        .status(400)
        .json({ ok: false, error: "season inválido (2010–2025)" });
    }

    let total = 0;

    // Regular season W1–W18 (seasontype=2)
    for (let w = 1; w <= 18; w++) {
      const games = await fetchWeek(season, w, 2);
      if (games.length) {
        const { count } = await upsertGames(games);
        total += count;
      }
      // pequeña pausa para no saturar (opcional)
      await new Promise((r) => setTimeout(r, 120));
    }

    // Playoffs (seasontype=3). ESPN usa ~5 semanas (WC, Div, Conf, SB, a veces ProBowl no aplica).
    if (playoffs) {
      for (let w = 1; w <= 5; w++) {
        const games = await fetchWeek(season, w, 3);
        if (games.length) {
          const { count } = await upsertGames(games);
          total += count;
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    return res.json({ ok: true, season, playoffs, inserted_or_updated: total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
