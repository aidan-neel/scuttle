const TICKS = Array.from({ length: 72 }, (_, idx) => idx);

export function ScrollRuler() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 left-2.5 hidden w-3 flex-col justify-between py-4 opacity-50 select-none sm:flex"
    >
      {TICKS.map((tick) => (
        <span
          key={tick}
          className={`block h-px bg-white/15 ${tick % 5 === 0 ? "w-2.5" : "w-1.5"}`}
        />
      ))}
    </div>
  );
}
