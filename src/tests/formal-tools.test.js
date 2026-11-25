'use strict';

const assert = require('node:assert/strict');
const Formal = require('../formal-tools.js');

const endsInOne = {
  state: 'q0',
  states: ['q0', 'q1', 'unreachable'],
  alphabet: ['0', '1'],
  acceptingStates: ['q1'],
  transitions: {
    q0: { '0': 'q0', '1': 'q1' },
    q1: { '0': 'q0', '1': 'q1' },
    unreachable: { '0': 'unreachable', '1': 'unreachable' }
  }
};

const epsilonNfa = {
  state: 's',
  states: ['s', 'a', 'b'],
  alphabet: ['0', '1'],
  acceptingStates: ['b'],
  transitions: {
    s: { 'ε': ['a', 'b'], '0': ['a'] },
    a: { '1': ['b'] },
    b: {}
  }
};

function runDfa(machine, word) {
  let state = machine.state;
  for (const symbol of word) {
    const row = machine.transitions[String(state)] || {};
    state = row[symbol];
    if (state === undefined || state === null) return false;
  }
  return (machine.acceptingStates || []).some((stateValue) => String(stateValue?.id ?? stateValue) === String(state?.id ?? state));
}

function allWords(alphabet, maxLength) {
  const words = [[]];
  let level = [[]];
  for (let length = 1; length <= maxLength; length += 1) {
    level = level.flatMap((prefix) => alphabet.map((symbol) => [...prefix, symbol]));
    words.push(...level);
  }
  return words;
}

function test(name, callback) {
  callback();
  process.stdout.write(`✓ ${name}\n`);
}

test('analyzes DFA properties and inaccessible states', () => {
  const report = Formal.analyze(endsInOne);
  assert.equal(report.deterministic, true);
  assert.equal(report.complete, true);
  assert.deepEqual(report.inaccessible, [Formal.stateKey('unreachable')]);
  assert.equal(report.minimal, false);
});

test('builds a transition table with state markers', () => {
  const table = Formal.transitionTable(endsInOne);
  assert.deepEqual(table.columns.map((column) => column.label), ['0', '1']);
  assert.equal(table.rows[0].initial, true);
  assert.equal(table.rows[1].accepting, true);
});

test('classifies empty, finite and infinite regular languages', () => {
  const finite = { state: 's', states: ['s', 'f'], alphabet: ['a', 'b'], acceptingStates: ['f'], transitions: { s: { a: 'f' } } };
  const empty = { state: 's', states: ['s'], alphabet: ['a'], acceptingStates: [], transitions: { s: { a: 's' } } };
  const epsilonLoopOnly = { state: 's', states: ['s', 'f'], alphabet: ['a'], acceptingStates: ['f'], transitions: { s: { 'ε': ['s', 'f'] } } };
  const infiniteEpsilonNfa = { state: 's', states: ['s', 'a', 'f'], alphabet: ['0', '1'], acceptingStates: ['f'], transitions: { s: { 'ε': 'a' }, a: { '0': 'a', '1': 'f' } } };
  assert.equal(Formal.analyze(finite).languageEmpty, false);
  assert.equal(Formal.analyze(finite).languageInfinite, false);
  assert.equal(Formal.analyze(empty).languageEmpty, true);
  assert.equal(Formal.analyze(empty).languageInfinite, false);
  assert.equal(Formal.analyze(epsilonLoopOnly).languageInfinite, false);
  assert.equal(Formal.analyze(endsInOne).languageInfinite, true);
  assert.equal(Formal.analyze(infiniteEpsilonNfa).languageInfinite, true);
  assert.equal(Formal.analyze(epsilonNfa).languageInfinite, false);
});

test('determinizes an epsilon-NFA with epsilon closure', () => {
  const result = Formal.determinize(epsilonNfa);
  const report = Formal.analyze(result);
  assert.equal(report.deterministic, true);
  assert.equal(report.complete, true);
  assert.ok(result.states[0].label.includes('s'));
  assert.equal(Formal.compare(epsilonNfa, result).equivalent, true);
});

test('minimizes a DFA and preserves its language', () => {
  const result = Formal.minimize(endsInOne);
  assert.equal(result.states.length, 2);
  assert.equal(Formal.analyze(result).minimal, true);
  assert.equal(Formal.compare(endsInOne, result).equivalent, true);
});

test('completes partial DFAs with an implicit sink during minimization', () => {
  const partial = {
    state: 'p', states: ['p', 'f'], alphabet: ['a', 'b'], acceptingStates: ['f'],
    transitions: { p: { a: 'f' }, f: { b: 'f' } }
  };
  const result = Formal.minimize(partial);
  assert.equal(result.completedWithSink, true);
  assert.equal(Formal.analyze(result).complete, true);
  assert.equal(Formal.compare(partial, result).equivalent, true);
});

test('finds a shortest distinguishing word', () => {
  const empty = { state: 'x', states: ['x'], alphabet: ['0', '1'], acceptingStates: [], transitions: { x: { '0': 'x', '1': 'x' } } };
  const result = Formal.compare(endsInOne, empty);
  assert.equal(result.equivalent, false);
  assert.deepEqual(result.witness, ['1']);
  assert.equal(result.acceptsA, true);
  assert.equal(result.acceptsB, false);
});

test('converts a DFA to a regex preserving all words through length 6', () => {
  const simpleDfa = {
    state: 'q0', states: ['q0', 'q1'], alphabet: ['0', '1'], acceptingStates: ['q1'],
    transitions: { q0: { '0': 'q0', '1': 'q1' }, q1: { '0': 'q0', '1': 'q1' } }
  };
  const expression = Formal.toRegularExpression(simpleDfa).expression.replaceAll('ε', '').replaceAll('∅', '(?!)');
  const regex = new RegExp(`^(?:${expression})$`);
  for (const word of allWords(['0', '1'], 6)) {
    const text = word.join('');
    assert.equal(regex.test(text), runDfa(simpleDfa, word), `word ${JSON.stringify(text)}`);
  }
});

test('converts an epsilon-NFA to a regex preserving epsilon and non-empty words', () => {
  const acceptsZeroOrMoreZerosThenOne = {
    state: 's', states: ['s', 'a', 'f'], alphabet: ['0', '1'], acceptingStates: ['f'],
    transitions: { s: { 'ε': ['a'] }, a: { '0': 'a', '1': 'f' } }
  };
  const expression = Formal.toRegularExpression(acceptsZeroOrMoreZerosThenOne).expression.replaceAll('ε', '').replaceAll('∅', '(?!)');
  const regex = new RegExp(`^(?:${expression})$`);
  const determinized = Formal.determinize(acceptsZeroOrMoreZerosThenOne);
  for (const word of allWords(['0', '1'], 6)) {
    const text = word.join('');
    assert.equal(regex.test(text), runDfa(determinized, word), `word ${JSON.stringify(text)}`);
  }
});

test('keeps epsilon-only languages in regular-expression output', () => {
  const epsilonOnly = {
    state: 'start', states: ['start', 'final'], alphabet: ['a'], acceptingStates: ['final'],
    transitions: { start: { 'ε': 'final' } }
  };
  assert.equal(Formal.toRegularExpression(epsilonOnly).expression, 'ε');
});

process.stdout.write('All formal-tools tests passed.\n');
