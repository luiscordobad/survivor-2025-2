// api/_theoddsapi.mjs
// Helper compartido para hablar con The Odds API (the-odds-api.com), que
// reemplaza a la API de ESPN para partidos/marcadores: ESPN bloquea por IP
// a los servidores de Vercel/AWS (confirmado con pruebas cruzadas), mientras
// que The Odds API sí acepta tráfico de servidor porque es su modelo de
// negocio (requiere ODDS_API_KEY, tiene plan gratuito).
//
// Limitación conocida: The Odds API no tiene estadísticas de equipo, líderes
// de partido, lesiones ni "últimos 5 juegos" -- eso era exclusivo de ESPN y
// se queda sin datos hasta que haya otra fuente para eso.

export const TEAM_ALIAS = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB:  "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC:  "Kansas City Chiefs",
  LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  LV:  "Las Vegas Raiders",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE:  "New England Patriots",
  NO:  "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks",
  SF:  "San Francisco 49ers",
  TB:  "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
};

export const NAME_TO_ABBR = Object.fromEntries(
  Object.entries(TEAM_ALIAS).map(([abbr, name]) => [name, abbr])
);

export function abbrFor(providerName) {
  return NAME_TO_ABBR[providerName] || providerName;
}

// Ancla de la semana 1 por temporada: el martes anterior al primer kickoff
// (jueves). The Odds API no da número de semana, así que lo calculamos por
// fecha. Configurable vía env SEASON_WEEK1_START para no tener que tocar
// código en temporadas futuras.
const DEFAULT_WEEK1_START = {
  2025: "2025-09-02", // martes previo al jueves 4 de septiembre de 2025
  2026: "2026-09-08", // martes previo al jueves 10 de septiembre de 2026
};

export function week1StartFor(season) {
  return process.env.SEASON_WEEK1_START || DEFAULT_WEEK1_START[season] || DEFAULT_WEEK1_START[2026];
}

const NFL_TZ = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

// Convierte una fecha a "medianoche" en la zona horaria de referencia de la
// NFL sin depender de una librería de timezone: usa el offset que Intl ya
// resuelve para esa fecha/zona.
function startOfDayInTZ(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  // Medianoche UTC de ese Y-M-D es suficiente para diferenciar días completos;
  // como comparamos ambos lados (juego y ancla) con la misma conversión, el
  // offset de zona horaria se cancela.
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

export function weekForDate(commenceTimeISO, season) {
  const game = startOfDayInTZ(new Date(commenceTimeISO), NFL_TZ);
  const week1 = startOfDayInTZ(new Date(`${week1StartFor(season)}T12:00:00Z`), NFL_TZ);
  const diffDays = Math.round((game - week1) / DAY_MS);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

export async function fetchOddsApiJSON(path, params = {}) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("Missing ODDS_API_KEY");
  const qs = new URLSearchParams({ ...params, apiKey });
  const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/${path}?${qs}`;
  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Odds API HTTP ${r.status} for ${path}: ${text.slice(0, 300)}`);
  }
  return r.json();
}
