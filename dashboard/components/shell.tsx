"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Activity, ArrowDownUp, AudioLines, Blocks, CircleDollarSign, Folder, LayoutGrid, Menu, Moon, Network, PanelLeftClose, PanelLeftOpen, Palette, Settings, Sun, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { items, navigation } from "@/lib/navigation";

const icons = {
  overview: LayoutGrid, decisions: ArrowDownUp, skills: Blocks, projects: Folder,
  routing: Network, benchmarks: AudioLines, usage: CircleDollarSign, diagnostics: Activity, settings: Settings, design: Palette,
};

function Brand() {
  return <Link href="/" className="brand"><span className="brand-mark"><Network size={19} /></span><span className="nav-label">JEV Skill Router<small>Local workspace</small></span></Link>;
}

function Nav({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return <nav aria-label="Main navigation" className="navigation">{navigation.map(({ label, items }) =>
    <div className="nav-group" data-group={label} key={label}><p className="nav-label">{label}</p>{items.map((item) => {
      const Icon = icons[item.icon];
      const active = path === item.href;
      return <Link className="nav-link" key={item.href} href={item.href} onClick={onNavigate}
        title={item.label} aria-label={item.label} aria-current={active ? "page" : undefined}>
        <Icon size={17} /><span className="nav-label">{item.label}</span>
      </Link>;
    })}</div>)}</nav>;
}

export function Shell({ children, enabled }: { children: ReactNode; enabled: boolean | null }) {
  const path = usePathname();
  const current = items.find(({ href }) => href === path)?.label ?? "Dashboard";
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("jev-theme", next); } catch { /* Storage can be disabled. */ }
    setTheme(next);
  }

  return <div className={collapsed ? "shell collapsed" : "shell"}>
    <a className="skip" href="#main">Skip to content</a>
    <aside className="sidebar" aria-label="Sidebar">
      <Brand /><Nav path={path} />
      <div className="sidebar-foot"><span className="local-symbol"><Activity size={15} /></span><span className="nav-label"><strong>Local runtime</strong><small>SQLite analytics</small></span></div>
      <button type="button" className="icon-button collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
      </button>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-leading">
          <Dialog.Root open={drawer} onOpenChange={setDrawer}>
            <Dialog.Trigger asChild><button type="button" className="icon-button drawer-trigger" aria-label="Open navigation"><Menu size={19} /></button></Dialog.Trigger>
            <Dialog.Portal><Dialog.Overlay className="drawer-overlay" /><Dialog.Content className="drawer" aria-describedby={undefined}>
              <Dialog.Title className="sr-only">Dashboard navigation</Dialog.Title>
              <Brand /><Dialog.Close asChild><button type="button" className="icon-button drawer-close" aria-label="Close navigation"><X size={18} /></button></Dialog.Close>
              <Nav path={path} onNavigate={() => setDrawer(false)} />
            </Dialog.Content></Dialog.Portal>
          </Dialog.Root>
          <span className="crumb" aria-hidden="true">Workspace <span>/</span></span><strong>{current}</strong>
        </div>
        <div className="header-tools">
          <span className="analytics-pill" data-enabled={enabled === true}><span />Analytics {enabled === true ? "on" : enabled === false ? "off" : "unavailable"}</span>
          <button type="button" className="icon-button theme-button" aria-label="Toggle light or dark theme" aria-pressed={theme === null ? undefined : theme === "light"} onClick={toggleTheme}><Sun className="theme-sun" size={17} /><Moon className="theme-moon" size={17} /></button>
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
