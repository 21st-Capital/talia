/**
 * A testnet 3-of-3 vault of the shape found in a phone test on 2026-07-28:
 * the primary leaf is an AND-chain, so the path needs THREE signatures.
 * Reading groups[0].threshold said ONE and the ceremony announced "enough
 * signatures collected" after a single key.
 *
 * Keys: published test seeds at m/48'/1'/0'/2', BIP-32 test vectors 1, 2 and 3
 * (3442193e, bd16bee5, 41d63b50) and the BIP-39 "abandon ... about" mnemonic
 * (73c5da0a, the timelocked key). Each internal key is the Liana unspendable
 * key for its tree.
 */
import { parsePolicy, pathRequirement, pathSatisfiedBy } from '../policy';

const TEST_VAULT = "tr(tpubD6NzVbkrYhZ4Wk6tpLPHgiGY79Fhkd8DzqbUzMQ5JVVSJBwsXuQYADyJjmYgvQNmamEWdHkF3eitmRMGxD2KgweT2GQb5QpyYgdFALgSgk2/<0;1>/*,{and_v(v:pk([73c5da0a/48'/1'/0'/2']tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/<0;1>/*),older(65535)),and_v(v:and_v(v:pk([3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg/<0;1>/*),pk([bd16bee5/48'/1'/0'/2']tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ/<0;1>/*)),pk([41d63b50/48'/1'/0'/2']tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr/<0;1>/*))})";

// The three keys of the primary path.
const CC1 = '3442193e';
const CC2 = 'bd16bee5';
const C21 = '41d63b50';

test('an AND-chain primary path needs EVERY key, not one', () => {
  const primary = parsePolicy(TEST_VAULT).paths[0];
  expect(pathRequirement(primary).needed).toBe(3);
  expect(pathRequirement(primary).keys).toHaveLength(3);
});

test('one signature does NOT satisfy it — the old bug', () => {
  const primary = parsePolicy(TEST_VAULT).paths[0];
  expect(pathSatisfiedBy(primary, [CC1])).toBe(false);
  expect(pathSatisfiedBy(primary, [CC1, CC2])).toBe(false);
  expect(pathSatisfiedBy(primary, [CC1, CC2, C21])).toBe(true);
});

test('the same key signing twice never stands in for another group', () => {
  const primary = parsePolicy(TEST_VAULT).paths[0];
  expect(pathSatisfiedBy(primary, [CC1, CC1, CC1])).toBe(false);
});

test('a 2-of-3 (multi_a) needs two of the three', () => {
  const d = `tr(tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ/<0;1>/*,multi_a(2,[3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg/<0;1>/*,[bd16bee5/48'/1'/0'/2']tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ/<0;1>/*,[41d63b50/48'/1'/0'/2']tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr/<0;1>/*))`;
  const primary = parsePolicy(d).paths[0];
  expect(pathRequirement(primary).needed).toBe(2);
  expect(pathSatisfiedBy(primary, [CC1])).toBe(false);
  expect(pathSatisfiedBy(primary, [CC1, C21])).toBe(true);
});
