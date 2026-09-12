
# Survivor 2026 – Guard + Crons (Hobby-friendly)

## 1) Preparar entorno en Vercel
- Importa el repo y agrega ENV VARS:
  - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_LEAGUE_NAME, VITE_TZ, VITE_SEASON=2026
  - SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_ROLE), SEASON=2026
  - TIMEZONE, SCORE_API_BASE
  - (opcional) RESEND_API_KEY, EMAIL_FROM, ODDS_API_BASE, ODDS_API_KEY
  - **CRON_TOKEN** = (elige un token seguro, ej. `luis-123-xyz`)

## 2) Cron diario en Vercel (permitido en Hobby)
- Settings → Functions → Cron Jobs:
  - `/api/syncGames` → `0 6 * * *`

## 3) Crons cada 5 min GRATIS con cron-job.org (simple)
- Crea cuenta en https://cron-job.org
- Crea estos jobs GET (ajusta `week` a la semana en curso, o automatízalo con tu propio script):
  1) `https://TU-PROYECTO.vercel.app/api/syncScores?token=CRON_TOKEN&week=N` → cada 5 minutos
  2) `https://TU-PROYECTO.vercel.app/api/control?action=settleWeek&week=N&token=CRON_TOKEN` → cada 5 minutos (liquida picks de juegos ya finalizados y descuenta vidas)
  3) `https://TU-PROYECTO.vercel.app/api/control?action=autopick&week=N&token=CRON_TOKEN` → cada 15-30 minutos (autopick del favorito más fuerte para quien no eligió)
  4) `https://TU-PROYECTO.vercel.app/api/sendReminders?token=CRON_TOKEN` → cada hora
- En “Advanced” configura timezone a `America/Mexico_City` (opcional).

## 4) Alternativa: Cloudflare Workers (cada 5 min en 1 solo lugar)
- Crea Worker con el siguiente handler:
```
export default {
  async scheduled(event, env, ctx) {
    const base = 'https://TU-PROYECTO.vercel.app';
    const token = env.CRON_TOKEN;
    const week = env.CURRENT_WEEK; // actualízalo semana a semana
    await Promise.all([
      fetch(`${base}/api/syncScores?token=${token}&week=${week}`),
      fetch(`${base}/api/control?action=settleWeek&week=${week}&token=${token}`),
      fetch(`${base}/api/control?action=autopick&week=${week}&token=${token}`),
      fetch(`${base}/api/sendReminders?token=${token}`)
    ]);
  }
};
```
- Variables del Worker: `CRON_TOKEN` = (igual que Vercel)
- Cron Trigger: `*/5 * * * *`

## 5) Probar rápido
- Abre en el navegador: `/api/syncScores?token=CRON_TOKEN` → debe responder ok.
- Revisa Logs en Vercel → Functions.

## Seguridad
- Los endpoints exigen el `CRON_TOKEN` por query `?token=` o header `x-cron-token`.
