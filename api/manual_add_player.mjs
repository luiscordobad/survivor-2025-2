// api/manual_add_player.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const SEASON       = 2025;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Busca usuario por email paginando listUsers (v2 no tiene getUserByEmail)
async function findUserByEmail(email) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const u = data?.users?.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    if (u) return u;
    const hasMore = data?.users?.length >= 1000 && page < (data?.lastPage || page + 1);
    if (!hasMore) return null;
    page += 1;
  }
}

export default async function handler(req, res) {
  const out = { steps: [] };
  try {
    const displayName = req.query.name   || 'pablito';
    const email       = req.query.email  || 'pablito+manual@maiztros.local';
    const pwd         = req.query.pwd    || 'Temp1234!';

    // Ejemplo de la conversación:
    const w1_game_id  = '401772829'; // W1 CIN ganó
    const w2_game_id  = '401772833'; // W2 NO perdió

    // ===== 0) ENV =====
    if (!SUPABASE_URL || !SERVICE_KEY) {
      out.steps.push({ step:'env', ok:false, error:'Faltan SUPABASE_URL o SERVICE_KEY' });
      return res.status(500).json({ ok:false, ...out });
    }
    out.steps.push({ step:'env', ok:true });

    // ===== 1) Buscar/crear usuario Auth =====
    let authUserId = null;
    try {
      let user = await findUserByEmail(email);
      if (!user) {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password: pwd,
          email_confirm: true,
          user_metadata: { display_name: displayName }
        });
        if (error) {
          // si ya existe, lo buscamos otra vez por si la carrera fue por duplicado
          if ((error.status || error.code) && String(error.status) === '422') {
            user = await findUserByEmail(email);
          }
          if (!user) throw error;
        } else {
          user = data?.user || null;
        }
      }
      if (!user) throw new Error('No se pudo obtener/crear el usuario');
      authUserId = user.id;
      out.steps.push({ step:'auth', ok:true, user_id: authUserId });
    } catch (e) {
      out.steps.push({ step:'auth', ok:false, error: e.message });
      return res.status(500).json({ ok:false, ...out });
    }

    // ===== 2) Upsert perfil =====
    try {
      const { error } = await admin
        .from('profiles')
        .upsert(
          { id: authUserId, email, display_name: displayName, lives: 2 },
          { onConflict: 'id' }
        );
      if (error) throw error;
      out.steps.push({ step:'profiles.upsert', ok:true });
    } catch (e) {
      out.steps.push({ step:'profiles.upsert', ok:false, error:e.message });
      return res.status(500).json({ ok:false, ...out });
    }

    // ===== 3) (opcional) intentar bypass del lock si tienes la RPC set_config =====
    try {
      await admin.rpc('set_config', { parameter: 'app.bypass_lock', value: '1', is_local: true });
      out.steps.push({ step:'bypass_lock', ok:true, via:'rpc(set_config)' });
    } catch {
      out.steps.push({ step:'bypass_lock', ok:false, note:'RPC set_config no existe (ignorado)' });
    }

    // ===== 4) W1: CIN win =====
    try {
      const { error } = await admin
        .from('picks')
        .upsert({
          user_id: authUserId,
          season: SEASON,
          week: 1,
          game_id: w1_game_id,   // TEXT en tu schema
          team_id: 'CIN',
          result: 'win',         // enum pick_result
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,season,week' });
      if (error) throw error;
      out.steps.push({ step:'picks.upsert.W1', ok:true });
    } catch (e) {
      out.steps.push({ step:'picks.upsert.W1', ok:false, error:e.message });
      return res.status(500).json({ ok:false, ...out });
    }

    // ===== 5) W2: NO loss =====
    try {
      const { error } = await admin
        .from('picks')
        .upsert({
          user_id: authUserId,
          season: SEASON,
          week: 2,
          game_id: w2_game_id,
          team_id: 'NO',
          result: 'loss',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,season,week' });
      if (error) throw error;
      out.steps.push({ step:'picks.upsert.W2', ok:true });
    } catch (e) {
      out.steps.push({ step:'picks.upsert.W2', ok:false, error:e.message });
      return res.status(500).json({ ok:false, ...out });
    }

    // ===== 6) Ajustar vidas (2 iniciales - 1 derrota = 1) =====
    try {
      const { error } = await admin
        .from('profiles')
        .update({ lives: 1 })
        .eq('id', authUserId);
      if (error) throw error;
      out.steps.push({ step:'profiles.update.lives', ok:true, lives:1 });
    } catch (e) {
      out.steps.push({ step:'profiles.update.lives', ok:false, error:e.message });
      return res.status(500).json({ ok:false, ...out });
    }

    return res.json({ ok:true, user_id: authUserId, ...out });
  } catch (e) {
    out.steps.push({ step:'catch-all', ok:false, error:e.message });
    return res.status(500).json({ ok:false, ...out });
  }
}
