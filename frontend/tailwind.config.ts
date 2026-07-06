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
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
      },
      colors: {
        arena: {
          bg: "#0c0d10",
          panel: "#141519",
          raised: "#1a1c22",
          border: "#26282f",
        },
        // Neutral app accent for primary actions/focus — deliberately
        // distinct from all three persona colors so it never reads as
        // "this is Gandhi's/Mandela's/Marx's color".
        accent: {
          DEFAULT: "#818cf8",
          hover: "#93a0fa",
          soft: "#191a2e",
        },
        gandhi: {
          DEFAULT: "#34d399",
          soft: "#0d211a",
        },
        mandela: {
          DEFAULT: "#fbbf24",
          soft: "#241c0a",
        },
        marx: {
          DEFAULT: "#f87171",
          soft: "#241012",
        },
      },
    },
  },
  plugins: [],
};

export default config;
