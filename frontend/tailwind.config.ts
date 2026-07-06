import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      colors: {
        // Deep navy stage — everything sits on hsl(201 100% 13%)
        arena: {
          bg: "hsl(201 100% 13%)",
          panel: "rgba(255, 255, 255, 0.04)",
          raised: "rgba(255, 255, 255, 0.08)",
          border: "rgba(255, 255, 255, 0.12)",
        },
        muted: "hsl(240 4% 66%)",
        gandhi: {
          DEFAULT: "#34d399",
          soft: "rgba(52, 211, 153, 0.12)",
        },
        mandela: {
          DEFAULT: "#fbbf24",
          soft: "rgba(251, 191, 36, 0.12)",
        },
        marx: {
          DEFAULT: "#f87171",
          soft: "rgba(248, 113, 113, 0.12)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
