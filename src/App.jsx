// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";

/* ========================= Utilidades ========================= */
function Countdown({ iso }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      const t = DateTime.fromISO(iso)
        .setZone(TZ)
        .diffNow(["days", "hours", "minutes", "seconds"])
        .toObject();
      const d = Math.max(0, Math.floor(t.days || 0));
      const h = Math.max(0, Math.floor(t.hours || 0));
      const m = Math.max(0, Math.floor(t.minutes || 0));
      const s = Math.max(0, Math.floor(t.seconds || 0));
      setLeft(`${d}d ${h}h ${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return <span className="tabular-nums">{left}</span>;
}

function downloadCSV(filename, rows) {
  const esc = (v) => (v == null ? "" : `"${String(v).replaceAll('"', '""')}"`);
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ========================= Sesión ========================= */
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

/* ========================= Login (email+password, magic, reset) ========================= */
function Login() {
  const [tab, setTab] = useState("password"); // 'password' | 'magic' | 'reset'
  const [busy, setBusy] = useState(false);

  // Magic
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // Password
  const [passEmail, setPassEmail] = useState("");
  const [passPwd, setPassPwd] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [displayName, setDisplayName] = useState("");

  // Reset
  const [resetEmail, setResetEmail] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [resetInfo, setResetInfo] = useState("");

  useEffect(() => {
    if ((window.location.hash || "").includes("type=recovery")) setTab("reset");
  }, []);

  const magic = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          import.meta.env.VITE_SITE_URL || window.location.origin,
      },
    });
    if (!error) setSent(true);
    else alert(error.message);
  };

  const passwordAuth = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        if (!displayName.trim()) throw new Error("Escribe tu nombre.");
        const { error } = await supabase.auth.signUp({
          email: passEmail,
          password: passPwd,
          options: {
            emailRedirectTo:
              import.meta.env.VITE_SITE_URL || window.location.origin,
            data: { display_name: displayName.trim() },
          },
        });
        if (error) throw error;
        localStorage.setItem("pendingDisplayName", displayName.trim());
        alert("Cuenta creada. Revisa tu correo para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: passEmail,
          password: passPwd,
        });
        if (error) throw error;
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: import.meta.env.VITE_SITE_URL || window.location.origin,
      });
      if (error) throw error;
      setResetInfo("Enlace enviado, revisa tu correo.");
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const applyNew = async (e) => {
    e.preventDefault();
    if (!newPwd || newPwd.length < 6) return alert("Mínimo 6 caracteres.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw error;
      setResetInfo("Contraseña actualizada.");
      setTimeout(() => setTab("password"), 1200);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-md space-y-4 p-6 border rounded-2xl bg-white">
        <h1 className="text-3xl font-extrabold tracking-tight text-center">
          {import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025"}
        </h1>

        <div className="flex gap-2 justify-center">
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
          <button
            className={`px-3 py-1 rounded border ${
              tab === "reset" ? "bg-black text-white" : ""
            }`}
            onClick={() => setTab("reset")}
          >
            Olvidé mi contraseña
          </button>
        </div>

        {tab === "password" && (
          <form onSubmit={passwordAuth} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm">
                {isSignup ? "Crear cuenta" : "Iniciar sesión"}
              </label>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setIsSignup(!isSignup)}
              >
                {isSignup
                  ? "¿Ya tienes cuenta? Inicia sesión"
                  : "¿No tienes cuenta? Regístrate"}
              </button>
            </div>
            {isSignup && (
              <input
                className="border w-full p-2 rounded-lg"
                placeholder="Tu nombre"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
            <input
              type="email"
              className="border w-full p-2 rounded-lg"
              placeholder="email"
              value={passEmail}
              onChange={(e) => setPassEmail(e.target.value)}
              required
            />
            <input
              type="password"
              className="border w-full p-2 rounded-lg"
              placeholder="contraseña"
              value={passPwd}
              onChange={(e) => setPassPwd(e.target.value)}
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
          <form onSubmit={magic} className="space-y-3">
            <input
              type="email"
              className="border w-full p-2 rounded-lg"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="bg-black text-white px-4 py-2 w-full rounded-lg">
              Enviar magic link
            </button>
            {sent && <p className="text-xs text-gray-600">Revisa tu correo.</p>}
          </form>
        )}

        {tab === "reset" &&
          (window.location.hash.includes("type=recovery") ? (
            <form onSubmit={applyNew} className="space-y-3">
              <input
                type="password"
                className="border w-full p-2 rounded-lg"
                placeholder="nueva contraseña"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
              />
              <button
                disabled={busy}
                className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60"
              >
                Guardar
              </button>
              {resetInfo && (
                <p className="text-xs text-emerald-700">{resetInfo}</p>
              )}
            </form>
          ) : (
            <form onSubmit={sendReset} className="space-y-3">
              <input
                type="email"
                className="border w-full p-2 rounded-lg"
                placeholder="tu email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
              />
              <button
                disabled={busy}
                className="bg-black text-white px-4 py-2 w-full rounded-lg disabled:opacity-60"
              >
                Enviar enlace
              </button>
              {resetInfo && (
                <p className="text-xs text-emerald-700">{resetInfo}</p>
              )}
            </form>
          ))}
      </div>
    </div>
  );
}

/* ========================= App (tabs) ========================= */
function AppRoot() {
  const session = useSession();
  const [view, setView] = useState("game"); // 'game' | 'rules'
  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full border-b bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          <button
            className={`text-sm px-3 py-1 rounded ${
              view === "game" ? "bg-black text-white" : "border"
            }`}
            onClick={() => setView("game")}
          >
            Partidos
          </button>
          <button
            className={`text-sm px-3 py-1 rounded ${
              view === "rules" ? "bg-black text-white" : "border"
            }`}
            onClick={() => setView("rules")}
          >
            Reglas
          </button>
        </div>
      </div>
      {view === "game" ? <AppAuthed /> : <Rules />}
    </div>
  );
}
export default AppRoot;

/* ========================= Helpers Logos ========================= */
/** Mapa de fallbacks por si no tienes /public/teams/ID.png */
const LOGO_FALLBACKS = {
  KC: "https://a.public-cdn.example/nfl/KC.png",
  DAL: "https://a.public-cdn.example/nfl/DAL.png",
  PHI: "https://a.public-cdn.example/nfl/PHI.png",
  SF: "https://a.public-cdn.example/nfl/SF.png",
  // … agrega los que uses. Si no existe, mostramos placeholder.
};

function TeamImg({ id, className, teamsMap }) {
  const [step, setStep] = useState(0);
  const t = teamsMap?.[id] || {};
  // orden: logo_url (DB) → /teams/ID.png → fallback CDN → placeholder
  const sources = [
    t.logo_url || "",
    `/teams/${id}.png`,
    LOGO_FALLBACKS[id] || "",
  ].filter(Boolean);

  const src = step < sources.length ? sources[step] : "";
  const onErr = () => setStep((s) => s + 1);
  const final =
    src ||
    `data:image/svg+xml;utf8,` +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%' height='100%' fill='%23eee'/><text x='50%' y='52%' font-size='16' text-anchor='middle' fill='%23999'>${id}</text></svg>`
      );
  return (
    <img
      src={final}
      onError={src ? onErr : undefined}
      alt={id}
      className={className}
    />
  );
}

