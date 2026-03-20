import { cn } from "../../utils/cn";

export function StreamingStatusHint({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span
        className={cn(
          "animate-thinking-text-wave motion-reduce:animate-none inline-block",
          "bg-[length:220%_100%] bg-clip-text text-[12.5px] font-medium tracking-[0.01em] text-transparent",
          "bg-[linear-gradient(90deg,rgba(168,162,158,0.45)_0%,rgba(120,113,108,0.88)_35%,rgba(87,83,78,0.92)_50%,rgba(120,113,108,0.88)_65%,rgba(168,162,158,0.45)_100%)]"
        )}
      >
        {label}
      </span>
    </div>
  );
}
