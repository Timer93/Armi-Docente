import assert from 'node:assert/strict';
import { generateGeminiContent, generateGeminiContentStream } from '../utils/gemini.ts';
import { classifyAiIssue } from '../utils/aiErrors.ts';

const quotaError = new Error(JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota. GenerateRequestsPerDayPerProjectPerModel-FreeTier. Please check your plan and billing details.'
  }
}));

{
  const attempted = [];
  let selected = null;
  const unavailableModels = new Set();
  const ai = {
    models: {
      generateContent: async ({ model }) => {
        attempted.push(model);
        if (attempted.length === 1) throw quotaError;
        return { text: 'ok' };
      }
    }
  };

  const response = await generateGeminiContent(ai, { contents: [] }, 'gemini-3.5-flash', {
    unavailableModels,
    onModelSelected: (model, usedFallback) => { selected = { model, usedFallback }; }
  });
  assert.equal(response.text, 'ok');
  assert.deepEqual(attempted, ['gemini-3.5-flash', 'gemini-3-flash-preview']);
  assert.deepEqual(selected, { model: 'gemini-3-flash-preview', usedFallback: true });
  assert.deepEqual([...unavailableModels], ['gemini-3.5-flash']);

  await generateGeminiContent(ai, { contents: [] }, 'gemini-3-flash-preview', { unavailableModels });
  assert.deepEqual(attempted, ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3-flash-preview']);
}

{
  const attempted = [];
  let selected = null;
  const ai = {
    models: {
      generateContentStream: async ({ model }) => {
        attempted.push(model);
        return (async function* () {
          if (attempted.length === 1) throw quotaError;
          yield { text: '{"ok":true}' };
        })();
      }
    }
  };

  let text = '';
  const stream = await generateGeminiContentStream(ai, { contents: [] }, 'gemini-3.5-flash', {
    onModelSelected: (model, usedFallback) => { selected = { model, usedFallback }; }
  });
  for await (const chunk of stream) text += chunk.text;
  assert.equal(text, '{"ok":true}');
  assert.deepEqual(attempted, ['gemini-3.5-flash', 'gemini-3-flash-preview']);
  assert.deepEqual(selected, { model: 'gemini-3-flash-preview', usedFallback: true });
}

const issue = classifyAiIssue(quotaError);
assert.equal(issue.kind, 'quota_daily');
assert.ok(!issue.userMessage.includes('{'));

console.log('OK: Gemini cambia de modelo ante 429, incluso si el error aparece al leer el stream.');
