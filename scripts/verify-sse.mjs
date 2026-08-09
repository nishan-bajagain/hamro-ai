#!/usr/bin/env node
/**
 * Unit test for lib/ai/sse.ts — the SSE parser powering the streaming core.
 *
 * Regression test: a multi-byte UTF-8 character (emoji / non-Latin text)
 * split across two network chunks must decode intact. The old implementation
 * created a fresh TextDecoder inside feed(), so `{ stream: true }` state was
 * reset on every call and split characters were corrupted into U+FFFD.
 *
 * Run: node scripts/verify-sse.mjs   (Node >= 23.6 runs TS natively)
 */
import { SseParser } from "../lib/ai/sse.ts";
import assert from "node:assert/strict";

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  \u2717 ${name}: ${e.message}`);
  }
}

const enc = new TextEncoder();
const EMOJI_FIRST_BYTE = enc.encode("\u{1F44B}")[0]; // 0xF0

check("emoji split across two chunks decodes intact", () => {
  const line = 'data: {"content": "\u{1F44B}\u{1F44B}"}\n\n';
  const bytes = enc.encode(line);
  const mid = bytes.indexOf(EMOJI_FIRST_BYTE) + 2; // split inside the first emoji
  assert.ok(mid > 0 && mid < bytes.length - 1, `mid=${mid} must be inside the payload`);
  const parser = new SseParser();
  const first = parser.feed(bytes.slice(0, mid));
  assert.deepEqual(first, [], "no complete event before the split char finishes");
  const second = parser.feed(bytes.slice(mid));
  assert.equal(second.length, 1);
  assert.equal(second[0], '{"content": "\u{1F44B}\u{1F44B}"}');
  assert.ok(!second[0].includes("\uFFFD"), "no replacement characters");
});

check("emoji split across many tiny 3-byte chunks", () => {
  const line = 'data: {"text": "h\u00E9llo \u4E16\u754C \u{1F44B}"}\n\n';
  const bytes = enc.encode(line);
  const parser = new SseParser();
  const events = [];
  for (let i = 0; i < bytes.length; i += 3) {
    events.push(...parser.feed(bytes.slice(i, i + 3)));
  }
  assert.equal(events.length, 1);
  assert.equal(events[0], '{"text": "h\u00E9llo \u4E16\u754C \u{1F44B}"}');
  assert.ok(!events[0].includes("\uFFFD"));
});

check("flush() keeps a complete trailing emoji intact (line ends, no blank line at EOF)", () => {
  const line = 'data: {"x": "\u{1F44B}"}\n'; // complete line + \n, but NO blank line
  const parser = new SseParser();
  assert.deepEqual(parser.feed(enc.encode(line)), []);
  const out = parser.flush();
  assert.equal(out.length, 1);
  assert.equal(out[0], '{"x": "\u{1F44B}"}');
  assert.ok(!out[0].includes("\uFFFD"));
});

check("flush() survives a stream genuinely truncated mid-emoji", () => {
  const part = enc.encode('data: {"x": "\u{1F44B}"}\n\n');
  const mid = part.indexOf(EMOJI_FIRST_BYTE) + 1; // stream ends with 1 of 4 bytes
  const parser = new SseParser();
  assert.deepEqual(parser.feed(part.slice(0, mid)), [], "mid-emoji chunk yields nothing");
  assert.doesNotThrow(() => parser.flush());
});

check("flush() emits a payload that ended without a blank line", () => {
  const parser = new SseParser();
  assert.deepEqual(parser.feed(enc.encode('data: {"a":1}\n')), []);
  assert.deepEqual(parser.flush(), ['{"a":1}']);
});

check("multi-line data payloads join with \\n", () => {
  const parser = new SseParser();
  const evts = parser.feed(enc.encode("data: line1\ndata: line2\n\n"));
  assert.deepEqual(evts, ["line1\nline2"]);
});

check("CRLF line endings are handled", () => {
  const parser = new SseParser();
  const evts = parser.feed(enc.encode('data: {"a":1}\r\n\r\n'));
  assert.deepEqual(evts, ['{"a":1}']);
});

check("comments and empty data lines are ignored", () => {
  const parser = new SseParser();
  const evts = parser.feed(enc.encode(": ping\ndata:\n\n"));
  assert.deepEqual(evts, [""]);
});

console.log(
  failures === 0
    ? "\nAll SSE checks passed \u2705"
    : `\n${failures} check(s) FAILED \u274C`,
);
process.exit(failures === 0 ? 0 : 1);
