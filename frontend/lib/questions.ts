// Mirrors debate_questions.md — curated so all three personas (Gandhi,
// Mandela, Marx) genuinely disagree and the question maps onto the
// tagging taxonomy used by the retrieval pipeline.

export interface QuestionGroup {
  tier: string;
  questions: string[];
}

export const QUESTION_GROUPS: QuestionGroup[] = [
  {
    tier: "Tier 1 — Strongest three-way clashes",
    questions: [
      "Is violence ever justified in the pursuit of justice?",
      "Does real change come from changing hearts or changing systems?",
      "Should the oppressed forgive their oppressors?",
      "Can a just end justify unjust means?",
      "Is compromise with an unjust system betrayal or wisdom?",
      "Can great wealth ever be morally earned?",
      "Is poverty a moral failure or a structural one?",
    ],
  },
  {
    tier: "Tier 2 — Specific angles",
    questions: [
      "Does religion liberate people or keep them obedient?",
      "Should property be a fundamental right?",
      "Is the nation-state worth dying for?",
      "Do individuals make history, or do conditions make individuals?",
      "Is disobedience to law ever a duty?",
      "Should the state redistribute wealth?",
      "Is education the most powerful weapon for changing the world?",
      "Can democracy and deep inequality coexist?",
    ],
  },
  {
    tier: "Tier 3 — Timeless forms of hot topics",
    questions: [
      "Should workers own the companies they work for?",
      "Is global trade a force for liberation or exploitation?",
      "When machines do all the work, who should own what they produce?",
      "Is charity a virtue or a way to avoid justice?",
      "Should speech that spreads hatred be silenced?",
      "Do social movements need leaders?",
    ],
  },
  {
    tier: "Tier 4 — Personal & philosophical",
    questions: [
      "Is it better to be feared, loved, or right?",
      "Does suffering ennoble a cause or merely waste lives?",
      "Can one person remain moral while wielding power?",
      "Is hope a strategy or a delusion?",
    ],
  },
];

export const DEFAULT_QUESTION = QUESTION_GROUPS[0].questions[0];
