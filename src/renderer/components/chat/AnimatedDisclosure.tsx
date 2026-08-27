import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "../../utils/cn";

export function AnimatedDisclosure({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (rootRef.current) {
      rootRef.current.inert = !open;
    }
  }, [open]);

  return (
    <div
      ref={rootRef}
      aria-hidden={!open}
      data-disclosure-state={open ? "open" : "closed"}
      className={cn("ai-disclosure", className)}
    >
      <div className="ai-disclosure-clip">{children}</div>
    </div>
  );
}
