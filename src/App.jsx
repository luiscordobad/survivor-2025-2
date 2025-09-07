import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";

/* ========================= Utilidades ========================= */
const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";

function Countdown({ iso }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    if (!iso) return;
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
  return <span>{left}</span>;
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

/* ========================= Login ========================= */
function Login() {
  const [tab, setTab] = useState("password"); // 'password' | 'magic'
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

/* ========================= Tabs (sticky, mobile-first) ========================= */
const TABS = [
  { key: "games", label: "Partidos" },
  { key: "assistant", label: "Asistente" },
  { key: "news", label: "Noticias" },
  { key: "rules", label: "Reglas" },
];

function StickyTabs({ view, setView }) {
  return (
    <div className="sticky top-0 z-50 bg-white border-b safe-bottom">
      <div className="max-w-6xl mx-auto px-3 py-2">
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

/* ========================= Reglas (inline) ========================= */
function Rules() {
  return (
    <div className="p-4 border rounded-2xl bg-white">
      <h2 className="text-lg font-semibold">Reglas</h2>
      <ul className="list-disc pl-5 text-sm mt-2 space-y-1">
        <li>2 vidas por jugador. No hay rebuy.</li>
        <li>No puedes repetir equipo en toda la temporada.</li>
        <li>Ganas si tu equipo gana; empates = sobreviven.</li>
        <li>Si un partido se pospone/cancela, se reabre elección.</li>
        <li>Lock rolling por partido (kickoff).</li>
        <li>Auto-pick: favorito más fuerte disponible.</li>
        <li>Temporada NFL 2025 completa + playoffs.</li>
        <li>Zona horaria: Ciudad de México.</li>
        <li>Si quedan varios vivos al final: tie-break por margen acumulado.</li>
      </ul>
    </div>
  );
}

/* ========================= Partidos (Games) ========================= */
function Games() {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(
    () => Number(localStorage.getItem("week")) || 1
  );

  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);
  const [standings, setStandings] = useState([]);

  const [pendingPick, setPendingPick] = useState(null);
  const [teamQuery, setTeamQuery] = useState(
    localStorage.getItem("teamQuery") || ""
  );
  const [dayFilter, setDayFilter] = useState(
    localStorage.getItem("dayFilter") || "ALL"
  );
  const searchRef = useRef(null);

  /* --- helpers UI --- */
  const TeamMini = ({ id }) => {
    const t = teamsMap[id] || {};
    const src = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img
          src={src}
          alt={id}
          onError={(e) => (e.currentTarget.style.display = "none")}
          className="h-5 w-5 rounded-full object-contain"
        />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };
  const TeamChip = ({ id }) => {
    const t = teamsMap[id] || {};
    const src = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-2">
        <img
          src={src}
          alt={id}
          onError={(e) => (e.currentTarget.style.display = "none")}
          className="h-6 w-6 rounded-full object-contain"
        />
        <span className="font-medium">{t.name || id}</span>
      </span>
    );
  };

  /* --- carga base --- */
  const initAll = async () => {
    // perfil
    const user = (await supabase.auth.getUser()).data.user;
    const email = user?.email;
    let { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();
    if (!prof) {
      await supabase
        .from("profiles")
        .insert({
          id: user.id,
          email,
          display_name: email.split("@")[0],
        });
      prof = (
        await supabase.from("profiles").select("*").eq("email", email).single()
      ).data;
    }
    setMe(prof);

    // equipos
    const { data: ts } = await supabase.from("teams").select("*");
    const map = {};
    (ts || []).forEach((t) => (map[t.id] = t));
    setTeamsMap(map);

    // picks míos
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", user.id);
    setPicks(pk || []);

    // standings (si tienes vista 'standings')
    const { data: st } = await supabase.from("standings").select("*");
    setStandings(st || []);
  };

  const loadGames = async (w) => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("week", w)
      .order("start_time");
    setGames(gs || []);

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

    const { data: totalPlayers } = await supabase.from("profiles").select("id");
    const counts = {};
    (pks || []).forEach((x) => {
      if (x.team_id) counts[x.team_id] = (counts[x.team_id] || 0) + 1;
    });
    const list = Object.entries(counts)
      .map(([team_id, count]) => ({
        team_id,
        count,
        pct: totalPlayers?.length
          ? Math.round((count * 100) / totalPlayers.length)
          : 0,
      }))
      .sort((a, b) => b.count - a.count);
    setPopularity(list);
  };

  useEffect(() => {
    initAll();
  }, []);

  useEffect(() => {
    loadGames(week);
    loadLeaguePicks(week);
    localStorage.setItem("week", String(week));
  }, [week]);

  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);
  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);

  // polling autosuave si hay en vivo
  useEffect(() => {
    const anyLive = (games || []).some((g) => g.status === "in_progress");
    if (!anyLive) return;
    const id = setInterval(() => loadGames(week), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, week]);

  // realtime picks
  useEffect(() => {
    const channel = supabase
      .channel("picks-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "picks" },
        async () => {
          await loadLeaguePicks(week);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [week]);

  /* --- helpers lógico --- */
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
    const used = (picks || []).some((p) => p.team_id === team);
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
    const user = (await supabase.auth.getUser()).data.user;

    if (myPickThisWeek) {
      const { error } = await supabase
        .from("picks")
        .update({
          team_id: teamId,
          game_id: game.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", myPickThisWeek.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from("picks").insert({
        user_id: user.id,
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
      .eq("user_id", user.id);
    setPicks(pk || []);
    setPendingPick(null);
  };

  /* --- UI blocks --- */
  const ScoreStrip = ({ g }) => {
    const status = g.status || "scheduled";
    const score = (
      <div className="flex items-center gap-4">
        <div className="text-xl font-bold">
          {g.away_team}{" "}
          <span className="tabular-nums">{g.away_score ?? 0}</span>
        </div>
        <div className="text-gray-300">—</div>
        <div className="text-xl font-bold">
          {g.home_team}{" "}
          <span className="tabular-nums">{g.home_score ?? 0}</span>
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
              <span className="px-2 py-0.5 rounded bg-gray-100">
                ⬤ {g.possession}
              </span>
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
          <TeamMini id={teamId} />
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
        <div className="mt-1 text-xs text-gray-600">
          Liga: <b>{pct}%</b>
        </div>
      </button>
    );
  };

  /* --- filtros --- */
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
      return id.toLowerCase().includes(q) || (t?.name || "").toLowerCase().includes(q);
    };
    return (gamesByDay || []).filter(
      (g) => match(g.away_team) || match(g.home_team)
    );
  }, [gamesByDay, teamQuery, teamsMap]);

  /* --- render --- */
  return (
    <div className="max-w-6xl mx-auto p-3 md:p-6">
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
      </header>

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
            ref={searchRef}
            className="mt-3 border w-full p-2 rounded-lg"
            placeholder="Buscar equipo (siglas o nombre)…"
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
                downloadCSV("picks_semana.csv", [
                  ["jugador", "team_id", "result", "auto", "updated_at"],
                  ...(leaguePicks || []).map((p) => [
                    userNames[p.user_id] || p.user_id.slice(0, 6),
                    p.team_id,
                    p.result,
                    p.auto_pick,
                    p.updated_at,
                  ]),
                ])
              }
            >
              Exportar liga (CSV)
            </button>
          </div>
        </div>

        <div className="md:col-span-2 p-4 border rounded-2xl bg-white">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            Elige tu pick en los partidos de abajo. Filtro por día y búsqueda por
            equipo. Lock por partido (rolling).
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

                {/* Score */}
                <div className="mt-3">
                  <ScoreStrip g={g} />
                </div>

                {/* Boxes */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TeamBox game={g} teamId={g.home_team} />
                  <TeamBox game={g} teamId={g.away_team} />
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
                    .map((p) => (
                      <tr key={p.id} className="border-t">
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
                {(standings || []).length > 0 ? (
                  standings.map((s) => (
                    <tr key={s.user_id} className="border-t">
                      <td className="py-1.5">{s.display_name}</td>
                      <td>{s.lives}</td>
                      <td className="text-emerald-700 font-medium">{s.wins}</td>
                      <td className="text-red-600 font-medium">{s.losses}</td>
                      <td className="text-gray-600">{s.pushes}</td>
                      <td>{s.margin_sum}</td>
                    </tr>
                  ))
                ) : (
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
                  .slice()
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

      {/* Aviso si falta pick y está cerca el kickoff */}
      {!myPickThisWeek && nextKickoffISO && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKickoffISO} />
        </div>
      )}
    </div>
  );
}

/* ========================= Asistente ========================= */
function Assistant() {
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
    <div className="max-w-6xl mx-auto p-3 md:p-6">
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
            Autopick para mí
          </button>
          <button className="border rounded px-3 py-2" onClick={runAutoLeague}>
            Autopick para la liga
          </button>
        </div>

        <p className="text-xs text-gray-600">
          El autopick usa el favorito más fuerte disponible con la última línea
          (spread/moneyline).
        </p>
      </div>
    </div>
  );
}

/* ========================= Noticias ========================= */
function News() {
  const [team, setTeam] = useState("");
  const [items, setItems] = useState([]);

  const fetchNews = async () => {
    try {
      const base = import.meta.env.VITE_SITE_URL || "";
      const url = `${base}/api/news${team ? `?team=${encodeURIComponent(team)}` : ""}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error de noticias");
      setItems(j.items || []);
    } catch (e) {
      setItems([]);
      console.warn(e.message);
    }
  };

  useEffect(() => {
    fetchNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-3 md:p-6">
      <div className="p-4 border rounded-2xl bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Noticias</h2>
          <div className="ml-auto flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Equipo (ej. DAL, KC, BUF)"
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
              Sin noticias por ahora. Prueba con un equipo (KC, DAL, BUF).
            </li>
          )}
          {items.map((n, i) => (
            <li key={i} className="py-3">
              <a href={n.link} target="_blank" rel="noreferrer" className="font-medium underline">
                {n.title}
              </a>
              <div className="text-xs text-gray-500 mt-1">
                {n.source} · {n.time}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ========================= App Root ========================= */
export default function App() {
  const session = useSession();
  const [view, setView] = useState("games");

  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <StickyTabs view={view} setView={setView} />
      {view === "games" && <Games />}
      {view === "assistant" && <Assistant />}
      {view === "news" && <News />}
      {view === "rules" && (
        <div className="max-w-6xl mx-auto p-3 md:p-6">
          <Rules />
        </div>
      )}
    </div>
  );
}
