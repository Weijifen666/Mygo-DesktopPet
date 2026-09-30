const assert = require('node:assert/strict');
const { AwarenessPolicy } = require('./awareness-policy.cjs');

const policy = new AwarenessPolicy({ stableMs: 120000, cooldownMs: 600000 });
assert.equal(policy.observe('Code', 1000), false);
assert.equal(policy.observe('Code', 120999), false);
assert.equal(policy.observe('Code', 121000), true);
policy.markReaction(121000);
assert.equal(policy.observe('Code', 720999), false);
assert.equal(policy.observe('Code', 721000), true);
assert.equal(policy.observe('Chrome', 721001), false);
assert.equal(policy.observe('Chrome', 841001), true);
console.log('awareness policy: ok');
