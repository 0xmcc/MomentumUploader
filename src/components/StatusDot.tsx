type StatusDotTone = "processing" | "failed";

const toneClasses: Record<StatusDotTone, string> = {
  processing: "bg-yellow-400 shadow-[0_0_0_3px_rgba(250,204,21,0.14)]",
  failed: "bg-red-400 shadow-[0_0_0_3px_rgba(248,113,113,0.14)]",
};

export default function StatusDot({
  tone,
  label,
  className = "",
}: {
  tone: StatusDotTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${toneClasses[tone]} ${className}`.trim()}
    />
  );
}
