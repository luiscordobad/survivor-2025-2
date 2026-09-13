
# Survivor 2026 – Guard + Crons (Hobby-friendly)

## 1) Preparar entorno en Vercel
- Importa el repo y agrega ENV VARS:
  - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_LEAGUE_NAME, VITE_TZ, VITE_SEASON=2026
  - SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_ROLE), SEASON=2026
  - **ODDS_API_KEY** (the-odds-api.com, tiene plan gratuito ~500 requests/mes) — fuente de partidos/marcadores/líneas
  - (opcional) SEASON_WEEK1_START (fecha ISO del martes previo al primer jueves de temporada; ya trae default para 2025/2026)
  - (opcional) RESEND_API_KEY, EMAIL_FROM
  - **CRON_TOKEN** = (elige un token seguro, ej. `luis-123-xyz`)

### Por qué ya no se usa ESPN
`site.api.espn.com` bloquea por IP a los servidores de Vercel/AWS (confirmado:
la misma URL responde bien desde un navegador normal, pero 403 desde la
función serverless). `syncGames.mjs` y `syncScores.mjs` ahora usan The Odds
API. Esa fuente no tiene estadísticas de equipo, líderes de partido, lesiones
ni "últimos 5 juegos" — esas secciones del modal de detalles se quitaron.

## 2) Cron diario en Vercel (permitido en Hobby)
- Settings → Functions → Cron Jobs:
  - `/api/syncGames?token=CRON_TOKEN` → `0 6 * * *` (descubre calendario nuevo; usa el endpoint `/odds` de The Odds API, el que más cuota consume, por eso una vez al día basta)

## 3) Crons cada 5-15 min GRATIS con cron-job.org
⚠️ **Cuidado con la cuota de The Odds API**: el plan gratis es de ~500
requests/mes. `syncScores` es barato (usa solo `/scores`, sin markets), pero
correr cada 5 minutos igual son ~8,600 requests/mes — se acaba la cuota en un
par de días. Ajusta la frecuencia a lo que tu plan aguante, o corre `syncScores`
solo durante las ventanas de partidos (jueves/domingo/lunes en vivo) en vez de
24/7.
- Crea cuenta en https://cron-job.org
- Crea estos jobs GET (`settleWeek`/`autopick` sí necesitan `week=N`, actualízalo semana a semana):
  1) `https://TU-PROYECTO.vercel.app/api/syncScores?token=CRON_TOKEN` → cada 15-30 minutos durante juegos en vivo
  2) `https://TU-PROYECTO.vercel.app/api/control?action=settleWeek&week=N&token=CRON_TOKEN` → cada 15-30 minutos (liquida picks de juegos ya finalizados y descuenta vidas)
  3) `https://TU-PROYECTO.vercel.app/api/control?action=autopick&week=N&token=CRON_TOKEN` → cada 30-60 minutos (autopick del favorito más fuerte para quien no eligió)
  4) `https://TU-PROYECTO.vercel.app/api/sendReminders?token=CRON_TOKEN` → cada hora
- En “Advanced” configura timezone a `America/Mexico_City` (opcional).

## 4) Alternativa: Cloudflare Workers (1 solo lugar)
- Crea Worker con el siguiente handler:
```
export default {
  async scheduled(event, env, ctx) {
    const base = 'https://TU-PROYECTO.vercel.app';
    const token = env.CRON_TOKEN;
    const week = env.CURRENT_WEEK; // actualízalo semana a semana
    await Promise.all([
      fetch(`${base}/api/syncScores?token=${token}`),
      fetch(`${base}/api/control?action=settleWeek&week=${week}&token=${token}`),
      fetch(`${base}/api/control?action=autopick&week=${week}&token=${token}`),
      fetch(`${base}/api/sendReminders?token=${token}`)
    ]);
  }
};
```
- Variables del Worker: `CRON_TOKEN` = (igual que Vercel)
- Cron Trigger: `*/15 * * * *` (ver nota de cuota arriba)

## 5) Probar rápido
- Abre en el navegador: `/api/syncGames?token=CRON_TOKEN` → debe responder `{"ok":true,...}` con partidos cargados.
- Luego: `/api/syncScores?token=CRON_TOKEN` → debe responder ok.
- Revisa Logs en Vercel → Functions.

## Seguridad
- Los endpoints exigen el `CRON_TOKEN` por query `?token=` o header `x-cron-token`.
