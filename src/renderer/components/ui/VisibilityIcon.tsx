export function VisibilityIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg className="h-[16px] w-[16px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 3l18 18M10.58 10.58A3 3 0 0014 13.42M9.88 5.09A9.77 9.77 0 0112 4.85c4.5 0 8.27 2.94 9.54 7a9.96 9.96 0 01-3.08 4.5M6.23 6.23A9.96 9.96 0 002.46 11.85a9.97 9.97 0 005.02 5.78"
        />
      </svg>
    );
  }

  return (
    <svg className="h-[16px] w-[16px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.46 12C3.73 7.94 7.5 5 12 5s8.27 2.94 9.54 7c-1.27 4.06-5.04 7-9.54 7s-8.27-2.94-9.54-7z"
      />
      <circle cx="12" cy="12" r="3" strokeWidth={2} />
    </svg>
  );
}
