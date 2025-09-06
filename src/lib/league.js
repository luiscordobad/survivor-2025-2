// src/lib/league.js
import { supabase } from './supabaseClient';

// Se asegura de que el usuario esté en la liga 2025
export async function ensureLeagueMembership(userId) {
  // Buscar la liga 2025
  const { data: leagues, error: e1 } = await supabase
    .from('leagues')
    .select('id')
    .eq('season', 2025)
    .eq('name', 'Maiztros Survivor 2025') // aseguramos que sea esa liga
    .limit(1);

  if (e1) {
    console.error('Error leyendo leagues:', e1);
    return;
  }
  if (!leagues || leagues.length === 0) {
    console.warn('⚠️ No hay liga creada para 2025. Crea “Maiztros Survivor 2025” primero.');
    return;
  }

  const leagueId = leagues[0].id;

  // Insertar relación si no existe
  const { error: e2 } = await supabase
    .from('league_members')
    .upsert({ league_id: leagueId, user_id: userId }, { onConflict: 'league_id, user_id' });

  if (e2) {
    console.error('Error agregando a league_members:', e2);
  } else {
    console.log(`✅ Usuario ${userId} agregado a la liga ${leagueId}`);
  }
}

