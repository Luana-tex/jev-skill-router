export const navigation = [
  { label: "Workspace", items: [
    { label: "Overview", href: "/", icon: "overview" },
    { label: "Decisions", href: "/decisions", icon: "decisions" },
    { label: "Skills", href: "/skills", icon: "skills" },
    { label: "Projects", href: "/projects", icon: "projects" },
  ] },
  { label: "Intelligence", items: [
    { label: "Routing", href: "/routing", icon: "routing" },
    { label: "Benchmarks", href: "/benchmarks", icon: "benchmarks" },
    { label: "Usage & Costs", href: "/usage", icon: "usage" },
  ] },
  { label: "System", items: [
    { label: "Diagnostics", href: "/diagnostics", icon: "diagnostics" },
    { label: "Settings", href: "/settings", icon: "settings" },
    { label: "Design System", href: "/design-system", icon: "design" },
  ] },
] as const;

export const items = navigation.flatMap((group) => [...group.items]);
