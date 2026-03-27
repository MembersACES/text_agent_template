#!/usr/bin/env node

const baseUrl = process.env.CHAT_HEALTH_BASE_URL ?? 'http://localhost:3000';
const agentId = process.env.CHAT_HEALTH_AGENT_ID ?? 'honest-to-goodness-agent';

const blockedResponses = [
  "I couldn't find an article that directly answers this in the help center. You can still contact Honest to Goodness support via phone, email or web forms if you'd like more help.",
  "I'm having trouble reaching the help center right now. Please try again in a moment or contact support via phone, email or web forms.",
];
const outOfScopeSafeFragments = [
  "i cannot generate custom dinner recipes",
  "i cannot provide health advice",
  "i cannot diagnose conditions",
  "for questions about plant diseases",
];

const singleTurnSuccessCases = [
  // HTG FAQs (6-8)
  'Do you offer Click & Collect?',
  'Do you deliver to PO Boxes?',
  'How can I change or cancel my order?',
  'What payment options do you offer?',
  'Do you offer free shipping?',
  'How do I track my order?',
  'What is your returns policy?',
  'Can I become a wholesale customer?',
  // Group Goodness flows (4-5)
  'What is Group Goodness?',
  'How do I join Group Goodness?',
  'How do I invite members?',
  'How do I reset my password in Group Goodness?',
  'How do I see what members added to cart?',
];

const outOfScopeExpectedNoResults = [
  'Can you generate a custom dinner recipe with photos?',
  'Please identify this plant disease from an image and suggest treatment.',
];

const forcedFallbackCases = [
  {
    label: 'forced no_results',
    message: '__HEALTH_FORCE_NO_RESULTS__ Please force the no results path.',
    expected: blockedResponses[0],
  },
  {
    label: 'forced error',
    message: '__HEALTH_FORCE_ERROR__ Please force the error path.',
    expected: blockedResponses[1],
  },
];

async function callChat(message) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversationHistory: [],
      useKnowledgeBase: true,
      agentId,
      uploadedFiles: [],
    }),
  });
  const data = await res.json();
  return {
    status: res.status,
    ok: res.ok,
    responseText: typeof data.response === 'string' ? data.response.trim() : '',
    error: data.error,
  };
}

async function run() {
  console.log(`[health-check] baseUrl=${baseUrl}`);
  console.log(`[health-check] agentId=${agentId}`);
  console.log(`[health-check] running ${singleTurnSuccessCases.length} success checks`);
  console.log(`[health-check] running ${outOfScopeExpectedNoResults.length} out-of-scope checks`);
  console.log(`[health-check] running ${forcedFallbackCases.length} forced fallback checks`);

  let failures = 0;

  for (const query of singleTurnSuccessCases) {
    try {
      const result = await callChat(query);
      const failed =
        !result.ok ||
        !result.responseText ||
        blockedResponses.includes(result.responseText);

      if (failed) {
        failures += 1;
        console.error(`FAIL [success-case]: "${query}"`);
        console.error(`  status=${result.status}`);
        console.error(`  response=${result.responseText || result.error || '<empty>'}`);
      } else {
        console.log(`PASS [success-case]: "${query}"`);
      }
    } catch (error) {
      failures += 1;
      console.error(`FAIL [success-case]: "${query}"`);
      console.error(`  error=${String(error)}`);
    }
  }

  for (const query of outOfScopeExpectedNoResults) {
    try {
      const result = await callChat(query);
      const normalizedResponse = result.responseText.toLowerCase();
      const isCanonicalNoResults = result.responseText === blockedResponses[0];
      const hasSafeRefusal = outOfScopeSafeFragments.some((fragment) => normalizedResponse.includes(fragment));
      const hasKbUnavailable = normalizedResponse.includes(blockedResponses[1].toLowerCase());
      const failed =
        !result.ok ||
        !result.responseText ||
        hasKbUnavailable ||
        (!isCanonicalNoResults && !hasSafeRefusal);

      if (failed) {
        failures += 1;
        console.error(`FAIL [out-of-scope/no-results]: "${query}"`);
        console.error(`  status=${result.status}`);
        console.error(`  response=${result.responseText || result.error || '<empty>'}`);
      } else {
        console.log(`PASS [out-of-scope/no-results]: "${query}"`);
      }
    } catch (error) {
      failures += 1;
      console.error(`FAIL [out-of-scope/no-results]: "${query}"`);
      console.error(`  error=${String(error)}`);
    }
  }

  for (const testCase of forcedFallbackCases) {
    try {
      const result = await callChat(testCase.message);
      const failed =
        !result.ok ||
        !result.responseText ||
        result.responseText !== testCase.expected;

      if (failed) {
        failures += 1;
        console.error(`FAIL [${testCase.label}]`);
        console.error(`  status=${result.status}`);
        console.error(`  response=${result.responseText || result.error || '<empty>'}`);
      } else {
        console.log(`PASS [${testCase.label}]`);
      }
    } catch (error) {
      failures += 1;
      console.error(`FAIL [${testCase.label}]`);
      console.error(`  error=${String(error)}`);
    }
  }

  if (failures > 0) {
    console.error(`[health-check] ${failures} failure(s).`);
    process.exit(1);
  }

  console.log('[health-check] all checks passed.');
}

run();
