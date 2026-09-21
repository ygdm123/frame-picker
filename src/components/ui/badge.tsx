import * as React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "outline" | "muted";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const styles =
    variant === "outline"
      ? "border border-[hsl(var(--color-border))] text-[hsl(var(--color-foreground))]"
      : variant === "muted"
        ? "bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]"
        : "bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))]";
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        styles,
        className
      )}
      {...props}
    />
  );
}