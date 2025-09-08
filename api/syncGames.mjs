// api/syncGames.mjs
export const config = { runtime: 'edge' };

// Utilidad JSON sin caché
const j = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

export default async function handler(req) {
  const url = new URL(req.url);
  const method = req.method; // GET | HEAD

  // Solo GET/HEAD
  if (method !== 'GET' && method !== 'HEAD') {
    return j({ ok: false, error: 'method_not_allowed' }, 405);
  }

  // Token
  const token = url.searchParams.get('token') || '';
  if (!token || token !== (process.env.CRON_TOKEN || '')) {
    return j({ ok: false, error: 'bad_token' }, 401);
  }

  // Parámetros opcionales
  const season = url.searchParams.get('season') || '2025';
  const week = url.searchParams.get('week') ? Number(url.searchParams.get('week')) : null;

  try {
    // -----------------------------
    // TU LÓGICA REAL AQUÍ:
    //   - Traer calendario/scoreboard (ESPN, etc.)
    //   - Upsert a la tabla `games` (id, week, start_time, home_team, away_team, status...)
    //
    // Ejemplo orientativo (deja tu propia implementación):
    // const { inserted, updated } = await syncGamesFromESPN({ season, week });
    // -----------------------------
    const inserted = 0; // <-- reemplaza por tu resultado real
    const updated = 0;  // <-- reemplaza por tu resultado real

    // HEAD: responde 200 sin cuerpo
    if (method === 'HEAD') return new Response(null, { status: 200 });

    return j({ ok: true, season, week, inserted, updated }, 200);
  } catch (e) {
    // Nunca redirect: siempre JSON con 500 en fallos.
    return j({ ok: false, error: String(e?.message || e) }, 500);
  }
}
