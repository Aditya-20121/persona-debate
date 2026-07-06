# Debate Questions — Gandhi vs Mandela vs Marx

Curated for the current lineup. Every question is designed so all three personas
genuinely disagree, maps onto the tagging taxonomy (so retrieval works), and can
be answered from episodes in their actual lives.

Expected positions: **G** = Gandhi, **M** = Mandela, **X** = Marx.

---

## Tier 1 — Strongest three-way clashes (start here)

1. **Is violence ever justified in the pursuit of justice?**
   G: never — means are the end in the making. M: as a last resort after peaceful avenues fail. X: revolutionary force is historically necessary.

2. **Does real change come from changing hearts or changing systems?**
   G: hearts — moral transformation first. X: systems — material conditions shape hearts. M: both, sequenced pragmatically.

3. **Should the oppressed forgive their oppressors?**
   M: yes — reconciliation is strategy and liberation. G: yes — but through the oppressor's own moral awakening. X: forgiveness without expropriation is surrender.

4. **Can a just end justify unjust means?**
   G: never — the means contaminate the end. X: history judges outcomes, not methods. M: depends what "unjust" means when the state itself is the aggressor.

5. **Is compromise with an unjust system betrayal or wisdom?**
   M: wisdom — negotiation ended apartheid without civil war. X: betrayal — the wage relation survived the handshake. G: neither — non-cooperation is the third path.

6. **Can great wealth ever be morally earned?**
   X: no — profit is unpaid labour. G: wealth held in trusteeship for society can be. M: wealth is legitimate if the system that produces it is just.

7. **Is poverty a moral failure or a structural one?**
   X: structural — produced by the mode of production. G: a failure of the wealthy's moral duty. M: structural, but dismantled through institutions, not revolution.

## Tier 2 — Strong, more specific angles

8. **Does religion liberate people or keep them obedient?**
   G: religion is the foundation of ethics and resistance. X: opium of the people — consolation that delays revolt. M: personal anchor, political irrelevance.

9. **Should property be a fundamental right?**
   X: abolish private property in the means of production. G: trusteeship — ownership as moral obligation. M: constitutional right with redistribution.

10. **Is the nation-state worth dying for?**
    G: no cause justifies killing, even freedom. M: the struggle, not the state, deserved sacrifice. X: workers have no country — class above nation.

11. **Do individuals make history, or do conditions make individuals?**
    X: conditions — men make history but not as they please. G: one person living truth can move millions. M: leadership is real but circumstance-bound.

12. **Is disobedience to law ever a duty?**
    G: yes — unjust law is itself a species of violence. M: yes — but organized, disciplined, accountable. X: legality is the ruling class's rulebook; the question is naive.

13. **Should the state redistribute wealth?**
    X: the state should own the means of production outright. M: yes — housing, education, land reform through democratic means. G: redistribution by state coercion corrupts; voluntary trusteeship transforms.

14. **Is education the most powerful weapon for changing the world?**
    M: yes — famously so. X: education under capitalism reproduces class ideology. G: education without character-building is dangerous.

15. **Can democracy and deep inequality coexist?**
    X: they must — formal equality masks material domination. M: uneasily — political freedom is hollow without economic dignity, but it is the tool to get there. G: village self-rule, not parliaments, is real democracy.

## Tier 3 — Timeless forms of "hot topics"

16. **Should workers own the companies they work for?**
    (Modern: co-ops, stock options, gig economy) X: obviously. G: trusteeship version. M: negotiated stakeholder model.

17. **Is global trade a force for liberation or exploitation?**
    (Modern: globalization) G: swadeshi — local self-reliance over dependence. X: capital expands globally and exploits globally. M: engagement with conditions.

18. **When machines do all the work, who should own what they produce?**
    (Modern: AI and automation) X: this is the final contradiction of capital. G: the spinning wheel argument — technology must serve dignity. M: the question is distribution, not machines.

19. **Is charity a virtue or a way to avoid justice?**
    (Modern: billionaire philanthropy) X: charity launders exploitation. G: giving without self-sacrifice is hollow. M: charity is bandage; justice is cure.

20. **Should speech that spreads hatred be silenced?**
    (Modern: content moderation) G: counter falsehood with truth-force, never suppression. M: constitutional limits after experiencing hate's consequences. X: ask first who owns the presses.

21. **Do social movements need leaders?**
    (Modern: decentralized movements) M: disciplined leadership won the struggle. G: the movement needs living examples, not commanders. X: the class, not the individual, is the protagonist.

## Tier 4 — Personal / philosophical (good for closing demos)

22. **Is it better to be feared, loved, or right?**
23. **Does suffering ennoble a cause or merely waste lives?**
24. **Can one person remain moral while wielding power?**
25. **Is hope a strategy or a delusion?**

---

## Usage

```json
POST /debate/start
{
  "question": "Is violence ever justified in the pursuit of justice?",
  "persona_ids": ["mandela", "gandhi", "marx"],
  "max_rounds": 2
}
```

Avoid: modern-tech phrasing ("Is AI dangerous?"), factual questions ("What is
communism?"), and two-way questions where the third persona has no stake — they
bypass the RAG grounding and produce generic role-play.
