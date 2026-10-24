import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUsername,
  usernameFromNickname,
  withUsernameSuffix,
  USERNAME_MAX
} from '../usernames.js';

const refused = (raw, pattern) => assert.throws(() => validateUsername(raw), pattern);

describe('validateUsername', () => {
  test('keeps the typed case and lowercases the key', () => {
    assert.deepEqual(validateUsername('CookWithTristan'), { username: 'CookWithTristan', usernameLower: 'cookwithtristan' });
  });
  test('trims surrounding whitespace only', () => {
    assert.equal(validateUsername('  tristan  ').username, 'tristan');
  });
  test('allows underscores and hyphens inside', () => {
    assert.equal(validateUsername('cook_with-tristan').usernameLower, 'cook_with-tristan');
  });
  test('length limits', () => {
    refused('ab', /at least 3/);
    refused('a'.repeat(USERNAME_MAX + 1), /at most 30/);
    assert.equal(validateUsername('a'.repeat(USERNAME_MAX)).username.length, USERNAME_MAX);
  });
  test('shape', () => {
    refused('tristan mikie', /letters, numbers/);
    refused('tristan.m', /letters, numbers/);
    refused('-tristan', /letters, numbers/);
    refused('tristan_', /letters, numbers/);
    refused('tristan!', /letters, numbers/);
    refused('tristan@mail', /letters, numbers/);
    refused('тристан', /letters, numbers/);
  });
  test('reserved names, in any case', () => {
    refused('admin', /reserved/);
    refused('ADMIN', /reserved/);
    refused('recipes', /reserved/);
    refused('profile', /reserved/);
    refused('cookingwtristan', /reserved/);
  });
  test('profanity, including obfuscated spellings', () => {
    refused('fuckface', /isn't allowed/);
    refused('sh1t_head', /isn't allowed/);
    refused('b1tch-please', /isn't allowed/);
  });
  test('non-strings', () => {
    refused(null, /must be text/);
    refused(42, /must be text/);
  });
});

describe('usernameFromNickname', () => {
  test('keeps a valid nickname as is', () => {
    assert.equal(usernameFromNickname('tristanmikie'), 'tristanmikie');
  });
  test('replaces invalid characters with hyphens and trims separators', () => {
    assert.equal(usernameFromNickname('tristan mikie'), 'tristan-mikie');
    assert.equal(usernameFromNickname('tristan.mikie@gmail.com'), 'tristan-mikie-gmail-com');
    assert.equal(usernameFromNickname('__tristan__'), 'tristan');
  });
  test('strips accents and non-ASCII', () => {
    assert.equal(usernameFromNickname('Crème Brûlée'), 'Creme-Brulee');
  });
  test('cuts to the maximum length without a trailing separator', () => {
    const long = usernameFromNickname('a'.repeat(29) + '-' + 'b'.repeat(10));
    assert.ok(long.length <= USERNAME_MAX);
    assert.ok(!long.endsWith('-'));
  });
  test('falls back to a generated name when nothing usable is left', () => {
    for(const bad of ['', null, undefined, 'ab', '한국어', 'admin', 'fuckface']){
      const name = usernameFromNickname(bad);
      assert.match(name, /^cook-[0-9a-f]{6}$/, `for ${JSON.stringify(bad)} got ${name}`);
    }
  });
});

describe('withUsernameSuffix', () => {
  test('appends a short random suffix', () => {
    assert.match(withUsernameSuffix('tristan'), /^tristan-[0-9a-f]{4}$/);
  });
  test('stays within the length limit', () => {
    const name = withUsernameSuffix('a'.repeat(USERNAME_MAX));
    assert.equal(name.length, USERNAME_MAX);
    assert.match(name, /-[0-9a-f]{4}$/);
  });
});
