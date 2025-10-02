import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['VeraMono', 'Fira Code', 'Monaco', 'Cascadia Code', 'Roboto Mono', 'Consolas', 'monospace'],

        'vera-mono': ['VeraMono', 'Monaco', 'Consolas', 'monospace'],
        'code': ['VeraMono', 'Fira Code', 'source-code-pro', 'Menlo', 'Monaco', 'monospace'],
      },
      colors: {
        'mc': {
          background: '#f8fafc',
          cell: '#ffffff',
          text: '#1f2937',
          markdown: '#1f2937',
          line: '#9ca3af',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

export default config;
