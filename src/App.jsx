// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabase } from "./lib/supabaseClient";
import Rules from "./Rules";

/* ========================= Config ========================= */
const TZ = import.meta.env.VITE_TZ || "America/Mexico_City";
const SITE = import.meta.env.VITE_SITE_URL || "";
const CRON_TOKEN = import.meta.env.VITE_CRON_TOKEN || "";
const LEAGUE = import.meta.env.VITE_LEAGUE_NAME || "Survivor 2025";
const SEASON = 2025;

/* ========================= Utils ========================= */
const clsx = (...xs) => xs.filter(Boolean).join(" ");

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

function winProbFromSpread(spreadForTeam) {
  if (spreadForTeam == null) return null;
  // Aproximación logística: spread negativo favorece al equipo
  const k = 0.23;
  const p = 1 / (1 + Math.exp(-k * (-spreadForTeam)));
  return Math.round(p * 100);
}

/* ========================= Sesión/Login ========================= */
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

function Login() {
  const [tab, setTab] = useState("password"); // 'password' | 'magic'
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [signup, setSignup] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const doPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (signup) {
        const { error } = await supabase.auth.signUp({
          email,
          password: pwd,
          options: { emailRedirectTo: SITE || window.location.origin },
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
      email,
      options: { emailRedirectTo: SITE || window.location.origin },
    });
    if (!error) setSent(true);
    else alert(error.message);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-md border rounded-2xl p-6 bg-white">
        <h1 className="text-2xl font-extrabold text-center">{LEAGUE}</h1>
        <div className="mt-4 flex gap-2 justify-center">
          <button
            className={clsx(
              "px-3 py-1 rounded border",
              tab === "password" && "bg-black text-white"
            )}
            onClick={() => setTab("password")}
          >
            Email + Password
          </button>
          <button
            className={clsx(
              "px-3 py-1 rounded border",
              tab === "magic" && "bg-black text-white"
            )}
            onClick={() => setTab("magic")}
          >
            Magic link
          </button>
        </div>

        {tab === "password" && (
          <form onSubmit={doPassword} className="mt-4 space-y-3">
            <div className="text-sm flex justify-between">
              <span>{signup ? "Crear cuenta" : "Iniciar sesión"}</span>
              <button
                type="button"
                className="underline"
                onClick={() => setSignup(!signup)}
              >
                {signup
                  ? "¿Ya tienes cuenta? Inicia"
                  : "¿No tienes cuenta? Regístrate"}
              </button>
            </div>
            <input
              className="border p-2 w-full rounded-lg"
              placeholder="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="border p-2 w-full rounded-lg"
              placeholder="contraseña"
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              required
            />
            <button
              className="bg-black text-white w-full py-2 rounded-lg disabled:opacity-60"
              disabled={busy}
            >
              {signup ? "Crear cuenta" : "Entrar"}
            </button>
          </form>
        )}

        {tab === "magic" && (
          <form onSubmit={doMagic} className="mt-4 space-y-3">
            <input
              className="border p-2 w-full rounded-lg"
              placeholder="tu@email.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="bg-black text-white w-full py-2 rounded-lg">
              Enviar magic link
            </button>
            {sent && <p className="text-xs text-gray-500">Revisa tu correo.</p>}
          </form>
        )}
      </div>
    </div>
  );
}

/* ========================= Root con tabs ========================= */
export default function AppRoot() {
  const session = useSession();
  const [view, setView] = useState("game"); // game | assistant | news | rules

  // PWA: registra service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  }, []);

  if (!session) return <Login />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full border-b bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2">
          {["game", "assistant", "news", "rules"].map((t) => (
            <button
              key={t}
              className={clsx(
                "text-sm px-3 py-1 rounded",
                view === t ? "bg-black text-white" : "border"
              )}
              onClick={() => setView(t)}
            >
              {t === "game"
                ? "Partidos"
                : t === "assistant"
                ? "Asistente"
                : t === "news"
                ? "Noticias"
                : "Reglas"}
            </button>
          ))}
        </div>
      </div>
      {view === "game" ? (
        <AppAuthed session={session} />
      ) : view === "assistant" ? (
        <AssistantTab session={session} />
      ) : view === "news" ? (
        <NewsTab />
      ) : (
        <Rules />
      )}
    </div>
  );
}

