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
    const { data: updated, error: updErr } = await supabase
      .from('profiles')
      .update({ season: SEASON, lives: 2, eliminated_at: null })
      .eq('id', userId)
      .select('*')
      .single();
    if (updErr) throw updErr;
    return updated;
  }

  return prof;
}