/* ========================= AppAuthed ========================= */
function AppAuthed() {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);

  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);

  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);

  // Equipos (logos)
  const [teamsMap, setTeamsMap] = useState({});

  // Confirmación pick
  const [pendingPick, setPendingPick] = useState(null); // {game, teamId}

  // Filtros UX
  const [dayFilter, setDayFilter] = useState(localStorage.getItem("dayFilter") || "ALL");
  const [teamQuery, setTeamQuery] = useState(localStorage.getItem("teamQuery") || "");
  const searchRef = useRef(null);

  // Stats modal
  const [statsFor, setStatsFor] = useState(null);
  const [h2hFrom, setH2hFrom] = useState(2025); // por defecto 2025 (lo que seguro tienes)
  const [h2hTo, setH2hTo] = useState(2025);

  // Auto-refresh cuando hay juegos en vivo
  useEffect(() => {
    const anyLive = (games || []).some((g) => g.status === "in_progress");
    if (!anyLive) return;
    const id = setInterval(() => loadGames(week), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, week]);

  /* ---------- carga base ---------- */
  const loadTeams = async () => {
    const { data: ts } = await supabase.from("teams").select("*");
    const map = {};
    (ts || []).forEach((t) => {
      map[t.id] = t;
    });
    setTeamsMap(map);
  };

  const TeamMini = ({ id }) => (
    <span className="inline-flex items-center gap-1">
      <TeamImg id={id} teamsMap={teamsMap} className="h-5 w-5 rounded-full object-contain" />
      <span className="font-mono font-semibold">{id}</span>
    </span>
  );
  const TeamChip = ({ id }) => {
    const t = teamsMap[id] || {};
    return (
      <span className="inline-flex items-center gap-2">
        <TeamImg id={id} teamsMap={teamsMap} className="h-6 w-6 rounded-full object-contain" />
        <span className="font-medium">{t.name || id}</span>
      </span>
    );
  };

  const loadGames = async (w) => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("week", w)
      .order("start_time");
    setGames(gs || []);
    // odds
    const ids = (gs || []).map((g) => g.id);
    if (ids.length) {
      const { data } = await supabase
        .from("odds")
        .select("game_id, spread_home, spread_away, ml_home, ml_away, fetched_at")
        .in("game_id", ids)
        .order("fetched_at", { ascending: false });
      const by = {};
      for (const row of data || []) {
        if (!by[row.game_id]) by[row.game_id] = { last: row, prev: null };
        else if (!by[row.game_id].prev) by[row.game_id].prev = row;
      }
      setOddsPairs(by);
    } else setOddsPairs({});
  };

  const loadLeaguePicks = async (w) => {
    const { data: pks } = await supabase
      .from("picks")
      .select("id,user_id,team_id,result,auto_pick,updated_at,week")
      .eq("week", w);
    setLeaguePicks(pks || []);

    const ids = [...new Set((pks || []).map((x) => x.user_id))];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,display_name")
        .in("id", ids);
      const m = {};
      (profs || []).forEach((p) => (m[p.id] = p.display_name));
      setUserNames(m);
    } else setUserNames({});

    const { data: total } = await supabase.from("standings").select("user_id");
    const counts = {};
    (pks || []).forEach((x) => {
      if (x.team_id) counts[x.team_id] = (counts[x.team_id] || 0) + 1;
    });
    const list = Object.entries(counts)
      .map(([team_id, count]) => ({
        team_id,
        count,
        pct: total?.length ? Math.round((count * 100) / total.length) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    setPopularity(list);
  };

  const initAll = async () => {
    const session = (await supabase.auth.getSession()).data.session;
    const email = session.user.email;
    let { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();
    if (!prof) {
      const pending = localStorage.getItem("pendingDisplayName");
      await supabase
        .from("profiles")
        .insert({
          id: session.user.id,
          email,
          display_name: pending || email.split("@")[0],
        });
      localStorage.removeItem("pendingDisplayName");
      const r = await supabase
        .from("profiles")
        .select("*")
        .eq("email", email)
        .single();
      prof = r.data;
    }
    setMe(prof);

    await loadTeams();

    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);

    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);

    await loadGames(week);
    await loadLeaguePicks(week);
  };

  useEffect(() => {
    initAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);
  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);

  /* ---------- helpers ---------- */
  const myPickThisWeek = useMemo(
    () => (picks || []).find((p) => p.week === week),
    [picks, week]
  );

  const nextKickoffISO = useMemo(() => {
    const up = (games || []).find(
      (g) => DateTime.fromISO(g.start_time) > DateTime.now()
    );
    return up?.start_time || null;
  }, [games]);

  const showPickAlert = useMemo(() => {
    if (myPickThisWeek || !nextKickoffISO) return false;
    const mins = DateTime.fromISO(nextKickoffISO).diffNow("minutes").minutes;
    return mins <= 90 && mins > 0;
  }, [myPickThisWeek, nextKickoffISO]);

  const popPct = (teamId) =>
    popularity.find((p) => p.team_id === teamId)?.pct ?? 0;

  const canPick = (g, team) => {
    const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
    if (locked) return { ok: false, reason: "LOCK" };
    const session = supabase.auth.getUser().data.user;
    const used = (picks || []).some(
      (p) => p.team_id === team && p.user_id === session.id
    );
    if (used && !(myPickThisWeek && myPickThisWeek.team_id === team))
      return { ok: false, reason: "USED" };
    return { ok: true };
  };

  const confirmPick = (game, teamId) => {
    const c = canPick(game, teamId);
    if (!c.ok)
      return alert(
        c.reason === "LOCK" ? "Cerrado por kickoff" : "Ya usaste este equipo"
      );
    setPendingPick({ game, teamId });
  };

  const doPick = async () => {
    if (!pendingPick) return;
    const { game, teamId } = pendingPick;
    const session = (await supabase.auth.getSession()).data.session;
    const exists = (await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("week", week)).data?.[0];
    if (exists) {
      const { error } = await supabase
        .from("picks")
        .update({
          team_id: teamId,
          game_id: game.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", exists.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from("picks").insert({
        user_id: session.user.id,
        game_id: game.id,
        team_id: teamId,
        week,
        season: 2025,
      });
      if (error) return alert(error.message);
    }
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);
    setPendingPick(null);
  };

  /* ---------- Autopick ---------- */
  const SITE = import.meta.env.VITE_SITE_URL || "";
  const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";

  const autopickMe = async () => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const url = `${SITE}/api/autopickOne?week=${week}&user_id=${encodeURIComponent(
        session.user.id
      )}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick");
      alert("Listo: se aplicó autopick para ti.");
      const { data: pk } = await supabase
        .from("picks")
        .select("*")
        .eq("user_id", session.user.id);
      setPicks(pk || []);
      await loadLeaguePicks(week);
    } catch (e) {
      alert(e.message);
    }
  };

  const autopickLeague = async () => {
    try {
      const url = `${SITE}/api/autopick?week=${week}&token=${encodeURIComponent(
        CRON_TOKEN
      )}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick liga");
      alert("Autopick aplicado a la liga.");
      await loadLeaguePicks(week);
    } catch (e) {
      alert(e.message);
    }
  };

  /* ---------- UI blocks ---------- */
  const ScoreStrip = ({ g }) => {
    const status = g.status || "scheduled";
    const score = (
      <div className="flex items-center gap-4">
        <div className="text-xl font-bold">
          {g.away_team} <span className="tabular-nums">{g.away_score ?? 0}</span>
        </div>
        <div className="text-gray-300">—</div>
        <div className="text-xl font-bold">
          {g.home_team} <span className="tabular-nums">{g.home_score ?? 0}</span>
        </div>
      </div>
    );
    if (status === "final") {
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100">FINAL</span>
        </div>
      );
    }
    if (status === "in_progress") {
      return (
        <div className="flex items-center justify-between">
          {score}
          <div className="text-xs flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900">
              Q{g.period ?? ""} {g.clock ?? ""}
            </span>
            {g.possession && (
              <span className="px-2 py-0.5 rounded bg-gray-100">⬤ {g.possession}</span>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between">
        {score}
        <div className="text-xs flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-gray-100">
            Kickoff en <Countdown iso={g.start_time} />
          </span>
        </div>
      </div>
    );
  };

  const LiveQuickStats = ({ g }) => {
    if (g.status !== "in_progress") return null;
    const items = [];
    if (g.down) items.push(`${g.down} & ${g.distance ?? "-"}`);
    if (g.yard_line) items.push(`En ${g.yard_line}`);
    if (g.red_zone) items.push("Red Zone");
    if (items.length === 0) return null;
    return (
      <div className="mt-2 text-xs text-gray-700">
        {items.map((t, i) => (
          <span key={i} className="mr-2 px-2 py-0.5 rounded bg-gray-50 border">
            {t}
          </span>
        ))}
      </div>
    );
  };

  const TeamBox = ({ game, teamId }) => {
    const disabled = !canPick(game, teamId).ok;
    const selected =
      myPickThisWeek?.game_id === game.id && myPickThisWeek?.team_id === teamId;
    const pct = popPct(teamId);
    const { last } = oddsPairs[game.id] || {};
    const fav =
      last &&
      ((teamId === game.home_team &&
        ((last.spread_home ?? 0) < (last.spread_away ?? 0) ||
          (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
        (teamId === game.away_team &&
          ((last.spread_away ?? 0) < (last.spread_home ?? 0) ||
            (last.ml_away ?? 9999) < (last.ml_home ?? 9999))));
    return (
      <button
        onClick={() => confirmPick(game, teamId)}
        disabled={disabled}
        className={[
          "w-full text-left rounded-xl border transition px-4 py-3",
          selected ? "border-emerald-500 bg-emerald-50" : "border-gray-200 hover:bg-gray-50",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1">
            <TeamImg id={teamId} teamsMap={teamsMap} className="h-6 w-6 rounded-full object-contain" />
            <span className="font-mono font-semibold">{teamId}</span>
          </span>
          <div className="flex items-center gap-2">
            {fav && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900">
                Fav
              </span>
            )}
            {pct < 15 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                DIF
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  /* ---------- filtros ---------- */
  const gamesByDay = useMemo(() => {
    if (dayFilter === "ALL") return games;
    const map = { THU: 4, FRI: 5, SAT: 6, SUN: 7, MON: 1 };
    const want = map[dayFilter];
    return (games || []).filter(
      (g) => DateTime.fromISO(g.start_time).setZone(TZ).weekday === want
    );
  }, [games, dayFilter]);

  const gamesFiltered = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    if (!q) return gamesByDay;
    const match = (id) => {
      const t = teamsMap[id];
      return (
        id.toLowerCase().includes(q) ||
        (t?.name || "").toLowerCase().includes(q)
      );
    };
    return (gamesByDay || []).filter(
      (g) => match(g.away_team) || match(g.home_team)
    );
  }, [gamesByDay, teamQuery, teamsMap]);

  /* ========================= Stats Helpers ========================= */
  async function seasonRecord(teamId, season) {
    const { data: played } = await supabase
      .from("games")
      .select("*")
      .eq("season", season)
      .or(`home_team.eq.${teamId},away_team.eq.${teamId}`)
      .order("start_time");
    let w = 0,
      l = 0;
    let diffs = [];
    let last3 = [];
    for (const g of played || []) {
      if (g.status !== "final") continue;
      const isHome = g.home_team === teamId;
      const my = isHome ? g.home_score : g.away_score;
      const other = isHome ? g.away_score : g.home_score;
      const diff = (my ?? 0) - (other ?? 0);
      diffs.push(diff);
      if (my > other) w++;
      else if (other > my) l++;
      last3.push(
        `${isHome ? g.home_team : g.away_team} ${my}-${other} ${DateTime.fromISO(
          g.start_time
        )
          .setZone(TZ)
          .toFormat("dd LLL")}`
      );
      if (last3.length > 3) last3.shift();
    }
    const avg = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    return { w, l, last3, avgMargin: Number(avg.toFixed(1)) };
  }

  async function homeAwaySplits(teamId, season) {
    const { data: played } = await supabase
      .from("games")
      .select("*")
      .eq("season", season)
      .or(`home_team.eq.${teamId},away_team.eq.${teamId}`);
    let home = { w: 0, l: 0, diffs: [] },
      away = { w: 0, l: 0, diffs: [] };
    for (const g of played || []) {
      if (g.status !== "final") continue;
      const isHome = g.home_team === teamId;
      const my = isHome ? g.home_score : g.away_score;
      const other = isHome ? g.away_score : g.home_score;
      const diff = (my ?? 0) - (other ?? 0);
      if (isHome) {
        if (my > other) home.w++;
        else if (other > my) home.l++;
        home.diffs.push(diff);
      } else {
        if (my > other) away.w++;
        else if (other > my) away.l++;
        away.diffs.push(diff);
      }
    }
    const avg = (arr) =>
      arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : 0;
    return { home: { ...home, avgMargin: avg(home.diffs) }, away: { ...away, avgMargin: avg(away.diffs) } };
  }

  async function currentStreak(teamId, season) {
    const { data: played } = await supabase
      .from("games")
      .select("*")
      .eq("season", season)
      .or(`home_team.eq.${teamId},away_team.eq.${teamId}`)
      .order("start_time");
    let streak = 0,
      type = null;
    for (const g of (played || []).filter((x) => x.status === "final").reverse()) {
      const isHome = g.home_team === teamId;
      const my = isHome ? g.home_score : g.away_score;
      const other = isHome ? g.away_score : g.home_score;
      const win = (my ?? 0) > (other ?? 0);
      if (type === null) {
        type = win ? "W" : "L";
        streak = 1;
      } else if ((win && type === "W") || (!win && type === "L")) streak++;
      else break;
    }
    return { streak, streakType: type || "" };
  }

  async function headToHeadRange(teamA, teamB, fromSeason, toSeason) {
    const { data: gms } = await supabase
      .from("games")
      .select("*")
      .or(
        `and(home_team.eq.${teamA},away_team.eq.${teamB}),and(home_team.eq.${teamB},away_team.eq.${teamA})`
      )
      .gte("season", fromSeason)
      .lte("season", toSeason)
      .order("start_time", { ascending: false });

    let aW = 0,
      bW = 0,
      rows = [];
    for (const g of gms || []) {
      if (g.status !== "final") continue;
      const aIsHome = g.home_team === teamA;
      const aScore = aIsHome ? g.home_score : g.away_score;
      const bScore = aIsHome ? g.away_score : g.home_score;
      if ((aScore ?? 0) > (bScore ?? 0)) aW++;
      else if ((bScore ?? 0) > (aScore ?? 0)) bW++;
      rows.push(
        `${g.season} · ${DateTime.fromISO(g.start_time)
          .setZone(TZ)
          .toFormat("dd LLL")} · ${g.away_team} ${g.away_score}-${g.home_score} ${g.home_team}`
      );
    }
    return { aW, bW, rows };
  }

  const openStats = async (g) => {
    setStatsFor({ game: g, loading: true });
    const [homeRec, awayRec, homeSpl, awaySpl, homeSt, awaySt, h2h] = await Promise.all([
      seasonRecord(g.home_team, 2025),
      seasonRecord(g.away_team, 2025),
      homeAwaySplits(g.home_team, 2025),
      homeAwaySplits(g.away_team, 2025),
      currentStreak(g.home_team, 2025),
      currentStreak(g.away_team, 2025),
      headToHeadRange(g.home_team, g.away_team, h2hFrom, h2hTo),
    ]);
    setStatsFor({ game: g, homeRec, awayRec, homeSpl, awaySpl, homeSt, awaySt, h2h });
  };

  const reloadH2H = async () => {
    if (!statsFor) return;
    const h2h = await headToHeadRange(
      statsFor.game.home_team,
      statsFor.game.away_team,
      h2hFrom,
      h2hTo
    );
    setStatsFor({ ...statsFor, h2h });
  };

  /* ========================= Render ========================= */
  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {import.meta.env.VITE_LEAGUE_NAME || "2025"}
          </h1>
          <p className="text-sm text-gray-700">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
              {me?.lives}
            </span>
          </p>
        </div>
        <button
          className="text-sm underline"
          onClick={() => supabase.auth.signOut()}
        >
          Salir
        </button>
      </header>

      {/* Alertas */}
      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en{" "}
          <b>
            <Countdown iso={nextKickoffISO} />
          </b>
          .
        </div>
      )}

      {/* Toolbar */}
      <section className="mt-4 grid md:grid-cols-3 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Semana</label>
              <select
                className="border p-1 rounded-lg"
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

            <div className="flex gap-1 text-xs">
              {["ALL", "THU", "FRI", "SAT", "SUN", "MON"].map((d) => (
                <button
                  key={d}
                  className={`px-2 py-1 rounded border ${
                    dayFilter === d ? "bg-black text-white" : ""
                  }`}
                  onClick={() => setDayFilter(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <input
            id="searchTeam"
            ref={searchRef}
            className="mt-3 border w-full p-2 rounded-lg"
            placeholder="Buscar equipo..."
            value={teamQuery}
            onChange={(e) => setTeamQuery(e.target.value)}
          />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="text-xs px-3 py-1 rounded border"
              onClick={() =>
                downloadCSV("mis_picks.csv", [
                  ["week", "team_id", "result", "auto_pick", "updated_at"],
                  ...(picks || []).map((p) => [
                    p.week,
                    p.team_id,
                    p.result,
                    p.auto_pick,
                    p.updated_at,
                  ]),
                ])
              }
            >
              Exportar mis picks (CSV)
            </button>
            <button
              className="text-xs px-3 py-1 rounded border"
              onClick={() =>
                downloadCSV("standings.csv", [
                  ["player", "lives", "wins", "losses", "pushes", "margin_sum"],
                  ...(standings || []).map((s) => [
                    s.display_name,
                    s.lives,
                    s.wins,
                    s.losses,
                    s.pushes,
                    s.margin_sum,
                  ]),
                ])
              }
            >
              Exportar standings (CSV)
            </button>

            <button className="text-xs px-3 py-1 rounded border" onClick={autopickMe}>
              Autopick para mí
            </button>

            {me?.role === "admin" && (
              <button className="text-xs px-3 py-1 rounded border" onClick={autopickLeague}>
                Autopick (liga)
              </button>
            )}
          </div>
        </div>

        {/* Resumen */}
        <div className="md:col-span-2 p-4 border rounded-2xl bg-white">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            Elige tu pick en los partidos de abajo. Puedes filtrar por día o
            buscar por equipo. El lock es “rolling” por partido.
          </p>
        </div>
      </section>

      {/* Partidos */}
      <section className="mt-4 p-4 border rounded-2xl bg-white">
        <h2 className="font-semibold mb-3">Partidos W{week}</h2>
        <div className="space-y-3">
          {gamesFiltered.map((g) => {
            const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
            const local = DateTime.fromISO(g.start_time)
              .setZone(TZ)
              .toFormat("EEE dd LLL HH:mm");
            return (
              <div
                key={g.id}
                className={`p-4 border rounded-xl ${locked ? "opacity-60" : ""}`}
              >
                {/* Encabezado */}
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team} />
                    <span className="mx-1 text-gray-400">@</span>
                    <TeamChip id={g.home_team} />
                  </div>
                  <div className="text-xs text-gray-600">
                    Kickoff:{" "}
                    <span className="px-1.5 py-0.5 rounded bg-gray-100">
                      {local}
                    </span>{" "}
                    · Lock: <Countdown iso={g.start_time} />
                  </div>
                </div>

                {/* Score + estado + quick stats */}
                <div className="mt-3">
                  <ScoreStrip g={g} />
                  <LiveQuickStats g={g} />
                </div>

                {/* Boxes de selección */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TeamBox game={g} teamId={g.home_team} />
                  <TeamBox game={g} teamId={g.away_team} />
                </div>

                {/* Stats (modal launcher) */}
                <div className="mt-3">
                  <button
                    className="px-3 py-1 rounded border text-sm"
                    onClick={() => openStats(g)}
                  >
                    📊 Ver stats
                  </button>
                </div>
              </div>
            );
          })}
          {(!gamesFiltered || gamesFiltered.length === 0) && (
            <div className="text-sm text-gray-500">
              No hay partidos para este filtro o búsqueda.
            </div>
          )}
        </div>
      </section>

      {/* Liga: picks + popularidad */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Picks de la liga (W{week})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="text-left text-gray-500">
                  <th>Jugador</th>
                  <th>Equipo</th>
                  <th>Resultado</th>
                  <th>Auto</th>
                  <th>Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {(leaguePicks || []).length > 0 ? (
                  leaguePicks
                    .slice()
                    .sort((a, b) =>
                      (userNames[a.user_id] || "").localeCompare(
                        userNames[b.user_id] || ""
                      )
                    )
                    .map((p, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="py-1.5">
                          {userNames[p.user_id] || p.user_id.slice(0, 6)}
                        </td>
                        <td>
                          <TeamMini id={p.team_id} />
                        </td>
                        <td>
                          <span
                            className={
                              p.result === "win"
                                ? "text-emerald-700 font-semibold"
                                : p.result === "loss"
                                ? "text-red-600 font-semibold"
                                : p.result === "push"
                                ? "text-gray-600"
                                : "text-gray-500"
                            }
                          >
                            {p.result || "-"}
                          </span>
                        </td>
                        <td>{p.auto_pick ? "Sí" : "No"}</td>
                        <td className="text-xs text-gray-500">
                          {p.updated_at
                            ? DateTime.fromISO(p.updated_at)
                                .setZone(TZ)
                                .toFormat("dd LLL HH:mm")
                            : "-"}
                        </td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={5}>
                      Aún no hay picks esta semana.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Popularidad de equipos</h2>
          <p className="text-xs text-gray-600">
            Porcentaje de jugadores que pickearon ese equipo.
          </p>
          <div className="mt-3 space-y-2">
            {(popularity || []).length > 0 ? (
              popularity.map((row) => (
                <div key={row.team_id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TeamMini id={row.team_id} />{" "}
                      <span className="text-gray-500">({row.count})</span>
                    </div>
                    <span className="text-gray-700">{row.pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded mt-1">
                    <div
                      className="h-2 rounded bg-black"
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500">
                No hay picks registrados esta semana.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Standings + Historial */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Tabla de supervivientes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="text-left text-gray-500">
                  <th>Jugador</th>
                  <th>Vidas</th>
                  <th>W</th>
                  <th>L</th>
                  <th>Push</th>
                  <th>Margen</th>
                </tr>
              </thead>
              <tbody>
                {(standings || []).map((s) => (
                  <tr key={s.user_id} className="border-t">
                    <td className="py-1.5">{s.display_name}</td>
                    <td>{s.lives}</td>
                    <td className="text-emerald-700 font-medium">{s.wins}</td>
                    <td className="text-red-600 font-medium">{s.losses}</td>
                    <td className="text-gray-600">{s.pushes}</td>
                    <td>{s.margin_sum}</td>
                  </tr>
                ))}
                {(!standings || standings.length === 0) && (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={6}>
                      Aún no hay standings.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Historial de tus picks</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="text-left text-gray-500">
                  <th>W</th>
                  <th>Equipo</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {(picks || [])
                  .sort((a, b) => a.week - b.week)
                  .map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-1.5">{p.week}</td>
                      <td>
                        <TeamMini id={p.team_id} />
                      </td>
                      <td>
                        <span
                          className={
                            p.result === "win"
                              ? "text-emerald-700 font-semibold"
                              : p.result === "loss"
                              ? "text-red-600 font-semibold"
                              : p.result === "push"
                              ? "text-gray-600"
                              : "text-gray-500"
                          }
                        >
                          {p.result || "pending"}
                        </span>
                      </td>
                    </tr>
                  ))}
                {(!picks || picks.length === 0) && (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={3}>
                      Aún no has hecho picks.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Modal confirmación */}
      {pendingPick && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 border">
            <h3 className="font-semibold text-lg">Confirmar pick</h3>
            <p className="mt-2 text-sm">
              ¿Confirmas tu pick de <b>{pendingPick.teamId}</b> en W{week}?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                className="px-4 py-2 rounded border"
                onClick={() => setPendingPick(null)}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 rounded bg-black text-white"
                onClick={doPick}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Stats */}
      {statsFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="w-full max-w-3xl bg-white rounded-2xl p-5 border">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">📊 Stats del juego</h3>
              <button className="text-sm underline" onClick={() => setStatsFor(null)}>
                Cerrar
              </button>
            </div>

            {/* aviso si pides 2021 pero no tienes datos */}
            {(h2hFrom < 2025 || h2hTo < 2025) &&
              (!statsFor.h2h || (statsFor.h2h.rows || []).length === 0) && (
                <div className="mt-2 p-2 text-xs rounded bg-amber-50 text-amber-900 border">
                  Para ver H2H de 2021–2024 necesitas tener esos partidos en tu tabla <code>games</code>.
                </div>
              )}

            <div className="mt-2 flex items-center gap-2 text-sm flex-wrap">
              <span>H2H temporadas:</span>
              <select
                className="border p-1 rounded"
                value={h2hFrom}
                onChange={(e) => setH2hFrom(Number(e.target.value))}
              >
                {Array.from({ length: 10 }, (_, k) => 2025 - k).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <span>a</span>
              <select
                className="border p-1 rounded"
                value={h2hTo}
                onChange={(e) => setH2hTo(Number(e.target.value))}
              >
                {Array.from({ length: 10 }, (_, k) => 2025 - k).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button className="px-2 py-1 border rounded" onClick={reloadH2H}>
                Actualizar
              </button>
            </div>

            <div className="mt-3 grid md:grid-cols-2 gap-4">
              <TeamStatsCard
                side="Visitante"
                team={statsFor.game.away_team}
                rec={statsFor.awayRec}
                spl={statsFor.awaySpl}
                st={statsFor.awaySt}
              />
              <TeamStatsCard
                side="Local"
                team={statsFor.game.home_team}
                rec={statsFor.homeRec}
                spl={statsFor.homeSpl}
                st={statsFor.homeSt}
              />
            </div>

            <div className="mt-4 p-3 border rounded-xl">
              <h4 className="font-semibold text-sm">
                Head-to-Head {h2hFrom}–{h2hTo}
              </h4>
              {!statsFor.h2h ? (
                <div className="text-xs text-gray-500 mt-1">Cargando…</div>
              ) : (
                <div className="text-xs mt-1">
                  <div className="mb-1">
                    Balance: {statsFor.game.home_team} {statsFor.h2h.aW} –{" "}
                    {statsFor.game.away_team} {statsFor.h2h.bW}
                  </div>
                  {(statsFor.h2h.rows || []).length
                    ? (statsFor.h2h.rows || []).map((r, i) => <div key={i}>• {r}</div>)
                    : "No hay historial disponible en ese rango."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Aviso si falta pick y está cerca el kickoff */}
      {!myPickThisWeek && nextKickoffISO && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKickoffISO} />
        </div>
      )}
    </div>
  );
}

/* ========================= Auxiliares UI ========================= */
function TeamStatsCard({ side, team, rec, spl, st }) {
  return (
    <div className="p-3 border rounded-xl">
      <div className="text-sm font-semibold">
        {side}: {team}
      </div>
      {!rec ? (
        <div className="text-xs text-gray-500 mt-2">Cargando…</div>
      ) : (
        <>
          <div className="mt-1 text-sm">
            Record 2025: <b>{rec.w}-{rec.l}</b>
          </div>
          <div className="mt-1 text-sm">
            Margen promedio: <b>{rec.avgMargin > 0 ? `+${rec.avgMargin}` : rec.avgMargin}</b>
          </div>
          {spl && (
            <div className="mt-2 text-xs text-gray-700">
              <div className="mb-1 font-medium">Splits:</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 border rounded">
                  <div className="font-medium">Local</div>
                  <div>W-L: {spl.home.w}-{spl.home.l}</div>
                  <div>Margen: {spl.home.avgMargin > 0 ? `+${spl.home.avgMargin}` : spl.home.avgMargin}</div>
                </div>
                <div className="p-2 border rounded">
                  <div className="font-medium">Visitante</div>
                  <div>W-L: {spl.away.w}-{spl.away.l}</div>
                  <div>Margen: {spl.away.avgMargin > 0 ? `+${spl.away.avgMargin}` : spl.away.avgMargin}</div>
                </div>
              </div>
            </div>
          )}
          {st && (
            <div className="mt-1 text-sm">
              Racha: <b>{st.streak || 0}{st.streak ? st.streakType : ""}</b>
            </div>
          )}
          <div className="mt-2 text-xs text-gray-600">
            Últimos 3: <br />
            {(rec.last3 || []).map((x, i) => (
              <div key={i}>• {x}</div>
            ))}
            {(!rec.last3 || rec.last3.length === 0) && "—"}
          </div>
        </>
      )}
    </div>
  );
}









