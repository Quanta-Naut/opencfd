/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--color-bg-canvas)",
        chrome: "var(--color-bg-chrome)",
        panel: "var(--color-bg-panel)",
        border: "var(--color-border-default)",
        borderDark: "var(--color-border-mesh)",
        accent: "var(--color-accent)",
        accentHover: "var(--color-accent-hover)",
        accentLight: "var(--color-accent-subtle)",
        textMain: "var(--color-text-primary)",
        textMuted: "var(--color-text-secondary)",
        textDim: "var(--color-text-tertiary)",
        success: "var(--color-status-success)",
        warning: "var(--color-status-warning)",
        danger: "var(--color-status-danger)",
      },
      borderRadius: {
        none: "0px",
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "4px", // Override soft rounded-lg down to 4px to safeguard any unconverted occurrences
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
