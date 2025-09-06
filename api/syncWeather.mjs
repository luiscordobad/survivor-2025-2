// /api/syncWeather.mjs
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const week = Number(url.searchParams.get('week') || '1');

    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ ok:false, error:'UNAUTHORIZED' });
    }
    if (!process.env.OPENWEATHER_KEY) {
      return res.status(400).json({ ok:false, error:'Missing OPENWEATHER_KEY' });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    const { data: games } = await supabase
      .from('games')
      .select('id, week, venue_city')
      .eq('week', week);

    if (!games?.length) return res.json({ ok:true, inserted:0, msg:'No games' });

    let inserted = 0;
    for (const g of games) {
      const city = (g.venue_city || '').trim();
      if (!city) continue;

      const u = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${process.env.OPENWEATHER_KEY}&units=metric`;
      const resp = await fetch(u);
      if (!resp.ok) continue;
      const w = await resp.json();

      const payload = {
        game_id: g.id,
        temp_c: w.main?.temp ?? null,
        wind_kph: w.wind?.speed != null ? Math.round(w.wind.speed * 3.6) : null, // m/s -> km/h
        precip_mm: (w.rain?.['1h'] ?? w.snow?.['1h']) ?? 0,
        condition: w.weather?.[0]?.main || null,
        icon: w.weather?.[0]?.icon || null
      };
      const { error } = await supabase.from('weather').insert(payload);
      if (!error) inserted++;
    }
    return res.json({ ok:true, inserted });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:e.message });
  }
}
