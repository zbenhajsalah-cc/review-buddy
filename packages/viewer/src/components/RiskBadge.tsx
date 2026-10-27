import type { Risk } from "@review-buddy/core/types";
import { cn } from "../lib/utils.ts";
import { Badge } from "./ui/badge.tsx";

const RISK_CLASSES: Record<Risk, string> = {
  High: "rounded-full px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide bg-[var(--color-risk-high-bg)] text-[var(--color-risk-high)]",
  Medium:
    "rounded-full px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide bg-[var(--color-risk-medium-bg)] text-[var(--color-risk-medium)]",
  Low: "rounded-full px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide bg-[var(--color-risk-low-bg)] text-[var(--color-risk-low)]",
};

export function RiskBadge({ risk }: { risk: Risk }) {
  return <Badge className={cn("border-transparent", RISK_CLASSES[risk])}>{risk}</Badge>;
}
