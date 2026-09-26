import type { LucideIcon } from "lucide-react";

/** Honest empty state: says what lives here and the one next action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <Icon className="text-muted-foreground size-8" aria-hidden />
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      {children}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <h1 className="heading-caps text-lg">{title}</h1>
      {children}
    </div>
  );
}
