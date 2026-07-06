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

// Class-name strings must appear verbatim for Tailwind's scanner.
export const PERSONA_THEME: Record<
  PersonaId,
  { text: string; bg: string; border: string; edge: string }
> = {
  gandhi: {
    text: "text-gandhi",
    bg: "bg-gandhi-soft",
    border: "border-gandhi/40",
    edge: "border-l-gandhi",
  },
  mandela: {
    text: "text-mandela",
    bg: "bg-mandela-soft",
    border: "border-mandela/40",
    edge: "border-l-mandela",
  },
  marx: {
    text: "text-marx",
    bg: "bg-marx-soft",
    border: "border-marx/40",
    edge: "border-l-marx",
  },
};

export function personaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
