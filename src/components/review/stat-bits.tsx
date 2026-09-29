import { Badge } from "@/components/ui/badge";
import { sampleQuality } from "@/lib/review/stats";
import { cn } from "@/lib/utils";

/** n with honest-stats treatment: greyed below 10, "insufficient data" below 20. */
export function SampleBadge({ n }: { n: number }) {
  const q = sampleQuality(n);
  if (q === "ok") return null;
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground text-[10px]"
      data-testid="insufficient"
    >
      insufficient data
    </Badge>
  );
}

/**
 * Greyed out for n < 10: every text in the element turns muted (P&L colours
 * included), which keeps WCAG contrast unlike lowering the opacity.
 */
export function weakClass(n: number) {
  return cn(sampleQuality(n) === "weak" && "text-muted-foreground **:!text-muted-foreground");
}
