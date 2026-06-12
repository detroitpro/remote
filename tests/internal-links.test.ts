import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSER_UUID_RE,
  hrefMatchesTranscriptTarget,
  isExternalHref,
  parseInternalTranscriptLink,
} from '../src/shared/internal-links.js';

const SAMPLE_ID = '20b84d75-86d1-4a78-a39f-aef31feedcfb';

describe('internal-links', () => {
  it('recognizes bare composer UUID hrefs', () => {
    const parsed = parseInternalTranscriptLink(SAMPLE_ID);
    assert.equal(parsed?.composerId, SAMPLE_ID);
    assert.equal(parsed?.href, SAMPLE_ID);
    assert.ok(COMPOSER_UUID_RE.test(SAMPLE_ID));
  });

  it('recognizes agent-transcripts relative paths', () => {
    const href = `agent-transcripts/${SAMPLE_ID}.jsonl`;
    const parsed = parseInternalTranscriptLink(href);
    assert.equal(parsed?.composerId, SAMPLE_ID);
  });

  it('recognizes slash-prefixed UUID paths', () => {
    const parsed = parseInternalTranscriptLink(`/${SAMPLE_ID}`);
    assert.equal(parsed?.composerId, SAMPLE_ID);
  });

  it('treats http(s) and mailto as external', () => {
    assert.equal(isExternalHref('https://example.com'), true);
    assert.equal(isExternalHref('http://localhost:3001/foo'), true);
    assert.equal(isExternalHref('mailto:user@example.com'), true);
    assert.equal(parseInternalTranscriptLink('https://example.com'), null);
  });

  it('returns null for unrelated relative paths', () => {
    assert.equal(parseInternalTranscriptLink('/login'), null);
    assert.equal(parseInternalTranscriptLink('docs/readme.md'), null);
  });

  it('matches transcript targets across href variants', () => {
    assert.equal(hrefMatchesTranscriptTarget(SAMPLE_ID, SAMPLE_ID), true);
    assert.equal(
      hrefMatchesTranscriptTarget(`agent-transcripts/${SAMPLE_ID}.jsonl`, SAMPLE_ID),
      true,
    );
    assert.equal(hrefMatchesTranscriptTarget('https://example.com', SAMPLE_ID), false);
  });
});
