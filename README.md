
# Survivor 2026 – Guard + Crons (Hobby-friendly)

## 1) Preparar entorno en Vercel
- Importa el repo y agrega ENV VARS:
  - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_LEAGUE_NAME, VITE_TZ, VITE_SEASON=2026
  - SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_ROLE), SEASON=2026
  - **ODDS_API_KEY** (the-odds-api.com, tiene plan gratuito ~500 requests/mes) — fuente de partidos/marcadores/líneas
  - (opcional) SEASON_WEEK1_START (fecha ISO del martes previo al primer jueves de temporada; ya trae default para 2025/2026)
  - (opcional) RESEND_API_KEY, EMAIL_FROM — para que los recordatorios de pick lleguen por correo de verdad (si faltan, solo se loguean en la consola de Vercel)
  - (opcional, notificaciones push) **VAPID_PUBLIC_KEY**, **VAPID_PRIVATE_KEY**, **VITE_VAPID_PUBLIC_KEY** (mismo valor que VAPID_PUBLIC_KEY) — ver sección 6
  - **CRON_TOKEN** = (elige un token seguro, ej. `luis-123-xyz`)

### Al arrancar una temporada nueva (2027, 2028, ...)
Además de `VITE_SEASON`/`SEASON` en Vercel, actualiza también la fila que usa
el rollover automático de perfiles (reinicia vidas a 2 y limpia eliminación
la primera vez que cada jugador entra en la temporada nueva):
```sql
update public.app_config set value = '2027' where key = 'season';
```
Se dejó en una tabla aparte (en vez de confiar en un valor que mande el
navegador) porque `profiles` ya no permite que el cliente escriba
`season`/`lives`/`eliminated_at` directamente -- ver la nota de seguridad
más abajo.

### Por qué ya no se usa ESPN
`site.api.espn.com` bloquea por IP a los servidores de Vercel/AWS (confirmado:
la misma URL responde bien desde un navegador normal, pero 403 desde la
función serverless). `syncGames.mjs` y `syncScores.mjs` ahora usan The Odds
API. Esa fuente no tiene estadísticas de equipo, líderes de partido, lesiones
ni "últimos 5 juegos" — esas secciones del modal de detalles se quitaron.

### Partidos que no aparecían (ej. Seattle vs Patriots)
`syncGames.mjs` armaba el calendario únicamente a partir de `/odds`, que solo
devuelve partidos con línea de apuesta (mercado h2h) ya publicada. Las casas
de apuestas no postean líneas de todos los partidos con semanas de
anticipación, así que partidos reales del calendario simplemente no
existían todavía en la tabla `games` -- no había forma de pickearlos. Se
agregó `/events` (calendario completo de la temporada, no gasta cuota de la
API) como fuente de verdad de qué partidos existen; `/odds` sigue llenando
spread/moneyline solo para los que ya tienen mercado abierto.

## 2) Cron diario en Vercel (permitido en Hobby)
- Ya configurado en `vercel.json` (Cron Jobs de Vercel, no necesitas tocar nada):
  - `/api/syncGames?token=CRON_TOKEN` → `0 6 * * *` (descubre calendario nuevo; usa `/odds`, el endpoint de The Odds API que más cuota consume, por eso una vez al día basta)

## 3) Cron cada 30 min con GitHub Actions (recomendado, ya está en el repo)
`.github/workflows/cron.yml` corre `syncScores` + `settleWeek` + `autopick`
cada 30 minutos, y `sendReminders` ~cada hora, sin necesidad de crear cuenta
en ningún servicio externo. `settleWeek`/`autopick` ya no necesitan `week=N`:
si no se los pasas, `settleWeek` liquida toda la temporada y `autopick` usa
la semana actual calculada por fecha.

Solo falta que agregues 2 secrets del repo (Settings → Secrets and
variables → Actions → New repository secret):
- `SITE_URL` = `https://survivor-2025-maiztros.vercel.app` (sin `/` al final)
- `CRON_TOKEN` = el mismo valor que ya tienes en Vercel

