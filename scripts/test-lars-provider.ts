/**
 * @file scripts/test-lars-provider.ts
 *
 * This script provides a comprehensive, standalone end-to-end integration test
 * for the custom LARS provider. It is designed to be run from the command line
 * to validate the entire system.
 *
 * It validates the entire request lifecycle for multiple test cases:
 * 1. Creates a new conversation thread via the REST API for each test.
 * 2. Calls the provider's `doStream` method directly to get the raw stream.
 * 3. Consumes, logs, and validates each part of the stream (`data`, `reasoning`, `text`).
 *
 * ---
 *
 * ### Prerequisites:
 * 1. Your LARS backend server must be running.
 * 2. You must have a valid Auth0 Bearer Token.
 *
 * ### Setup:
 * 1. Install dependencies:
 * `npm install ai dotenv tsx`
 * 2. Create a `.env` file in the root of your project.
 * 3. Add your credentials and API URL to the `.env` file:
 * LARS_API_BASE_URL="http://127.0.0.1:8000"
 * AUTH0_BEARER_TOKEN="your_valid_token_here"
 *
 * ### To Run the Test:
 * `npx tsx scripts/test-lars-provider.ts`
 */

import 'dotenv/config';
import { createLars } from '../src/lars-provider';
import { LarsLanguageModel } from '../src/lars-language-model';

// --- Test Case Definitions ---

const SIMPLE_TEST_CASE = {
  modelId: 'caselaw',
  name: 'Simple Extraction: Mayo Two-Step Test',
  url: 'https://supreme.justia.com/cases/federal/us/566/10-1150/case.pdf',
  query:
    'What is the two-step test articulated by the Supreme Court in this case?',
};

const COMPLEX_TEST_CASE = {
  modelId: 'caselaw',
  name: 'Complex Analysis: Alice Corp. Strategic Implications',
  url: 'https://supreme.justia.com/cases/federal/us/573/13-298/case.pdf',
  query:
    'Provide a high-level strategic analysis of Alice Corp. v. CLS Bank for a partner-level meeting. Focus on the refinement of the Mayo framework, the practical application of the "inventive concept", and actionable client guidance for drafting software patent claims.',
};

// --- Configuration from Environment Variables ---
const LARS_API_URL = process.env.LARS_API_BASE_URL ?? 'http://127.0.0.1:8000';
const AUTH_TOKEN = process.env.AUTH0_BEARER_TOKEN;

// --- Provider Instantiation ---
const lars = createLars();

/**
 * Creates a new conversation thread by calling the backend's REST API.
 * @returns The UUID of the newly created thread.
 */
async function createTestThread(testCase: {
  modelId: string;
  url: string;
}): Promise<string> {
  console.log('--- Step 1: Creating new conversation thread... ---');

  const response = await fetch(`${LARS_API_URL}/api/v1/threads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      model_id: testCase.modelId,
      initial_context: { opinion_url: testCase.url },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Failed to create thread. Status: ${response.status}. Body: ${errorBody}`,
    );
  }

  const data = await response.json();
  const threadId = data.id;
  console.log(`✅ Thread created successfully with ID: ${threadId}`);
  return threadId;
}

/**
 * Runs the main streaming test by calling the provider's `doStream` method directly.
 * @param threadId The ID of the thread to continue the conversation in.
 * @param testCase The test case containing the query and modelId.
 */
async function runStreamingTest(
  threadId: string,
  testCase: { modelId: string; query: string },
) {
  console.log('\n--- Step 2: Starting streaming chat with LARS provider... ---');

  const model = lars.languageModel(testCase.modelId) as LarsLanguageModel;
  (model as any).debug = true; // Enable provider-level debug logging

  const { stream } = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: testCase.query }] }],
    providerOptions: {
      threadId: threadId,
    },
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });

  console.log('\n--- Agent Response Stream (Raw Parts) ---');

  const reader = stream.getReader();
  let fullResponseText = '';
  let receivedData: unknown | undefined;

  while (true) {
    const { done, value: part } = await reader.read();
    if (done) {
      break;
    }

    console.log(`[STREAM PART RECEIVED]:`, part);

    switch (part.type) {
      case 'data':
        receivedData = part.data;
        break;
      case 'text-delta':
        fullResponseText += part.delta;
        break;
    }
  }

  console.log('\n--- Final Rendered Text ---');
  console.log(fullResponseText);
  console.log('---------------------------\n');

  if (!receivedData) {
    throw new Error('Test failed: Did not receive metadata `data` part.');
  }
  if (fullResponseText.trim() === '') {
    throw new Error('Test failed: The streamed response was empty.');
  }
  console.log('--- Stream Finished ---');
}

/**
 * Main function to orchestrate the test suite.
 */
async function main() {
  console.log('=================================================');
  console.log('🚀 Starting LARS Provider End-to-End Test Suite 🚀');
  console.log('=================================================\n');

  if (!AUTH_TOKEN || AUTH_TOKEN === 'your_valid_token_here') {
    console.error(
      '❌ CRITICAL ERROR: AUTH0_BEARER_TOKEN is not set in your .env file.',
    );
    process.exit(1);
  }

  try {
    // --- Test Case 1: Simple Extraction ---
    console.log(`\n\n--- Running Test Case: ${SIMPLE_TEST_CASE.name} ---`);
    const simpleThreadId = await createTestThread(SIMPLE_TEST_CASE);
    await runStreamingTest(simpleThreadId, SIMPLE_TEST_CASE);
    console.log(`✅ Test Case Passed: ${SIMPLE_TEST_CASE.name}`);

    // --- Test Case 2: Complex Analysis ---
    console.log(`\n\n--- Running Test Case: ${COMPLEX_TEST_CASE.name} ---`);
    const complexThreadId = await createTestThread(COMPLEX_TEST_CASE);
    await runStreamingTest(complexThreadId, COMPLEX_TEST_CASE);
    console.log(`✅ Test Case Passed: ${COMPLEX_TEST_CASE.name}`);

    console.log('\n\n🎉 All tests completed successfully! 🎉');
  } catch (error) {
    console.error('\n🔥 A test case failed with an error: 🔥');
    console.error(error);
    process.exit(1);
  }
}

main();
