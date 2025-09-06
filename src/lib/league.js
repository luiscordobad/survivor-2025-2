// src/lib/league.js
import { supabase } from './supabaseClient';

/**
 * Asegura que el usuario esté inscrito en la liga 2025.
 * - Crea fila en profiles si no existe (frontend ya lo hace por si acaso)
 * - Asegura fila en standings (liga) si no existe
 */
export async function ensureLeagueMembership(userId) {
  if (!userId) return;
  // standings mínima: user_id, display_name, lives, wins, losses, pushes, margin_sum
  const { data: st } = await supabase
    .from('standings')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle?.() ?? { data: null };

  if (!st) {
    // intenta tomar display_name de profile
    const { data: prof } = await supabase
      .from('profiles').select('display_name').eq('id', userId).single();

    await supabase.from('standings').insert([{
      user_id: userId,
      display_name: prof?.display_name || 'Jugador',
      lives: 2, wins: 0, losses: 0, pushes: 0, margin_sum: 0
    }]);
  }
}


