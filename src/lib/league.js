import { supabase } from './supabaseClient';

// Opción A: si QUIERES fijar el league_id manualmente, pega aquí el UUID
// export const FIXED_LEAGUE_ID = 'PEGA_AQUI_EL_ID_QUE_SALIO_DEL INSERT';

// Opción B: autodetectar la liga por season (recomendado si solo tienes una liga 2025)
export async function ensureLeagueMembership(userId) {
  // 1) obtener la liga 2025
  const { data: leagues, error: e1 } = await supabase
    .from('leagues')
    .select('id')
    .eq('season', 2025)
    .limit(1);

  if (e1) {
    console.error('Error leyendo leagues:', e1);
    return;
  }
  if (!leagues || leagues.length === 0) {
    console.warn('No hay liga 2025 creada. Crea “Maiztros Survivor 2025” primero.');
    return;
  }

  const leagueId = leagues[0].id;

  // 2) insertar relación si no existe
  const { error: e2 } = await supabase
    .from('league_members')
    .upsert({ league_id: leagueId, user_id: userId }, { onConflict: 'league_id, user_id' });

  if (e2) {
    console.error('Error agregando a league_members:', e2);
  }
}
