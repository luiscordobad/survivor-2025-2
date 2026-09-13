// src/lib/league.js
import { supabase } from './supabaseClient';

/**
 * Devuelve el perfil del usuario, creándolo si es la primera vez que entra,
 * y haciendo el "rollover" de temporada si sigue marcado con una temporada
 * anterior (reinicia vidas a las configuradas en app_config.starting_lives
 * y limpia eliminated_at). Así el arranque de cada temporada nueva (2027,
 * 2028, ...) es automático y no requiere tocar la base de datos a mano.
 *
 * Todo esto corre del lado del servidor (función Postgres SECURITY DEFINER
 * ensure_my_profile()) en vez de un INSERT/UPDATE armado en el navegador:
 * profiles_insert_self / profiles_update_self solo restringen la FILA
 * (auth.uid() = id), no qué columnas ni qué valores -- un cliente podía
 * mandar lives/season/email lo que quisiera para su propia fila.
 */
export async function ensureProfile() {
  const { data, error } = await supabase.rpc('ensure_my_profile');
  if (error) throw error;
  return data;
}
