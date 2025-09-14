// api/manual_add_player.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;

const SEASON = 2025;

// ⚠️ SOLO SERVICE KEY (no la publiques en el cliente)
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

export default async function handler(req, res) {
  try {
    // Puedes pasar por query o hardcodear aquí:
    const displayName = req.query.name   || 'pablito';
    const email       = req.query.email  || 'pablito+manual@maiztros.local';
    const pwd         = req.query.pwd    || 'Temp1234!'; // cualquiera, no se usará
    // Picks solicitados:
    const w1_game_id  = '401772829'; // CIN (Bengals), W1
    const w2_game_id  = '401772833'; // NO (Saints), W2

    // 1) Crea (o consigue) el usuario en Auth
    //    Si ya existe por email, no lo duplica.
    let authUserId;
    {
      // Busca por email
      const { data: list, error: listErr } = await admin.auth.admin.listUsers();
      if (listErr) throw listErr;
      const found = list.users.find(u => u.email?.toLowerCase() === email.toLowerCase());

      if (found) {
        authUserId = found.id;
      } else {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password: pwd,
          email_confirm: true,
          user_metadata: { display_name: displayName }
        });
        if (error) throw error;
        authUserId = data.user.id;
      }
    }

    // 2) Upsert del perfil (id = authUserId por la FK)
    {
      const { error } = await admin
        .from('profiles')
        .upsert(
          { id: authUserId, email, display_name: displayName, lives: 2 },
          { onConflict: 'id' }
        );
      if (error) throw error;
    }

    // 3) Bypass del lock sólo durante los upserts de picks
    await admin.rpc('set_config', { parameter: 'app.bypass_lock', value: '1', is_local: true })
      .catch(() => {/* si no tienes esa RPC, ignorar; o crea: create function set_config(...) returns text language sql as $$ select set_config($1,$2,$3) $$ */});

    // 4) Upsert picks:
    // W1: CIN (win)
    {
      const { error } = await admin
        .from('picks')
        .upsert({
          user_id: authUserId,
          season: SEASON,
          week: 1,
          game_id: w1_game_id,      // TEXT en tu schema
          team_id: 'CIN',
          result: 'win',            // tipo enum pick_result
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,season,week' });
      if (error) throw error;
    }

    // W2: NO (loss)
    {
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
    }

    // 5) Ajusta vidas por la derrota en W2 (vidas = 1)
    {
      const { error } = await admin
        .from('profiles')
        .update({ lives: 1 })
        .eq('id', authUserId);
      if (error) throw error;
    }

    // 6) (Opcional) refrescar standings si usas MATERIALIZED VIEW
    // await admin.rpc('refresh_standings').catch(()=>{});

    return res.json({ ok: true, user_id: authUserId, message: 'Usuario + picks creados/actualizados' });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}
