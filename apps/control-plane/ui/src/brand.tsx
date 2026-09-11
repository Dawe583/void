/** Exact aperture geometry from Dawe583/void-empty, components/site/shell.tsx. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={"void-aperture " + className}
      viewBox="55 55 146 146"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M73 102V73h29M183 102V73h-29M73 154v29h29M183 154v29h-29"
        stroke="currentColor"
        strokeWidth="15"
        strokeLinecap="square"
      />
      <path d="M108 108h40v40h-40z" stroke="var(--action)" strokeWidth="12" />
      <circle cx="128" cy="128" r="6" fill="currentColor" />
    </svg>
  );
}
