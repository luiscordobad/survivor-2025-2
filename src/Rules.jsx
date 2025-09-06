// src/Rules.jsx
export default function Rules() {
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Reglas del Survivor</h1>

      <section className="mt-4 space-y-2">
        <h2 className="text-xl font-semibold">Formato</h2>
        <ul className="list-disc ml-6 text-sm leading-6">
          <li>Temporada NFL 2025 completa (Semanas 1–18 + Playoffs).</li>
          <li>Ganas si tu equipo gana. Empate = sobrevives.</li>
          <li>No puedes repetir equipo en toda la temporada.</li>
          <li>Tienes <b>2 vidas</b>. No hay rebuy.</li>
          <li>Lock por partido (rolling lock).</li>
          <li>Si el partido se pospone/cancela, se reabre tu elección.</li>
          <li>Auto-pick: favorito más fuerte disponible si no eliges.</li>
          <li>Zona horaria: Ciudad de México.</li>
        </ul>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-xl font-semibold">Desempates y Playoffs</h2>
        <ul className="list-disc ml-6 text-sm leading-6">
          <li>Gana el último sobreviviente.</li>
          <li>Si quedan varios tras W18: tie-break por suma de márgenes de victoria.</li>
          <li>Continúa en Playoffs si aún hay sobrevivientes.</li>
        </ul>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-xl font-semibold">Recordatorios</h2>
        <ul className="list-disc ml-6 text-sm leading-6">
          <li>Recordatorio ~3 h antes del siguiente kickoff a quien no tenga pick.</li>
          <li>Puedes editar tu pick hasta el lock de su partido.</li>
        </ul>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-xl font-semibold">Aviso</h2>
        <p className="text-sm leading-6">
          Plataforma recreativa. Las cuotas mostradas son informativas; no se aceptan apuestas.
        </p>
      </section>
    </div>
  );
}

