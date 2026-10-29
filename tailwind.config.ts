import type { Config } from "tailwindcss";

/**
 * Visual system derived from the Coding Ninjas KIIT Chapter logo:
 * red-orange accent, charcoal ink, neutral surfaces (PRD §9.1).
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#222426",
        muted: "#5b6064",
        faint: "#8a8f93",
        surface: "#fafaf8",
        card: "#ffffff",
        line: "#e4e6e4",
        accent: {
          DEFAULT: "#e8541e",
          dark: "#c94416",
          soft: "#fdeee8",
        },
        success: "#16723c",
        danger: "#b3261e",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"', "Roboto",
          '"Helvetica Neue"', "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(24,24,27,0.06)",
        raised: "0 4px 16px rgba(24,24,27,0.10)",
      },
      borderRadius: {
        lg: "10px",
      },
    },
  },
  plugins: [],
};

export default config;