En cuanto los agregues el workflow ya corre solo. Para probarlo antes de
esperar 30 min: pestaña **Actions** del repo → "Survivor cron jobs" → **Run
workflow**.

⚠️ **Cuota de The Odds API**: el plan gratis es de ~500 requests/mes.
`syncScores` internamente NO gasta cuota si no hay ningún juego en ventana de
"posiblemente en vivo" (5h antes / 30min después de un kickoff), así que
correrlo cada 30 min todo el día es seguro para el free tier.

## 4) Alternativas (si prefieres no usar GitHub Actions)
- **cron-job.org**: crea cuenta gratis y pega estas URLs como jobs GET:
  1) `https://TU-PROYECTO.vercel.app/api/syncScores?token=CRON_TOKEN` → cada 15-30 min
  2) `https://TU-PROYECTO.vercel.app/api/control?action=settleWeek&token=CRON_TOKEN` → cada 15-30 min
  3) `https://TU-PROYECTO.vercel.app/api/control?action=autopick&token=CRON_TOKEN` → cada 30-60 min
  4) `https://TU-PROYECTO.vercel.app/api/sendReminders?token=CRON_TOKEN` → cada hora
- **Cloudflare Workers**:
```
export default {
  async scheduled(event, env, ctx) {
    const base = 'https://TU-PROYECTO.vercel.app';
    const token = env.CRON_TOKEN;
    await Promise.all([
      fetch(`${base}/api/syncScores?token=${token}`),
      fetch(`${base}/api/control?action=settleWeek&token=${token}`),
      fetch(`${base}/api/control?action=autopick&token=${token}`),
      fetch(`${base}/api/sendReminders?token=${token}`)
    ]);
  }
};
```
  Cron Trigger: `*/30 * * * *`

## 5) Probar rápido
- Abre en el navegador: `/api/syncGames?token=CRON_TOKEN` → debe responder `{"ok":true,...}` con partidos cargados.
- Luego: `/api/syncScores?token=CRON_TOKEN` → debe responder ok.
- Revisa Logs en Vercel → Functions.

## 6) Notificaciones push (opcional)
Cada jugador puede activarlas desde Ajustes → "Activar notificaciones"; se
mandan junto con el recordatorio de correo (`api/sendReminders.mjs`, mismo
cron de la sección 3) cuando falta poco para que cierre su pick.

- Genera un par de llaves VAPID una sola vez (no se vuelve a repetir salvo
  que quieras rotarlas):
  ```
  npx web-push generate-vapid-keys
  ```
- Agrega en Vercel:
  - `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` (la privada nunca debe ir al
    cliente ni a git)
  - `VITE_VAPID_PUBLIC_KEY` = el mismo valor que `VAPID_PUBLIC_KEY` (este sí
    va al bundle del navegador, es la mitad pública)
  - (opcional) `VAPID_SUBJECT` = `mailto:tu-correo@ejemplo.com`
- Sin `VITE_VAPID_PUBLIC_KEY` la tarjeta de Ajustes se queda en "tu
  navegador no soporta notificaciones push"; sin `VAPID_PRIVATE_KEY`,
  `sendReminders` simplemente no manda push (el correo sigue funcionando
  igual).

## Seguridad
- Los endpoints exigen el `CRON_TOKEN` por query `?token=` o header `x-cron-token`.
- `profiles`: RLS solo deja que cada quien edite su propia fila (`auth.uid() = id`), pero eso no distingue columnas -- por defecto Postgres deja editar cualquier columna de esa fila. Se restringió el `GRANT UPDATE` de `authenticated` a solo `display_name` y `notify_email`; `lives`, `is_admin`, `eliminated_at` y `season` solo los puede tocar el service role (endpoint admin en `api/control.mjs`) o la función `rollover_my_season()` (que no confía en un valor mandado por el navegador, lee la temporada objetivo de `public.app_config`). Antes de este cambio cualquier jugador podía, desde la consola del navegador, hacer `supabase.from('profiles').update({is_admin:true})` sobre su propia fila.
