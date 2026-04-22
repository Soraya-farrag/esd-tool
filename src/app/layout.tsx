import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Execution System Diagnostic | Mosaic Shifter',
  description: 'Assess whether your execution system is ready for strategy deployment. Evaluate decision rights, coordination, leadership, and more.',
  icons: { icon: '/icon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
