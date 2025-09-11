import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("❌ Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el entorno");
}

export const supabase = (url && key)
  ? createClient(url, key)
  : {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
        signInWithPassword: async () => { throw new Error("Supabase no configurado"); },
        signInWithOtp: async () => { throw new Error("Supabase no configurado"); },
        signUp: async () => { throw new Error("Supabase no configurado"); },
        signOut: async () => {}
      },
      from: () => ({
        select: async () => ({ data: [], error: null }),
        insert: async () => { throw new Error("Supabase no configurado"); },
        update: async () => { throw new Error("Supabase no configurado"); },
        eq: () => ({ select: async () => ({ data: [], error: null }) }),
        in: () => ({ select: async () => ({ data: [], error: null }) }),
        order: () => ({ select: async () => ({ data: [], error: null }) }),
      })
    };

