import Link from "next/link";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 ${className}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" | "ok" }) {
  const color =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-neutral-900 dark:text-neutral-100";
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </Card>
  );
}

export function StatusBadge({ status }: { status: number }) {
  const tone =
    status >= 500 ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" :
    status === 429 ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" :
    status >= 400 ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" :
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

export function IssueStatusBadge({ status }: { status: string }) {
  const tone =
    status === "open" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" :
    status === "resolved" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" :
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="mb-4 text-sm text-neutral-500">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:underline">{it.label}</Link>
          ) : (
            <span className="text-neutral-800 dark:text-neutral-200">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function ago(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - t.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
