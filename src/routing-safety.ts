import type { JsonObject } from './contracts.ts';
import { object } from './validation.ts';

export const preciseRoutingInstructions = `
Routing-precision experiment. Preserve every rule and exception in the original briefs. This variant replaces the earlier preference for broad matches_intent routing at stage exits.
Keep the graph as small as the source policy allows, but never omit a required stage or outcome to reduce its size. Reuse stages where their behavior is the same instead of creating a node for each phrase, case, or closing outcome. Each extra node and route is another opportunity for an incorrect branch or loop; graph size alone does not determine quality.
Separate contact establishment, security verification, account work, and final closure when their decisions differ. Where the source requires security questions, a confirmed speaker proceeds to that stage; confirming a name alone must never enter closing. The closing stage only explains an already-decided outcome and calls the required final bank tool. It must not conduct security questions, negotiate, or schedule a callback. Give finalization an explicit terminal path so the call cannot loop after its required bank action.
Each matches_intent condition should describe one concrete, positive customer signal. Put distinct events in distinct transitions; do not combine unrelated endings, history-dependent counts, or an absence of information into one intent condition. Put the third-party route before the wrong-number route; a relative answering is not evidence that the number is wrong. Reserve wrong-number for an explicit statement that the number does not belong to the named customer.
The platform's routing_prompt replaces its default intent-matching instruction. Omit routing_prompt on nodes with matches_intent routes unless the transition descriptions cannot express a necessary rule. If one is essential, explicitly tell the router to choose among the listed conditions, and include the source-derived priority and stay behavior. A vague routing_prompt can suppress all exits even when a customer clearly matches one.
When a stage has many speech choices, prefer source-supported state and clear stage boundaries to narrow the decision. Do not combine distinct outcomes into a broad intent description just to reduce route count. Do not add extraction fields solely to reduce route count: stale or rejected extraction values can cause a wrong branch. A dialogue stage must not say goodbye and then rely on an intent route to leave; route to finalization first and end the call there.
Use deterministic variable conditions for results of bank tools and code. Advance after authoritative tool results, not on an inference from the customer's words. For decisions across multiple turns, maintain explicit state; never rely on a broad history-based exit. Provide an always fallback back to the active stage.
For a source rule that must react immediately to a bank-tool result, collect the needed customer answer in a conversation stage, then execute the bank tool in an api_request stage and route on its result before another dialogue stage speaks. Do not let a dialogue node call that tool on entry before it has collected an answer. Do not assume a conversation-node tool result will advance the graph before the dialogue model speaks again.
When the source requires a confirmed callback or other later write, make the accepted confirmation an explicit transition to the actual bank-tool stage; saying that a call is booked or printing a pseudo-tool command does not perform the write. After the tool result, route to a real finalization stage. For source-required one-time dialogue, such as a single sympathy sentence or a required clarification, track whether it was already said so a stage handoff does not repeat it.
Before claiming verification failure, inspect an actual verification result. Before saying a callback was scheduled, call the callback tool and check its result. Before a payment write, validate the exact amount and date against the source policy and the customer's confirmation; do not let dialogue alone choose a value outside those bounds. Keep all tool arguments and outcome values grounded in the supplied briefs and OpenAPI. Do not add business rules for known practice cases.
This is still one generation call. If you cannot represent an exit without a broad intent condition, report the uncertainty instead of silently routing to closure.`;

function countIntents(condition: unknown): number {
  if (!object(condition)) {
    return 0;
  }
  const own = condition.operator === 'matches_intent' ? 1 : 0;
  return (
    own +
    (Array.isArray(condition.conditions)
      ? condition.conditions.reduce((sum: number, child: unknown) => sum + countIntents(child), 0)
      : 0)
  );
}

export function routingComplexity(workflow: JsonObject): {
  nodes: number;
  transitions: number;
  maxIntentRoutesPerNode: number;
  customRoutingPrompts: number;
} {
  let nodes = 0;
  let transitions = 0;
  let maxIntentRoutesPerNode = 0;
  let customRoutingPrompts = 0;
  for (const section of ['nodes', 'global_nodes']) {
    const group = workflow[section];
    if (!object(group)) {
      continue;
    }
    for (const node of Object.values(group)) {
      nodes += 1;
      if (!object(node) || !Array.isArray(node.transitions)) {
        continue;
      }
      if (typeof node.routing_prompt === 'string' && node.routing_prompt.trim()) {
        customRoutingPrompts += 1;
      }
      transitions += node.transitions.length;
      const intents = node.transitions.reduce(
        (sum: number, transition: unknown) =>
          sum + (object(transition) ? countIntents(transition.condition) : 0),
        0,
      );
      maxIntentRoutesPerNode = Math.max(maxIntentRoutesPerNode, intents);
    }
  }
  return { nodes, transitions, maxIntentRoutesPerNode, customRoutingPrompts };
}

export function routingSafetyIssues(workflow: JsonObject): string[] {
  const issues: string[] = [];
  function checkCondition(condition: unknown, path: string): void {
    if (!object(condition)) {
      return;
    }
    if (
      condition.operator === 'matches_intent' &&
      (typeof condition.description !== 'string' || !condition.description.trim())
    ) {
      issues.push(`${path}: matches_intent needs a nonempty description.`);
    }
    if (Array.isArray(condition.conditions)) {
      condition.conditions.forEach((child, index) =>
        checkCondition(child, `${path}.conditions[${index}]`),
      );
    }
  }
  for (const section of ['nodes', 'global_nodes']) {
    const nodes = workflow[section];
    if (!object(nodes)) {
      continue;
    }
    for (const [name, node] of Object.entries(nodes)) {
      if (!object(node) || !Array.isArray(node.transitions)) {
        continue;
      }
      node.transitions.forEach((transition, index) => {
        if (object(transition)) {
          checkCondition(transition.condition, `${section}.${name}.transitions[${index}]`);
        }
      });
    }
  }
  return issues;
}
