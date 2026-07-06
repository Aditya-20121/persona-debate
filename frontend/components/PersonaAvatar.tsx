import { PersonaId } from "@/lib/types";
import { PERSONA_THEME } from "@/lib/personas";

export default function PersonaAvatar({
  personaId,
  emoji,
  size = "md",
}: {
  personaId: string;
  emoji: string;
  size?: "sm" | "md" | "lg";
}) {
  const theme = PERSONA_THEME[personaId as PersonaId];
  const sizeClasses =
    size === "lg"
      ? "w-14 h-14 text-2xl"
      : size === "sm"
      ? "w-8 h-8 text-base"
      : "w-11 h-11 text-xl";

  return (
    <div
      className={`flex items-center justify-center rounded-full border-2 ${sizeClasses} ${
        theme?.bg ?? "bg-arena-panel"
      } ${theme?.border ?? "border-arena-border"} shrink-0`}
      aria-hidden
    >
      <span>{emoji}</span>
    </div>
  );
}
