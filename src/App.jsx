import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

/* =========================================================
   SESIÓN (igual que antes, súper simple)
========================================================= */
function useSession() {
  const [session, setSession] = useState(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

/* =========================================================
   LOGIN minimalist (Email + Password + Magic Link)
   (puedes dejar tu login actual si prefieres)
========================================================= */
function Login() {
  const [tab, setTab] = useState("password"); // password | magic | reset
  const [busy, setBusy] = useState(false);

  // Password
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [isSignup, setIsSignup] = useState(false);

  // Magic
  const [magicEmail, setMagicEmail] = useState("");
  const [sent, setSent] = useState(false);

  const doPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password: pwd,
          options: {
            emailRedirectTo:
              import.meta.env.VITE_SITE_URL || window.location.origin,
          },
        });
        if (error) throw error;
        alert("Cuenta creada. Revisa tu correo para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: pwd,
        });
        if (error) throw error;
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doMagic = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email: magicEmail,
      options: {
        emailRedirectTo:
          import.meta.env.VITE_SITE_URL || window.location.origin,
      },
    });
    if (!error) setSent(true);
    else alert(error.message);
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-white border rounded-2xl p-6 space-y-4">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">
          {import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025"}
        </h1>

        <div className="flex gap-2 justify-center text-sm">
          <button
            className={`px-3 py-1 rounded border ${
              tab === "password" ? "bg-black text-white" : ""
            }`}
            onClick={() => setTab("password")}
          >
            Email + Password
          </button>
          <button
            className={`px-3 py-1 rounded border ${
              tab === "magic" ? "bg-black text-white" : ""
            }`}
            onClick={() => setTab("magic")}
          >
            Magic link
          </button>
        </div>

        {tab === "password" && (
          <form onSubmit={doPassword} className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">{isSignup ? "Crear" : "Iniciar"} cuenta</span>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setIsSignup((v) => !v)}
              >
                {isSignup ? "¿Ya tienes cuenta? Entrar" : "¿No tienes cuenta? Crear"}
              </button>
            </div>
            <input
              type="email"
              className="border w-full p-2 rounded-lg"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              className="border w-full p-2 rounded-lg"
              placeholder="contraseña"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              required
            />
            <button
              disabled={busy}
              className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60"
            >
              {isSignup ? "Crear cuenta" : "Entrar"}
            </button>
          </form>
        )}

        {tab === "magic" && (
          <form onSubmit={doMagic} className="space-y-3">
            <input
              type="email"
              className="border w-full p-2 rounded-lg"
              placeholder="tu@email.com"
              value={magicEmail}
              onChange={(e) => setMagicEmail(e.target.value)}
              required
            />
            <button className="bg-black text-white px-4 py-2 w-full rounded-lg">
              Enviar magic link
            </button>
            {sent && (
              <p className="text-xs text-gray-600">Enviado. Revisa tu correo.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   TABS responsive (Partidos / Asistente / Noticias / Reglas)
   - Mobile-first
   - Sticky arriba
========================================================= */
const TABS = [
  { key: "games", label: "Partidos" },
  { key: "assistant", label: "Asistente" },
  { key: "news", label: "Noticias" },
  { key: "rules", label: "Reglas" },
];

function StickyTabs({ view, setView }) {
  return (
    <div className="sticky top-0 z-50 bg-white border-b safe-bottom">
      <div className="max-w-5xl mx-auto px-3 py-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`shrink-0 px-3 py-1.5 rounded-full border text-sm ${
                view === t.key ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => setView(t.key)}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto" />
          <button
            className="text-sm underline"
            onClick={() => supabase.auth.signOut()}
          >
            Salir
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   CONTENIDOS DE TABS (muy ligeros y mobile-first)
   - GamesTab = tu AppAuthed (se renderiza tal cual)
   - AssistantTab: hooks mínimos a tus endpoints
   - NewsTab: lista simple mobile
========================================================= */

// 1) PARTIDOS
function GamesTab({ session, GamesComponent }) {
  // GamesComponent es tu AppAuthed actual (con todo lo que ya hicimos)
  return <GamesComponent session={session} />;
}

// 2) ASISTENTE (autopick rápido)
function AssistantTab() {
  const [week, setWeek] = useState(1);
  const SITE = import.meta.env.VITE_SITE_URL || "";
  const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";

  const runAutoMe = async () => {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const url = `${SITE}/api/autopickOne?week=${week}&user_id=${encodeURIComponent(
        user.id
      )}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick");
      alert("Autopick aplicado para ti.");
    } catch (e) {
      alert(e.message);
    }
  };

  const runAutoLeague = async () => {
    try {
      const url = `${SITE}/api/autopick?week=${week}&token=${encodeURIComponent(
        CRON_TOKEN
      )}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick liga");
      alert("Autopick aplicado a la liga.");
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-3 md:p-6">
      <div className="p-4 border rounded-2xl bg-white space-y-3">
        <h2 className="text-lg font-semibold">Asistente</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Semana</label>
          <select
            className="border rounded px-2 py-1"
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                W{w}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button className="border rounded px-3 py-2" onClick={runAutoMe}>
            Autopick para mí (favorito más fuerte disponible)
          </button>
          <button className="border rounded px-3 py-2" onClick={runAutoLeague}>
            Autopick para la liga (jugadores sin pick)
          </button>
        </div>

        <p className="text-xs text-gray-600">
          El autopick usa la línea más reciente (spread/moneyline) para elegir el
          favorito más fuerte entre los equipos que no hayas usado.
        </p>
      </div>
    </div>
  );
}

// 3) NOTICIAS (simple, mobile-first; puedes conectar a tu endpoint /api/news)
function NewsTab() {
  const [team, setTeam] = useState("");
  const [items, setItems] = useState([]);

  const fetchNews = async () => {
    try {
      // Si ya tienes /api/news?team= abre aquí:
      const base = import.meta.env.VITE_SITE_URL || "";
      const url = `${base}/api/news${team ? `?team=${encodeURIComponent(team)}` : ""}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error de noticias");
      setItems(j.items || []);
    } catch (e) {
      alert(e.message);
    }
  };

  useEffect(() => {
    fetchNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-3 md:p-6">
      <div className="p-4 border rounded-2xl bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Noticias</h2>
          <div className="ml-auto flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Filtro por equipo (ej. DAL)"
              value={team}
              onChange={(e) => setTeam(e.target.value.toUpperCase())}
            />
            <button className="border rounded px-3 py-1.5 text-sm" onClick={fetchNews}>
              Buscar
            </button>
          </div>
        </div>

        <ul className="mt-3 divide-y">
          {items.length === 0 && (
            <li className="py-4 text-sm text-gray-500">
              Sin noticias por ahora. Intenta con un equipo (ej. KC, DAL, BUF…).
            </li>
          )}
          {items.map((n, i) => (
            <li key={i} className="py-3">
              <a
                href={n.link}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                {n.title}
              </a>
              <div className="text-xs text-gray-500 mt-1">{n.source} · {n.time}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* =========================================================
   APP ROOT — Tabs + Contenido
   >> Importa tu componente de “Partidos” y pásalo a GamesTab
========================================================= */
export default function App() {
  const session = useSession();
  const [view, setView] = useState("games");

  if (!session) return <Login />;

  // IMPORTANTE:
  // 1) Si tu pantalla de Partidos está en este mismo archivo como AppAuthed:
  //    cambia GamesComponent={AppAuthed}
  // 2) Si está en otro archivo, impórtalo y pásalo aquí.
  // eslint-disable-next-line no-undef
  const GamesComponent = AppAuthed; // <- usa tu componente actual de "Partidos"

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <StickyTabs view={view} setView={setView} />

      {view === "games" && <GamesTab session={session} GamesComponent={GamesComponent} />}
      {view === "assistant" && <AssistantTab />}
      {view === "news" && <NewsTab />}
      {view === "rules" && <div className="max-w-5xl mx-auto p-3 md:p-6"><Rules /></div>}
    </div>
  );
}
