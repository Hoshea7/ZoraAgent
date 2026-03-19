import { useEffect, useState } from "react";
import { cn } from "../../utils/cn";
import { formatDuration } from "../../utils/duration";

export function ElapsedTimer({
  startedAt,
  className,
}: {
  startedAt: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [startedAt]);

  return <span className={cn(className)}>{formatDuration(now - startedAt)}</span>;
}
