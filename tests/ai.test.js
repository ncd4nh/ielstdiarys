const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handler = require('../api/ai');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('all providers: budgets, images, JSON, long-task exceptions and truncation', async () => {
  const original = global.fetch;
  try {
    for (const provider of ['anthropic', 'gemini', 'openai', 'openrouter', 'woku']) {
      for (const [tier, task, limit] of [['quick', undefined, 800], ['default', undefined, 2000], ['default', 'ielts_feedback', 8000], ['quick', 'ielts_feedback', 800], ['default', 'unknown', 2000]]) {
        let sent;
        global.fetch = async (url, options) => {
          sent = { url, body: JSON.parse(options.body) };
          return { ok: true, json: async () => provider === 'anthropic' ? { content: [{type: 'text', text: '{"ok":true}'}], stop_reason: 'max_tokens' } : provider === 'gemini' ? { candidates: [{content: {parts: [{text: '{"ok":true}'}]}, finishReason: 'MAX_TOKENS'}] } : {choices: [{message: {content: '{"ok":true}'}, finish_reason: 'length'}]} };
        };
        const res = response();
        await handler({method: 'POST', headers: {}, body: {provider, key: 'fake-key', tier, task, input: 'Evaluate essay', images: ['aGVsbG8=']}}, res);
        assert.equal(res.code, 200);
        assert.deepEqual(JSON.parse(res.body.text), {ok: true});
        assert.equal(res.body.truncated, true);
        const field = provider === 'gemini' ? sent.body.generationConfig.maxOutputTokens : sent.body[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'];
        assert.equal(field, limit);
        assert.ok(JSON.stringify(sent.body).includes('aGVsbG8='));
        if (provider === 'woku') assert.equal(sent.url, 'https://llm.wokushop.com/v1/chat/completions');
      }
    }
  } finally { global.fetch = original; }
});

test('permanent errors never retry; temporary errors may retry; backend sends once', async () => {
  const original = global.fetch;
  try {
    for (const [status, message, retry] of [[401, 'Invalid key', false], [404, 'Unknown model', false], [400, 'Invalid parameter', false], [429, 'Quota exhausted', false], [429, 'Rate limit exceeded', true], [503, 'Server unavailable', true]]) {
      let calls = 0;
      global.fetch = async () => { calls++; return {ok: false, status, json: async () => ({error: {message}})}; };
      const res = response();
      await handler({method: 'POST', headers: {}, body: {provider: 'woku', key: 'fake-key', input: 'Hi'}}, res);
      assert.equal(res.body.retry, retry);
      assert.equal(calls, 1);
    }
  } finally { global.fetch = original; }
});

test('all inline frontend scripts compile', () => {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=|application\/json/.test(match[1])) continue;
    new vm.Script(match[2]);
  }
});

test('JSON parser accepts complete JSON and refuses truncated JSON without another call', async () => {
  const source = html.slice(html.indexOf('  sample.json ='), html.indexOf('  sample.limits ='));
  for (const truncated of [false, true]) {
    let calls = 0;
    const context = {sample: {}, aiCall: async () => {calls++; return {text: '{"ok":true}', truncated};}};
    vm.runInNewContext(source, context);
    if (truncated) await assert.rejects(context.sample.json('Hi'), e => e.code === 'output_truncated');
    else assert.equal((await context.sample.json('Hi')).ok, true);
    assert.equal(calls, 1);
  }
});

test('action lock blocks rapid clicks through saving and releases after completion', async () => {
  const source = html.slice(html.indexOf('const aiActionsPending ='), html.indexOf('$("#celebrate").addEventListener'));
  let calls = 0, finish;
  const action = () => { calls++; return new Promise(resolve => {finish = resolve;}); };
  const ACT = Object.fromEntries(['wgrade', 'wgradeold', 'sgrade', 'sgradeold', 'solve', 'genquiz', 'ocr', 'wgen', 'sgen', 'enrich', 'enrichall'].map(name => [name, action]));
  vm.runInNewContext(source, {ACT});
  const first = ACT.wgrade();
  await ACT.wgrade();
  assert.equal(calls, 1);
  finish(); await first;
  const next = ACT.wgrade();
  assert.equal(calls, 2);
  finish(); await next;
});

test('frontend retry loop: permanent failure once, temporary failure at most three times', async () => {
  const source = html.slice(html.indexOf('  async function aiCall(input, opts, cfgOverride)'), html.indexOf('  function sample(input, opts)'));
  for (const retry of [false, true]) {
    let calls = 0, waits = 0;
    const context = {
      infoReady: Promise.resolve(), settings: {}, chainOf: () => ['woku'], toB64: async image => image,
      RETRY_WAIT: [1500, 4000], wait: async () => {waits++;},
      callOne: async () => {calls++; throw {code: 'upstream_error', retry};},
    };
    vm.runInNewContext(source, context);
    await assert.rejects(context.aiCall('Hi'));
    assert.equal(calls, retry ? 3 : 1);
    assert.equal(waits, retry ? 2 : 0);
  }
});

test('word lookup requests compact quick-tier JSON and saves only useful bounded details', async () => {
  const source = html.slice(html.indexOf('async function enrich(id)'), html.indexOf('async function saveGrammar('));
  const saved = [], requests = [];
  let result = {meaning_vi: 'bền vững', ipa: '/səˈsteɪnəbl/', pos: 'adjective', level: 'B2', examples: [{en: 'We need sustainable energy.', vi: 'Chúng ta cần năng lượng bền vững.'}, {en: 'extra'}, {en: 'extra'}], usage: ['note', 'extra'], collocations: ['sustainable energy', 'sustainable growth', 'extra'], synonyms: ['viable', 'lasting', 'extra'], family: ['sustain (v)', 'sustainability (n)', 'extra']};
  const context = {
    aiCtl: {}, find: () => ({word: 'sustainable', context: 'We need sustainable energy.'}),
    patch: async (kind, id, fields) => {saved.push(fields);},
    aiJson: async (key, prompt, opts) => {requests.push({key, prompt, opts}); return result;},
  };
  vm.runInNewContext(source, context);
  await context.enrich('word-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].opts.modelTier, 'quick');
  assert.match(requests[0].prompt, /450 output tokens/);
  assert.match(requests[0].prompt, /We need sustainable energy/);
  const entry = saved.at(-1);
  assert.equal(entry.aiStatus, 'done');
  assert.equal(entry.meaning_vi, 'bền vững');
  assert.equal(entry.examples.length, 1);
  assert.equal(entry.usage.length, 1);
  for (const field of ['collocations', 'synonyms', 'family']) assert.equal(entry[field].length, 2);
  result = {meaning_vi: ''};
  await context.enrich('word-2');
  assert.equal(saved.at(-1).aiStatus, 'error');
  assert.equal(saved.at(-1).meaning_vi, undefined);
});
