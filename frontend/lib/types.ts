export type PersonaId = "gandhi" | "mandela" | "marx";

export interface Persona {
  id: PersonaId;
  name: string;
  emoji: string;
  tagline: string;
}

export interface RetrievedChunk {
  content: string;
  topic_keywords: string[];
  ethical_dilemma_type: string;
  philosophical_summary: string;
  chunk_index: number | null;
  page_num: number | null;
}

export interface DebateEvent {
  type: "message" | "done" | "error";
  persona_id: string;
  name: string;
  text: string;
  round: number;
  retrieved_chunks: RetrievedChunk[];
  error: string;
}

export interface DebateStartPayload {
  question: string;
  persona_ids: string[];
  max_rounds: number;
}
