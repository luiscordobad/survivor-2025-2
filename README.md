
# Survivor 2025 – Guard + Crons (Hobby-friendly)

## 1) Preparar entorno en Vercel
- Importa el repo y agrega ENV VARS:
  - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_LEAGUE_NAME, VITE_TZ
  - TIMEZONE, SCORE_API_BASE
  - (opcional) RESEND_API_KEY, EMAIL_FROM, ODDS_API_BASE, ODDS_API_KEY
  - **CRON_TOKEN** = (elige un token seguro, ej. `luis-123-xyz`)

## 2) Cron diario en Vercel (permitido en Hobby)
- Settings → Functions → Cron Jobs:
  - `/api/syncGames` → `0 6 * * *`

## 3) Crons cada 5 min GRATIS con cron-job.org (simple)
- Crea cuenta en https://cron-job.org
- Crea tres jobs GET:
  1) `https://TU-PROYECTO.vercel.app/api/syncScores?token=CRON_TOKEN` → cada 5 minutos
  2) `https://TU-PROYECTO.vercel.app/api/autopick?token=CRON_TOKEN` → cada 5 minutos
  3) `https://TU-PROYECTO.vercel.app/api/sendReminders?token=CRON_TOKEN` → cada hora
- En “Advanced” configura timezone a `America/Mexico_City` (opcional).

## 4) Alternativa: Cloudflare Workers (cada 5 min en 1 solo lugar)
- Crea Worker con el siguiente handler:
```
export default {
  async scheduled(event, env, ctx) {
    const base = 'https://TU-PROYECTO.vercel.app';
    const token = env.CRON_TOKEN;
    await Promise.all([
      fetch(`${base}/api/syncScores?token=${token}`),
      fetch(`${base}/api/autopick?token=${token}`),
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