/* ========================= PARTIDOS (AppAuthed) ========================= */
function AppAuthed({ session }) {
  const [me, setMe] = useState(null);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);

  const [teamsMap, setTeamsMap] = useState({});
  const [games, setGames] = useState([]);
  const [oddsPairs, setOddsPairs] = useState({});
  const [picks, setPicks] = useState([]);
  const [standings, setStandings] = useState([]);

  const [leaguePicks, setLeaguePicks] = useState([]);
  const [userNames, setUserNames] = useState({});
  const [popularity, setPopularity] = useState([]);

  const [teamRecords, setTeamRecords] = useState({});
  const [divStandings, setDivStandings] = useState({});
  const [confStandings, setConfStandings] = useState({ AFC: [], NFC: [] });

  const [pendingPick, setPendingPick] = useState(null); // {game, teamId}
  const [showStats, setShowStats] = useState(null); // {game}
  const [h2h, setH2h] = useState(null);
  const [news, setNews] = useState([]);

  const [dayFilter, setDayFilter] = useState(
    localStorage.getItem("dayFilter") || "ALL"
  );
  const [teamQuery, setTeamQuery] = useState(
    localStorage.getItem("teamQuery") || ""
  );
  const searchRef = useRef(null);

  // Auto-refresh si hay juegos en vivo
  useEffect(() => {
    const anyLive = (games || []).some((g) => g.status === "in_progress");
    if (!anyLive) return;
    const id = setInterval(() => loadGames(week), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, week]);

  /* ---------- Cargas base ---------- */
  const loadTeams = async () => {
    const { data: ts } = await supabase.from("teams").select("*");
    const map = {};
    (ts || []).forEach((t) => (map[t.id] = t));
    setTeamsMap(map);
  };

  const loadGames = async (w) => {
    const { data: gs } = await supabase
      .from("games")
      .select("*")
      .eq("week", w)
      .eq("season", SEASON)
      .order("start_time");
    setGames(gs || []);

    // odds: última y penúltima por juego
    const ids = (gs || []).map((g) => g.id);
    if (ids.length) {
      const { data } = await supabase
        .from("odds")
        .select(
          "game_id, spread_home, spread_away, ml_home, ml_away, fetched_at"
        )
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

  const loadSeasonRecords = async () => {
    const { data: finals } = await supabase
      .from("games")
      .select("home_team,away_team,home_score,away_score,status")
      .eq("season", SEASON)
      .eq("status", "final");
    const rec = {};
    const add = (id, ptsFor, ptsAg, win, tie) => {
      if (!rec[id]) rec[id] = { w: 0, l: 0, t: 0, ptsFor: 0, ptsAg: 0, diff: 0 };
      rec[id].ptsFor += ptsFor;
      rec[id].ptsAg += ptsAg;
      rec[id].diff += ptsFor - ptsAg;
      if (tie) rec[id].t += 1;
      else if (win) rec[id].w += 1;
      else rec[id].l += 1;
    };
    (finals || []).forEach((g) => {
      const hs = g.home_score ?? 0,
        as = g.away_score ?? 0;
      if (hs === as) {
        add(g.home_team, hs, as, false, true);
        add(g.away_team, as, hs, false, true);
      } else if (hs > as) {
        add(g.home_team, hs, as, true, false);
        add(g.away_team, as, hs, false, false);
      } else {
        add(g.home_team, hs, as, false, false);
        add(g.away_team, as, hs, true, false);
      }
    });
    setTeamRecords(rec);

    const byDiv = {};
    const byConf = { AFC: [], NFC: [] };
    Object.keys(rec).forEach((id) => {
      const t = teamsMap[id];
      if (!t) return;
      const row = { id, ...rec[id] };
      const keyDiv = `${t.conference}-${t.division}`;
      if (!byDiv[keyDiv]) byDiv[keyDiv] = [];
      byDiv[keyDiv].push(row);
      if (!byConf[t.conference]) byConf[t.conference] = [];
      byConf[t.conference].push(row);
    });
    const sortFn = (a, b) => b.w - a.w || a.l - b.l || b.diff - a.diff;
    Object.keys(byDiv).forEach((k) => byDiv[k].sort(sortFn));
    Object.keys(byConf).forEach((k) => byConf[k].sort(sortFn));
    setDivStandings(byDiv);
    setConfStandings(byConf);
  };

  const initAll = async () => {
    // perfil
    const email = session.user.email;
    let { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();
    if (!prof) {
      await supabase
        .from("profiles")
        .insert({
          id: session.user.id,
          email,
          display_name: email.split("@")[0],
        });
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
  useEffect(() => {
    if (Object.keys(teamsMap).length) loadSeasonRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsMap]);
  useEffect(() => localStorage.setItem("dayFilter", dayFilter), [dayFilter]);
  useEffect(() => localStorage.setItem("teamQuery", teamQuery), [teamQuery]);

  /* ---------- Helpers picks/alertas ---------- */
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

  // Notificación local T-90
  useEffect(() => {
    if (!("Notification" in window)) return;
    if (!nextKickoffISO) return;
    Notification.requestPermission();
    const ms =
      DateTime.fromISO(nextKickoffISO).diffNow("milliseconds").milliseconds -
      90 * 60 * 1000;
    if (ms > 0 && ms < 24 * 60 * 60 * 1000) {
      const id = setTimeout(() => {
        if (Notification.permission === "granted") {
          new Notification("Survivor", {
            body: "Faltan 90 min para el próximo kickoff. ¡Haz tu pick!",
          });
        }
      }, ms);
      return () => clearTimeout(id);
    }
  }, [nextKickoffISO]);

  const popPct = (teamId) =>
    popularity.find((p) => p.team_id === teamId)?.pct ?? 0;

  const canPick = (g, team) => {
    const locked = DateTime.fromISO(g.start_time) <= DateTime.now();
    if (locked) return { ok: false, reason: "LOCK" };
    const used = (picks || []).some(
      (p) => p.team_id === team && p.user_id === session.user.id
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
        user_id: session.user.id,
        game_id: game.id,
        team_id: teamId,
        week,
        season: SEASON,
      });
      if (error) return alert(error.message);
    }
    const { data: pk } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", session.user.id);
    setPicks(pk || []);
    setPendingPick(null);
    await loadLeaguePicks(week);
  };

  /* ---------- Autopick (actualizado a /api/control) ---------- */
  const autopickMe = async () => {
    try {
      const url = `${SITE}/api/control?action=autopickOne&week=${week}&user_id=${encodeURIComponent(
        session.user.id
      )}&token=${encodeURIComponent(CRON_TOKEN)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || "Error autopick");
      alert("Autopick aplicado para ti.");
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
      const url = `${SITE}/api/control?action=autopick&week=${week}&token=${encodeURIComponent(
        CRON_TOKEN
      )}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false)
        throw new Error(j.error || "Error autopick liga");
      alert("Autopick de liga listo.");
      await loadLeaguePicks(week);
    } catch (e) {
      alert(e.message);
    }
  };

  /* ---------- UI helpers ---------- */
  const TeamMini = ({ id }) => {
    const logo = teamsMap[id]?.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-1">
        <img
          src={logo}
          alt={id}
          className="h-5 w-5 object-contain"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
        <span className="font-mono font-semibold">{id}</span>
      </span>
    );
  };

  const TeamChip = ({ id }) => {
    const t = teamsMap[id] || {};
    const logo = t.logo_url || `/teams/${id}.png`;
    return (
      <span className="inline-flex items-center gap-2">
        <img
          src={logo}
          alt={id}
          className="h-6 w-6 object-contain"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
        <span className="font-medium">{t.name || id}</span>
      </span>
    );
  };

  const ScoreStrip = ({ g }) => {
    const status = g.status || "scheduled";
    const score = (
      <div className="flex items-center gap-4">
        <div className="text-lg font-bold">
          {g.away_team}{" "}
          <span className="tabular-nums">{g.away_score ?? 0}</span>
        </div>
        <div className="text-gray-300">—</div>
        <div className="text-lg font-bold">
          {g.home_team}{" "}
          <span className="tabular-nums">{g.home_score ?? 0}</span>
        </div>
      </div>
    );
    const liveBits = (
      <div className="text-xs flex items-center gap-2">
        {g.period != null && (
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900">
            Q{g.period} {g.clock || ""}
          </span>
        )}
        {g.down != null && g.distance != null && (
          <span className="px-2 py-0.5 rounded bg-gray-100">
            {g.down}&amp;{g.distance}
          </span>
        )}
        {g.yard_line && (
          <span className="px-2 py-0.5 rounded bg-gray-100">
            @{g.yard_line}
          </span>
        )}
        {g.possession && (
          <span className="px-2 py-0.5 rounded bg-gray-100">
            ⬤ {g.possession}
          </span>
        )}
        {g.red_zone && (
          <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800">
            Red Zone
          </span>
        )}
      </div>
    );

    if (status === "final")
      return (
        <div className="flex items-center justify-between">
          {score}
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100">
            FINAL
          </span>
        </div>
      );
    if (status === "in_progress")
      return (
        <div className="flex items-center justify-between">{score}{liveBits}</div>
      );
    return (
      <div className="flex items-center justify-between">
        {score}
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">
          Kickoff en <Countdown iso={g.start_time} />
        </span>
      </div>
    );
  };

  const TeamBox = ({ game, teamId }) => {
    const disabled = !canPick(game, teamId).ok;
    const selected =
      myPickThisWeek?.game_id === game.id && myPickThisWeek?.team_id === teamId;
    const { last } = oddsPairs[game.id] || {};
    const fav =
      last &&
      ((teamId === game.home_team &&
        ((last.spread_home ?? 0) < (last.spread_away ?? 0) ||
          (last.ml_home ?? 9999) < (last.ml_away ?? 9999))) ||
        (teamId === game.away_team &&
          ((last.spread_away ?? 0) < (last.spread_home ?? 0) ||
            (last.ml_away ?? 9999) < (last.ml_home ?? 9999))));
    const pct = popPct(teamId);
    return (
      <button
        onClick={() => confirmPick(game, teamId)}
        disabled={disabled}
        className={clsx(
          "w-full text-left rounded-xl border transition px-4 py-3",
          selected ? "border-emerald-500 bg-emerald-50" : "border-gray-200 hover:bg-gray-50",
          disabled && "opacity-50 cursor-not-allowed"
        )}
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
      </button>
    );
  };

  /* ---------- Filtros ---------- */
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

  /* ---------- Stats modal (H2H + fichas + noticias) ---------- */
  useEffect(() => {
    const loadH2HAndNews = async () => {
      if (!showStats) return;
      const g = showStats.game;
      // H2H 2021–2025 finales
      const { data: finals } = await supabase
        .from("games")
        .select("home_team, away_team, home_score, away_score, season, status")
        .or(
          `and(home_team.eq.${g.home_team},away_team.eq.${g.away_team}),and(home_team.eq.${g.away_team},away_team.eq.${g.home_team})`
        )
        .gte("season", 2021)
        .lte("season", 2025)
        .eq("status", "final")
        .order("season", { ascending: false });

      const rows = finals || [];
      let homeWins = 0,
        awayWins = 0,
        marginSum = 0,
        lastWinner = null,
        streak = 0;
      rows.forEach((r) => {
        const winner = r.home_score > r.away_score ? r.home_team : r.away_team;
        const diff =
          (r.home_team === g.home_team
            ? r.home_score - r.away_score
            : r.away_score - r.home_score) || 0;
        marginSum += diff;
        if (winner === g.home_team) {
          homeWins++;
          if (lastWinner === g.home_team) streak++;
          else {
            lastWinner = g.home_team;
            streak = 1;
          }
        } else {
          awayWins++;
          if (lastWinner === g.away_team) streak++;
          else {
            lastWinner = g.away_team;
            streak = 1;
          }
        }
      });
      setH2h({
        games: rows.length,
        homeWins,
        awayWins,
        avgMargin: rows.length ? (marginSum / rows.length).toFixed(1) : "0.0",
        streak: lastWinner ? `${lastWinner} x${streak}` : "-",
      });

      // Noticias (opcional)
      const { data: newsRows, error } = await supabase
        .from("news")
        .select("team_id,title,url,published_at")
        .in("team_id", [g.home_team, g.away_team])
        .order("published_at", { ascending: false })
        .limit(6);
      setNews(error ? [] : newsRows || []);
    };
    loadH2HAndNews();
  }, [showStats]);

  /* ========================= Render ========================= */
  const nextKick = nextKickoffISO;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{LEAGUE}</h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-700">
            Hola, <b>{me?.display_name}</b> · Vidas:{" "}
            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
              {me?.lives}
            </span>
          </p>
          <button className="text-sm underline" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </div>
      </header>

      {showPickAlert && (
        <div className="mt-3 p-3 border-2 border-red-300 rounded-xl bg-red-50 text-red-900 text-sm">
          🔔 Aún no tienes pick en W{week}. El primer kickoff es en{" "}
          <b>
            <Countdown iso={nextKick} />
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
                  className={clsx(
                    "px-2 py-1 rounded border",
                    dayFilter === d && "bg-black text-white"
                  )}
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

        <div className="md:col-span-2 p-4 border rounded-2xl bg-white">
          <h3 className="font-semibold">Resumen</h3>
          <p className="text-sm text-gray-600">
            Elige tu pick en los partidos de abajo. Lock “rolling” por partido.
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
            const { last } = oddsPairs[g.id] || {};
            const spreadHome = last?.spread_home ?? null;
            const spreadAway = last?.spread_away ?? null;
            const mlHome = last?.ml_home ?? null;
            const mlAway = last?.ml_away ?? null;
            const wpHome =
              winProbFromSpread(spreadHome) ??
              (mlHome != null && mlAway != null
                ? Math.round(100 / (1 + Math.pow(10, (mlHome - mlAway) / 400)))
                : null);
            const wpAway =
              winProbFromSpread(-spreadHome) ??
              (mlHome != null && mlAway != null ? 100 - (wpHome ?? 50) : null);

            return (
              <div
                key={g.id}
                className={clsx("p-4 border rounded-xl", locked && "opacity-60")}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <TeamChip id={g.away_team} />
                    <span className="mx-1 text-gray-400">@</span>
                    <TeamChip id={g.home_team} />
                  </div>
                  <div className="text-xs text-gray-600 flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100">
                      {local}
                    </span>
                    <button
                      className="text-xs underline"
                      onClick={() => setShowStats({ game: g })}
                    >
                      Stats
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <ScoreStrip g={g} />
                </div>

                <div className="mt-2 text-xs text-gray-700 flex gap-3 flex-wrap">
                  {spreadHome != null && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      Spread: {g.home_team}{" "}
                      {spreadHome > 0 ? `+${spreadHome}` : spreadHome}, {g.away_team}{" "}
                      {spreadAway > 0 ? `+${spreadAway}` : spreadAway}
                    </span>
                  )}
                  {mlHome != null && mlAway != null && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      ML: {g.home_team} {mlHome}, {g.away_team} {mlAway}
                    </span>
                  )}
                  {(wpHome != null || wpAway != null) && (
                    <span className="px-2 py-0.5 rounded bg-gray-50 border">
                      Win%: {g.home_team} {wpHome ?? "—"}% · {g.away_team}{" "}
                      {wpAway ?? "—"}%
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TeamBox game={g} teamId={g.home_team} />
                  <TeamBox game={g} teamId={g.away_team} />
                </div>
              </div>
            );
          })}
          {(!gamesFiltered || gamesFiltered.length === 0) && (
            <div className="text-sm text-gray-500">
              No hay partidos con este filtro/búsqueda.
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
                    <span className="text-gray-700 text-base font-semibold">
                      {row.pct}%
                    </span>
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
                Sin picks registrados.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Standings por División & Conferencia */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Standings por División ({SEASON})</h2>
          <div className="mt-3 space-y-4">
            {Object.keys(divStandings).length === 0 && (
              <p className="text-sm text-gray-500">
                Aún no hay finales suficientes.
              </p>
            )}
            {Object.entries(divStandings).map(([key, rows]) => {
              const [conf, div] = key.split("-");
              return (
                <div key={key}>
                  <div className="text-xs uppercase text-gray-500 mb-1">
                    {conf} · {div}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th>Equipo</th>
                        <th>W</th>
                        <th>L</th>
                        <th>T</th>
                        <th>Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="py-1.5">
                            <TeamMini id={r.id} />
                          </td>
                          <td className="text-emerald-700 font-medium">{r.w}</td>
                          <td className="text-red-600 font-medium">{r.l}</td>
                          <td className="text-gray-600">{r.t}</td>
                          <td>{r.diff}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 border rounded-2xl bg-white">
          <h2 className="font-semibold">Standings por Conferencia ({SEASON})</h2>
          <div className="mt-3 space-y-4">
            {["AFC", "NFC"].map((c) => (
              <div key={c}>
                <div className="text-xs uppercase text-gray-500 mb-1">{c}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th>Equipo</th>
                      <th>W</th>
                      <th>L</th>
                      <th>T</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(confStandings[c] || []).map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-1.5">
                          <TeamMini id={r.id} />
                        </td>
                        <td className="text-emerald-700 font-medium">{r.w}</td>
                        <td className="text-red-600 font-medium">{r.l}</td>
                        <td className="text-gray-600">{r.t}</td>
                        <td>{r.diff}</td>
                      </tr>
                    ))}
                    {(confStandings[c] || []).length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500" colSpan={5}>
                          Sin datos.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Historial usuario */}
      <section className="mt-6">
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
                      Sin picks aún.
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
      {showStats && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-3xl bg-white rounded-2xl p-5 border">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <TeamMini id={showStats.game.away_team} /> @{" "}
                <TeamMini id={showStats.game.home_team} />
              </h3>
              <button className="text-sm underline" onClick={() => setShowStats(null)}>
                Cerrar
              </button>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              H2H 2021–2025, récord {SEASON}, posiciones por división/conferencia y
              noticias.
            </p>

            {/* H2H */}
            <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">Partidos</div>
                <div className="text-xl font-bold">{h2h?.games ?? "—"}</div>
              </div>
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">Promedio margen</div>
                <div className="text-xl font-bold">{h2h?.avgMargin ?? "—"}</div>
              </div>
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">
                  Wins {showStats.game.home_team}
                </div>
                <div className="text-xl font-bold">{h2h?.homeWins ?? "—"}</div>
              </div>
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-xs text-gray-500">
                  Wins {showStats.game.away_team}
                </div>
                <div className="text-xl font-bold">{h2h?.awayWins ?? "—"}</div>
              </div>
              <div className="p-3 rounded border bg-gray-50 md:col-span-1 col-span-2">
                <div className="text-xs text-gray-500">Racha</div>
                <div className="text-xl font-bold">{h2h?.streak ?? "—"}</div>
              </div>
            </div>

            {/* Fichas por equipo */}
            <div className="mt-4 grid md:grid-cols-2 gap-4">
              {[showStats.game.home_team, showStats.game.away_team].map((id) => {
                const rec = teamRecords[id] || { w: 0, l: 0, t: 0, diff: 0 };
                const t = teamsMap[id] || {};
                const divKey = `${t.conference}-${t.division}`;
                const divArr = divStandings[divKey] || [];
                const confArr = confStandings[t.conference] || [];
                const rankDiv = Math.max(1, divArr.findIndex((x) => x.id === id) + 1) || "-";
                const rankConf = Math.max(1, confArr.findIndex((x) => x.id === id) + 1) || "-";
                return (
                  <div key={id} className="border rounded-xl p-3 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-base font-semibold">
                        <TeamMini id={id} /> {t.name || id}
                      </div>
                      <div className="text-xs text-gray-500">
                        {t.conference} · {t.division}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-gray-500">W-L-T</div>
                        <div className="font-bold">
                          {rec.w}-{rec.l}-{rec.t}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Diff</div>
                        <div className="font-bold">{rec.diff}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Rank Div</div>
                        <div className="font-bold">#{rankDiv}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Rank Conf</div>
                        <div className="font-bold">#{rankConf}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Noticias (opcional) */}
            {news.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold text-sm mb-2">Noticias recientes</h4>
                <ul className="space-y-1 text-sm">
                  {news.map((n, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <TeamMini id={n.team_id} />
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {n.title}
                      </a>
                      <span className="text-xs text-gray-500">
                        {n.published_at
                          ? DateTime.fromISO(n.published_at)
                              .setZone(TZ)
                              .toFormat("dd LLL")
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex gap-2 justify-end">
              <button
                className="px-4 py-2 rounded border"
                onClick={() => setShowStats(null)}
              >
                Cerrar
              </button>
              <button
                className="px-4 py-2 rounded bg-black text-white"
                onClick={() => {
                  const g = showStats.game;
                  const { last } = oddsPairs[g.id] || {};
                  if (!last) return alert("Sin odds disponibles.");
                  const isHomeFav =
                    (last.spread_home ?? 0) < (last.spread_away ?? 0) ||
                    (last.ml_home ?? 9999) < (last.ml_away ?? 9999);
                  confirmPick(g, isHomeFav ? g.home_team : g.away_team);
                  setShowStats(null);
                }}
              >
                Elegir por mí
              </button>
            </div>
          </div>
        </div>
      )}

      {!myPickThisWeek && nextKick && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-black text-white text-sm shadow-lg">
          Recuerda elegir: kickoff en <Countdown iso={nextKick} />
        </div>
      )}
    </div>
  );
}

/* ========================= Asistente de Picks ========================= */
function AssistantTab({ session }) {
  const [teams, setTeams] = useState({});
  const [games, setGames] = useState([]);
  const [odds, setOdds] = useState({});
  const [picks, setPicks] = useState([]);
  const [week, setWeek] = useState(() => Number(localStorage.getItem("week")) || 1);
  const [pop, setPop] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem("week", String(week));
  }, [week]);

  useEffect(() => {
    (async () => {
      const { data: ts } = await supabase.from("teams").select("*");
      const map = {};
      (ts || []).forEach((t) => (map[t.id] = t));
      setTeams(map);

      const { data: gs } = await supabase
        .from("games")
        .select("*")
        .eq("week", week)
        .eq("season", SEASON)
        .order("start_time");
      setGames(gs || []);

      const ids = (gs || []).map((g) => g.id);
      if (ids.length) {
        const { data } = await supabase
          .from("odds")
          .select("game_id,spread_home,spread_away,ml_home,ml_away,fetched_at")
          .in("game_id", ids)
          .order("fetched_at", { ascending: false });
        const by = {};
        for (const row of data || []) {
          if (!by[row.game_id]) by[row.game_id] = row;
        }
        setOdds(by);
      }

      const { data: pk } = await supabase
        .from("picks")
        .select("*")
        .eq("user_id", session.user.id);
      setPicks(pk || []);

      const { data: lp } = await supabase
        .from("picks")
        .select("team_id")
        .eq("week", week);
      const counts = {};
      (lp || []).forEach((p) => (counts[p.team_id] = (counts[p.team_id] || 0) + 1));
      const { data: st } = await supabase.from("standings").select("user_id");
      const total = st?.length || 0;
      const list = Object.entries(counts).map(([team, count]) => ({
        team,
        pct: total ? Math.round((count * 100) / total) : 0,
      }));
      setPop(list);
    })();
  }, [week, session.user.id]);

  const used = new Set((picks || []).map((p) => p.team_id));
  const getPop = (team) => pop.find((x) => x.team === team)?.pct ?? 0;

  const rows = (games || [])
    .map((g) => {
      const o = odds[g.id] || {};
      const sHome = o.spread_home;
      const wpHome = winProbFromSpread(sHome) ?? 50;
      const wpAway = winProbFromSpread(-sHome) ?? 50;
      return [
        {
          game: g,
          team: g.home_team,
          vs: g.away_team,
          wp: wpHome,
          pop: getPop(g.home_team),
          used: used.has(g.home_team),
        },
        {
          game: g,
          team: g.away_team,
          vs: g.home_team,
          wp: wpAway,
          pop: getPop(g.away_team),
          used: used.has(g.away_team),
        },
      ];
    })
    .flat();

  // score simple: Win% + (100 - pop) + bonus si no usado
  const ranked = rows
    .map((r) => ({
      ...r,
      score: (r.wp || 50) + (100 - (r.pop || 0)) + (r.used ? -30 : 10),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const confirm = async (r) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("picks").insert({
        user_id: session.user.id,
        game_id: r.game.id,
        team_id: r.team,
        week,
        season: SEASON,
      });
      if (error) throw error;
      alert("Pick guardado");
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Asistente de picks</h1>
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
      </header>

      <p className="text-sm text-gray-600 mt-1">
        Ranking por Win% (spread), diferencial de popularidad y si te queda disponible.
      </p>

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {ranked.map((r, i) => (
          <div key={i} className="border rounded-xl p-3 bg-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TeamMiniSimple teams={teams} id={r.team} />
                <span className="text-xs text-gray-500">vs {r.vs}</span>
              </div>
              <span className="text-xs text-gray-500">W{r.game.week}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">Win%</div>
                <div className="text-base font-bold">{r.wp ?? "—"}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Popularidad</div>
                <div className="text-base">{r.pop}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Disponible</div>
                <div className="text-base">{r.used ? "No" : "Sí"}</div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                disabled={busy || r.used}
                className="px-3 py-1 rounded border disabled:opacity-50"
                onClick={() => confirm(r)}
              >
                Elegir
              </button>
              <span className="ml-auto text-xs text-gray-500">
                Score {Math.round(r.score)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamMiniSimple({ teams, id }) {
  const logo = teams[id]?.logo_url || `/teams/${id}.png`;
  return (
    <span className="inline-flex items-center gap-1">
      <img
        src={logo}
        alt={id}
        className="h-5 w-5 object-contain"
        onError={(e) => (e.currentTarget.style.visibility = "hidden")}
      />
      <span className="font-mono font-semibold">{id}</span>
    </span>
  );
}

/* ========================= Noticias ========================= */
function NewsTab() {
  const [team, setTeam] = useState(""); // "" = general
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async (t) => {
    setLoading(true);
    let q = supabase.from("news").select("*").order("published_at", { ascending: false }).limit(30);
    if (t) q = q.eq("team_id", t);
    const { data } = await q;
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data: ts } = await supabase.from("teams").select("id,name").order("id");
      setTeams(ts || []);
      await load("");
    })();
  }, []);

  useEffect(() => {
    load(team);
  }, [team]);

  // ---- ACTUALIZADO: usa /api/control?action=syncNews ----
  const syncNow = async (scopeTeam) => {
    const url = scopeTeam
      ? `${SITE}/api/control?action=syncNews&team=${encodeURIComponent(scopeTeam)}&token=${encodeURIComponent(CRON_TOKEN)}`
      : `${SITE}/api/control?action=syncNews&token=${encodeURIComponent(CRON_TOKEN)}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) return alert(j.error || "Error sincronizando");
    await load(team);
    alert(`Noticias sincronizadas (${j.inserted || 0})`);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Noticias</h1>
        <div className="flex items-center gap-2">
          <select
            className="border p-1 rounded-lg"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Generales</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} — {t.name}
              </option>
            ))}
          </select>
          <button className="text-xs px-2 py-1 rounded border" onClick={() => syncNow("")}>
            Sync general
          </button>
          {team && (
            <button className="text-xs px-2 py-1 rounded border" onClick={() => syncNow(team)}>
              Sync {team}
            </button>
          )}
        </div>
      </header>

      {loading && <p className="mt-3 text-sm text-gray-500">Cargando…</p>}

      <ul className="mt-4 space-y-3">
        {(items || []).map((n) => (
          <li key={n.id} className="p-3 border rounded-xl bg-white">
            <div className="text-xs text-gray-500 flex items-center gap-2">
              {n.team_id ? (
                <span className="px-1.5 py-0.5 rounded bg-gray-100">{n.team_id}</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-gray-100">NFL</span>
              )}
              <span>{n.source || "ESPN"}</span>
              <span>
                ·{" "}
                {n.published_at
                  ? DateTime.fromISO(n.published_at).setZone(TZ).toFormat("dd LLL HH:mm")
                  : ""}
              </span>
            </div>
            <a href={n.url} target="_blank" rel="noreferrer" className="block mt-1 font-medium underline">
              {n.title}
            </a>
          </li>
        ))}
        {(items || []).length === 0 && !loading && (
          <p className="text-sm text-gray-500">Sin noticias.</p>
        )}
      </ul>
    </div>
  );
}
