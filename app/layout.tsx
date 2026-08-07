import type { Metadata } from 'next'
import { fontVariables } from './fonts'
import './globals.css'

export const metadata: Metadata = {
  title: 'Spinnerly',
  description: 'Build a wheel, share the link, let the room watch it land.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  )
}
