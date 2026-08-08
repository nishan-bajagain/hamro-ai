import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-edge bg-panel shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-edge px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

const badgeTones = {
  green: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  amber: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  red: "bg-red-500/10 text-red-300 border-red-500/25",
  blue: "bg-cyan-500/10 text-cyan-300 border-cyan-500/25",
  violet: "bg-violet-500/10 text-violet-300 border-violet-500/25",
  zinc: "bg-zinc-500/10 text-zinc-300 border-zinc-500/25",
};

export function Badge({
  children,
  tone = "zinc",
  className = "",
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  status,
  className = "",
}: {
  status: "online" | "degraded" | "offline" | "unknown";
  className?: string;
}) {
  const colors: Record<string, string> = {
    online: "bg-emerald-400",
    degraded: "bg-amber-400",
    offline: "bg-red-400",
    unknown: "bg-zinc-500",
  };
  const pulsing = status === "online" ? "pulse-dot" : "";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[status]} ${pulsing} ${className}`}
    />
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "text-zinc-100",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: string;
}) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1.5 font-mono text-xl font-semibold tracking-tight ${accent}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-faint">{sub}</div>}
    </Card>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}
