import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import { Shell } from "@/components/shell";
import { analyticsStatus } from "@/lib/analytics";

export const metadata: Metadata = { title: "JEV Skill Router", description: "Local Agent Skills analytics" };

const initializeTheme = "try{document.documentElement.dataset.theme=localStorage.getItem('jev-theme')==='light'?'light':'dark'}catch{}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: initializeTheme }} /></head>
    <body><Shell enabled={analyticsStatus()}>{children}</Shell></body></html>;
}
