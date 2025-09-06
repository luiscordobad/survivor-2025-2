import { createClient } from '@supabase/supabase-js';

// Usamos SERVICE_ROLE en server; si no existe, cae a la anon (solo para cliente)
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || process.env.VITE_SUPABASE_ANON_KEY;

export const supa = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

