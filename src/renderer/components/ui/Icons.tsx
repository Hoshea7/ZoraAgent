export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M5.75 7.25h12.5M9.75 7.25V5.5c0-.7.55-1.25 1.25-1.25h2c.7 0 1.25.55 1.25 1.25v1.75m2.5 0l-.7 10.2a2 2 0 01-2 1.86h-4.1a2 2 0 01-2-1.86l-.7-10.2"
      />
    </svg>
  );
}

export function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M5.25 8.25h13.5m-12 0V18a1.75 1.75 0 001.75 1.75h7A1.75 1.75 0 0017.25 18V8.25m-10.5 0L7.7 4.75h8.6l.95 3.5M10 12h4"
      />
    </svg>
  );
}

export function ForkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M6 8.5v2a2.5 2.5 0 002.5 2.5h7a2.5 2.5 0 002.5-2.5v-2M12 13v2.5"
      />
      <circle cx={6} cy={6} r={2.5} fill="none" strokeWidth={1.9} />
      <circle cx={18} cy={6} r={2.5} fill="none" strokeWidth={1.9} />
      <circle cx={12} cy={18} r={2.5} fill="none" strokeWidth={1.9} />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

export function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x={8} y={8} width={12} height={12} rx={2} strokeWidth={1.8} />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"
      />
    </svg>
  );
}

export function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M18.35 7.05A7.2 7.2 0 007.7 5.1"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M18.55 3.95v3.2h-3.2"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M5.65 16.95a7.2 7.2 0 0010.65 1.95"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M5.45 20.05v-3.2h3.2"
      />
    </svg>
  );
}
