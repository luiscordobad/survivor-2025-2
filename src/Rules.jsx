// src/Rules.jsx
export default function Rules() {
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Reglas del Survivor</h1>

      <section className="mt-4 space-y-2">
        <h2 className="text-xl font-semibold">Formato</h2>
        <ul className="list-disc ml-6 text-sm leading-6">
          <li>Temporada NFL 2025 completa: Semanas 1–18 + Playoffs.</li>
          <li>Ganas si tu equipo gana. Empate = sobrevives.</li>
          <li>No puedes repetir equipo en toda la temporada.</li>
          <li>Tienes <b>2 vidas</b>. No hay rebuy.</li>
          <li>Lock por partido (rolling lock): cuando inicia, ya no puedes cambiar ese pick.</li>
          <li>Si el partido se pospone/cancela, se reabre tu elección.</li>
          <li>Auto-pick: si no eliges, tomaremos el favorito más fuerte disponible.</li>
          <li>Zona horaria: Ciudad de México.</li>
        </ul>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-xl font-semibold">Desempates y Playoffs</h2>
        <ul className="list-disc ml-6 text-sm leading-6">
          <li>Gana el último sobreviviente.</li>
          <li>Si llegan varios al final de la W18, tie-break por acumulado de <i>márgenes de victoria</i>.</li>
          <li>Continuamos a Playoffs si aún hay sobrevivientes.</li>
        </ul>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-xl font-semibold">Recordatorios y avisos</h2>
        <ul className="list-disc ml-6 text-sm leading-6">
          <li>Enviamos recordatorio ~3h antes del siguiente kickoff a quien no tenga pick.</li>
          <li>Puedes editar tu pick hasta el lock del partido correspondiente.</li>
        </ul>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-xl font-semibold">Conducta</h2>
        <p className="text-sm leading-6">
          Esta liga es recreativa. Nada de apuestas con dinero real dentro de la plataforma.
          Las cuotas mostradas (odds) son informativas.
        </p>
      </section>
    </div>
  );
}
