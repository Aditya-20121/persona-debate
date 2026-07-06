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
      colors: {
        arena: {
          bg: "#0a0c12",
          panel: "#12151f",
          raised: "#171b28",
          border: "#242938",
        },
        // Neutral app accent for primary actions/focus — deliberately
        // distinct from all three persona colors so it never reads as
        // "this is Gandhi's/Mandela's/Marx's color".
        accent: {
          DEFAULT: "#6366f1",
          hover: "#7476f3",
          soft: "#1a1b35",
        },
        gandhi: {
          DEFAULT: "#14b8a6",
          soft: "#0f2e2a",
        },
        mandela: {
          DEFAULT: "#d97706",
          soft: "#332209",
        },
        marx: {
          DEFAULT: "#dc2626",
          soft: "#330d0d",
        },
      },
    },
  },
  plugins: [],
};

export default config;
