/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      // Rediseño "moderno oscuro": en vez de reescribir cada className del
      // componente (bg-white, text-slate-900, bg-black, etc.), remapeamos
      // los tokens de color que ya se usan en todo el código a la nueva
      // paleta oscura. Así toda la app cambia de piel sin tocar el JSX.
      colors: {
        white: "#12161f",   // fondos "bg-white" -> tarjetas oscuras elevadas
        black: "#22c55e",   // fondos "bg-black" -> acento primario (verde "vivo")
        slate: {
          900: "#eef1f6",    // texto principal (antes casi negro, ahora casi blanco)
        },
        gray: {
          50:  "#171c26",
          100: "#1c222d",
          200: "#262d3a",   // borde por default de Tailwind (bare "border")
          300: "#3a4353",
          400: "#6b7686",
          500: "#8b93a7",
          600: "#a7afc0",
          700: "#c2c8d6",
        },
        emerald: {
          50:  "#0f2a1c",
          100: "#123a26",
          500: "#22c55e",
          700: "#4ade80",
          800: "#86efac",
        },
        rose: {
          50:  "#2a1116",
          100: "#3a161d",
          300: "#7f2231",
          800: "#fda4af",
          900: "#fecdd3",
        },
        amber: {
          50:  "#2b220f",
          300: "#7c5a17",
          900: "#fcd34d",
        },
        red: {
          600: "#f87171",
        },
      },
    },
  },
  plugins: [],
};
