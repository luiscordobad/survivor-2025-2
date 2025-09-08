// api/syncScores.mjs
export const config = { runtime: 'edge' };

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
  const method = req.method;

  if (method !== 'GET' && method !== 'HEAD') {
    return j({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const token = url.searchParams.get('token') || '';
  if (!token || token !== (process.env.CRON_TOKEN || '')) {
    return j({ ok: false, error: 'bad_token' }, 401);
  }

  const season = url.searchParams.get('season') || '2025';
  const week = url.searchParams.get('week') ? Number(url.searchParams.get('week')) : null;

  try {
    // -----------------------------
    // TU LÓGICA REAL AQUÍ:
    //   - Leer juegos `in_progress` o del `week`/`season`
    //   - Actualizar `home_score`, `away_score`, `status`, `period`, `clock`, etc.
    //
    // const { updated, finals } = await updateScoresFromFeed({ season, week });
    // -----------------------------
    const updated = 0; // <-- reemplaza
    const finals = 0;  // <-- reemplaza

    if (method === 'HEAD') return new Response(null, { status: 200 });

    return j({ ok: true, season, week, updated, finals }, 200);
  } catch (e) {
    return j({ ok: false, error: String(e?.message || e) }, 500);
  }
}
