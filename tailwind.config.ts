import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#151D33',
        teal: '#0DCBC4',
        purple: '#CB7CED',
        orange: '#F79F20',
        rose: '#C14B6C',
        'teal-50': '#E8FFFE',
        'purple-50': '#F6EAFD',
        'orange-50': '#FEF4E3',
        'rose-50': '#FAEAEE',
        'ink-50': '#EEF0F4',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
