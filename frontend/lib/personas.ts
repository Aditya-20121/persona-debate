import { Persona, PersonaId } from "./types";

// Mirrors agents/personas.py — kept in sync manually since the backend
// /personas endpoint returns the same id/name/emoji/tagline.
export const PERSONAS: Persona[] = [
  {
    id: "mandela",
    name: "Nelson Mandela",
    emoji: "✊",
    tagline: "Justice & reconciliation",
  },
  {
    id: "gandhi",
    name: "Mahatma Gandhi",
    emoji: "🕊️",
    tagline: "Non-violence & truth",
  },
  {
    id: "marx",
    name: "Karl Marx",
    emoji: "⚒️",
    tagline: "Class struggle & revolution",
  },
];

export const PERSONA_THEME: Record<
  PersonaId,
  { text: string; bg: string; border: string; ring: string }
> = {
  gandhi: {
    text: "text-gandhi",
    bg: "bg-gandhi-soft",
    border: "border-gandhi/40",
    ring: "ring-gandhi/50",
  },
  mandela: {
    text: "text-mandela",
    bg: "bg-mandela-soft",
    border: "border-mandela/40",
    ring: "ring-mandela/50",
  },
  marx: {
    text: "text-marx",
    bg: "bg-marx-soft",
    border: "border-marx/40",
    ring: "ring-marx/50",
  },
};

export function personaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
