// src/lib/league.js
import { supabase } from './supabaseClient';

const SEASON = Number(import.meta.env.VITE_SEASON || 2026);

/**
 * Devuelve el perfil del usuario, creándolo si es la primera vez que entra,
 * y haciendo el "rollover" de temporada si sigue marcado con una temporada
 * anterior (reinicia vidas a 2 y limpia eliminated_at). Así el arranque de
 * cada temporada nueva (2027, 2028, ...) es automático y no requiere tocar
 * la base de datos a mano otra vez.
 */
export async function ensureProfile(userId, email) {
  if (!userId) return null;

  let { data: prof, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;

  if (!prof) {
    const insertRow = {
      id: userId,
      email,
      display_name: email.split('@')[0],
      lives: 2,
      season: SEASON,
    };
    const { data: created, error: insErr } = await supabase
      .from('profiles')
      .insert(insertRow)
      .select('*')
      .single();
    if (insErr) throw insErr;
    return created;
  }

  if ((prof.season ?? SEASON) < SEASON) {
    // El cliente ya no tiene permiso de UPDATE sobre season/lives/eliminated_at
    // (ver migración lock_down_profiles_self_update_and_add_rollover_rpc):
    // cualquiera podía re-escribir esas columnas en su propia fila vía RLS
    // porque profiles_update_self solo restringe la fila, no la columna. El
    // rollover ahora lo hace esta función de Postgres (SECURITY DEFINER),
    // que decide la temporada objetivo desde app_config en vez de confiar en
    // un valor que mande el navegador.
    const { data: updated, error: updErr } = await supabase.rpc('rollover_my_season');
    if (updErr) throw updErr;
    return updated;
  }

  return prof;
}
