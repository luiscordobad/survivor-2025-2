// api/_push.mjs
// Helper compartido de Web Push, usado por sendReminders.mjs (recordatorio
// de pick) y control.mjs (resultado win/loss/push/eliminado al liquidar la
// semana). Centralizado para no repetir la config de VAPID en dos archivos.
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.VITE_SUPABASE_SERVICE_KEY;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const pushConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushConfigured) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:no-reply@survivor.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

/** Manda push a todas las suscripciones del usuario; borra las que ya expiraron (404/410). */
export async function sendPush(userId, payload) {
  if (!pushConfigured || !userId) return 0;
  const { data: subs } = await sb.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sb.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  }
  return sent;
}
