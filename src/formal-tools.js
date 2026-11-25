/*
 * Automata Playground — formal language and automata algorithms.
 * Offline, dependency-free utilities for the conventional `transitions` map.
 * Custom JavaScript transition rules remain unrestricted, but cannot be
 * inferred by these static formal analyses.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutomataFormal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const stateId = (value) => value && typeof value === 'object' && !Array.isArray(value) && own(value, 'id') ? value.id : value;
  const stateKey = (value) => {
    const id = stateId(value);
    if (id === null) return 'null';
    if (typeof id === 'object') return `object:${JSON.stringify(id)}`;
    return `${typeof id}:${String(id)}`;
  };
  const stateLabel = (value) => {
    if (value === null) return 'null';
    if (value && typeof value === 'object' && !Array.isArray(value)) return String(value.label ?? value.name ?? value.id ?? JSON.stringify(value));
    if (Array.isArray(value)) return `{${value.map(stateLabel).join(', ')}}`;
    return String(value);
  };
  const unique = (items, key = (item) => JSON.stringify(item)) => {
    const seen = new Set();
    return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
  };

  function getModel(machine) {
    if (!machine || typeof machine !== 'object') throw new Error('Definição da máquina ausente.');
    if (!Array.isArray(machine.states) || !Array.isArray(machine.alphabet)) throw new Error('A análise formal exige os campos states e alphabet como listas.');
    if (!machine.transitions || typeof machine.transitions !== 'object' || Array.isArray(machine.transitions)) throw new Error('A análise formal exige transitions como mapa estado → símbolo → destino.');
    const states = machine.states.slice();
    const keys = states.map(stateKey);
    if (new Set(keys).size !== keys.length) throw new Error('Existem estados duplicados; corrija a definição antes da análise formal.');
    const stateByKey = new Map(states.map((state, index) => [keys[index], state]));
    const transitionNames = states.map((state) => String(stateId(state)));
    if (new Set(transitionNames).size !== transitionNames.length) throw new Error('Dois estados têm o mesmo identificador textual; a tabela transitions não consegue distingui-los.');
    const stateKeyByTransitionName = new Map(states.map((state, index) => [transitionNames[index], keys[index]]));
    const alphabet = unique(machine.alphabet, (symbol) => `${typeof symbol}:${String(symbol)}`);
    const alphaNames = alphabet.map(String);
    if (new Set(alphaNames).size !== alphaNames.length) throw new Error('O alfabeto possui símbolos com a mesma representação textual; use símbolos string distintos.');
    const startValue = own(machine, 'initialState') ? machine.initialState : machine.state;
    const start = stateKey(startValue);
    if (!stateByKey.has(start)) throw new Error('O estado inicial não está declarado em states.');
    const acceptingValues = Array.isArray(machine.acceptingStates) ? machine.acceptingStates : [];
    const accepting = new Set(acceptingValues.map(stateKey));
    for (const key of accepting) if (!stateByKey.has(key)) throw new Error('Há um estado de aceitação que não está declarado em states.');

    const transitions = new Map(keys.map((key) => [key, new Map()]));
    for (const [fromName, bySymbol] of Object.entries(machine.transitions)) {
      const fromKey = stateKeyByTransitionName.get(fromName);
      if (!fromKey) throw new Error(`A origem de transição "${fromName}" não corresponde a um estado declarado.`);
      if (!bySymbol || typeof bySymbol !== 'object' || Array.isArray(bySymbol)) throw new Error(`As transições de ${fromName} precisam formar um mapa.`);
      for (const [symbol, rawTargets] of Object.entries(bySymbol)) {
        const targets = Array.isArray(rawTargets) ? rawTargets.slice() : [rawTargets];
        const normalized = [];
        for (const target of targets) {
          if (target === null) continue; // null is a halt marker, not a formal state.
          const key = stateKey(target);
          if (!stateByKey.has(key)) throw new Error(`A transição ${fromName} / ${symbol} aponta para um estado inexistente (${stateLabel(target)}).`);
          if (!normalized.includes(key)) normalized.push(key);
        }
        transitions.get(fromKey).set(symbol, normalized);
      }
    }

    const hasTransitionKey = (candidate) => Array.from(transitions.values()).some((map) => map.has(candidate));
    let epsilonSymbol = null;
    if (typeof machine.epsilonSymbol === 'string') epsilonSymbol = machine.epsilonSymbol;
    else if (!alphaNames.includes('ε') && hasTransitionKey('ε')) epsilonSymbol = 'ε';
    else if (!alphaNames.includes('epsilon') && hasTransitionKey('epsilon')) epsilonSymbol = 'epsilon';
    if (epsilonSymbol !== null && alphaNames.includes(epsilonSymbol)) throw new Error('epsilonSymbol não pode fazer parte de alphabet; a transição epsilon não consome entrada.');
    for (const [fromKey, row] of transitions) {
      for (const symbol of row.keys()) {
        if (!alphaNames.includes(symbol) && symbol !== epsilonSymbol) {
          throw new Error(`A transição do estado ${stateLabel(stateByKey.get(fromKey))} usa o símbolo "${symbol}", que não pertence ao alfabeto e não foi declarado como epsilon.`);
        }
      }
    }
    const stateIndex = new Map(keys.map((key, index) => [key, index]));
    return { machine, states, keys, stateByKey, stateIndex, alphabet, alphaNames, start, startValue, accepting, transitions, epsilonSymbol };
  }

  function edgesFrom(model, key, includeEpsilon = true) {
    const map = model.transitions.get(key) || new Map();
    const result = [];
    for (const [symbol, targets] of map) {
      if (!includeEpsilon && symbol === model.epsilonSymbol) continue;
      targets.forEach((target) => result.push({ symbol, target }));
    }
    return result;
  }

  function reachableKeys(model) {
    const seen = new Set([model.start]);
    const queue = [model.start];
    for (let i = 0; i < queue.length; i += 1) {
      for (const edge of edgesFrom(model, queue[i], true)) {
        if (!seen.has(edge.target)) { seen.add(edge.target); queue.push(edge.target); }
      }
    }
    return seen;
  }

  function reverseReachable(model) {
    const reverse = new Map(model.keys.map((key) => [key, []]));
    for (const from of model.keys) for (const edge of edgesFrom(model, from, true)) reverse.get(edge.target).push(from);
    const seen = new Set(model.accepting);
    const queue = Array.from(seen);
    for (let i = 0; i < queue.length; i += 1) {
      for (const from of reverse.get(queue[i]) || []) if (!seen.has(from)) { seen.add(from); queue.push(from); }
    }
    return seen;
  }

  function stronglyConnectedComponents(model) {
    let index = 0;
    const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [];
    function visit(vertex) {
      indices.set(vertex, index); low.set(vertex, index); index += 1;
      stack.push(vertex); onStack.add(vertex);
      for (const edge of edgesFrom(model, vertex, true)) {
        const next = edge.target;
        if (!indices.has(next)) { visit(next); low.set(vertex, Math.min(low.get(vertex), low.get(next))); }
        else if (onStack.has(next)) low.set(vertex, Math.min(low.get(vertex), indices.get(next)));
      }
      if (low.get(vertex) === indices.get(vertex)) {
        const component = [];
        let item;
        do { item = stack.pop(); onStack.delete(item); component.push(item); } while (item !== vertex);
        components.push(component);
      }
    }
    model.keys.forEach((key) => { if (!indices.has(key)) visit(key); });
    return components;
  }

  function analyze(machine) {
    const model = getModel(machine);
    const reachable = reachableKeys(model);
    const coaccessible = reverseReachable(model);
    let transitionCount = 0, definedCells = 0, epsilonCount = 0, nondeterministicCells = 0, missingCells = 0;
    for (const key of model.keys) {
      const map = model.transitions.get(key);
      if (model.epsilonSymbol && (map.get(model.epsilonSymbol) || []).length) epsilonCount += (map.get(model.epsilonSymbol) || []).length;
      for (const symbol of model.alphaNames) {
        const targets = map.get(symbol) || [];
        transitionCount += targets.length;
        if (targets.length) definedCells += 1;
        if (!targets.length) missingCells += 1;
        if (targets.length > 1) nondeterministicCells += 1;
      }
    }
    const deterministic = epsilonCount === 0 && nondeterministicCells === 0;
    const complete = deterministic && missingCells === 0;
    const inaccessible = model.keys.filter((key) => !reachable.has(key));
    const dead = model.keys.filter((key) => !coaccessible.has(key));
    const components = stronglyConnectedComponents(model);
    const languageEmpty = !coaccessible.has(model.start);
    const languageInfinite = !languageEmpty && components.some((component) => {
      const componentSet = new Set(component);
      const onAcceptingPath = component.some((key) => reachable.has(key) && coaccessible.has(key));
      if (!onAcceptingPath) return false;
      return component.some((from) => edgesFrom(model, from, true).some((edge) =>
        componentSet.has(edge.target) && edge.symbol !== model.epsilonSymbol
      ));
    });
    const totalCells = model.keys.length * model.alphaNames.length;
    const minimalEligible = deterministic;
    let minimizedStateCount = null;
    if (minimalEligible) {
      try { minimizedStateCount = minimize(machine).states.length; } catch (_) { /* report unavailable */ }
    }
    const minimal = deterministic && inaccessible.length === 0 && minimizedStateCount === model.states.length;
    return {
      model,
      deterministic,
      complete,
      epsilonCount,
      nondeterministicCells,
      missingCells,
      transitionCount,
      definedCells,
      totalCells,
      density: totalCells ? definedCells / totalCells : 0,
      reachable,
      coaccessible,
      inaccessible,
      dead,
      components,
      languageEmpty,
      languageInfinite,
      minimalEligible,
      minimizedStateCount,
      minimal,
      acceptsEmpty: model.accepting.has(model.start) || (model.epsilonSymbol ? epsilonClosure(model, [model.start]).some((key) => model.accepting.has(key)) : false)
    };
  }

  function transitionTable(machine) {
    const model = getModel(machine);
    const columns = model.alphabet.map((symbol) => ({ key: String(symbol), label: String(symbol), epsilon: false }));
    if (model.epsilonSymbol) columns.push({ key: model.epsilonSymbol, label: `ε (${model.epsilonSymbol})`, epsilon: true });
    const rows = model.states.map((state, index) => {
      const key = model.keys[index];
      const cells = columns.map((column) => (model.transitions.get(key).get(column.key) || []).map((target) => stateLabel(model.stateByKey.get(target))));
      return { state, key, initial: key === model.start, accepting: model.accepting.has(key), cells };
    });
    return { columns, rows };
  }

  function epsilonClosure(model, startKeys) {
    if (!model.epsilonSymbol) return Array.from(new Set(startKeys));
    const seen = new Set(startKeys), queue = Array.from(seen);
    for (let i = 0; i < queue.length; i += 1) {
      const targets = model.transitions.get(queue[i]).get(model.epsilonSymbol) || [];
      for (const target of targets) if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
    return Array.from(seen).sort((a, b) => model.stateIndex.get(a) - model.stateIndex.get(b));
  }

  function determinize(machine, alphabetOverride) {
    const model = getModel(machine);
    const alphabet = alphabetOverride ? unique(alphabetOverride, (symbol) => `${typeof symbol}:${String(symbol)}`) : model.alphabet;
    const alphaNames = alphabet.map(String);
    if (new Set(alphaNames).size !== alphaNames.length) throw new Error('O alfabeto combinado contém símbolos com a mesma representação textual.');
    const initialSubset = epsilonClosure(model, [model.start]);
    const subsetKey = (subset) => JSON.stringify(subset.slice().sort((a, b) => model.stateIndex.get(a) - model.stateIndex.get(b)));
    const subsets = [], keyToId = new Map(), transitions = {}, acceptingStates = [];
    const addSubset = (subset) => {
      const normalized = epsilonClosure(model, subset);
      const key = subsetKey(normalized);
      if (!keyToId.has(key)) {
        const id = `D${subsets.length}`;
        keyToId.set(key, id);
        subsets.push({ id, keys: normalized, key });
      }
      return keyToId.get(key);
    };
    const initialId = addSubset(initialSubset);
    for (let cursor = 0; cursor < subsets.length; cursor += 1) {
      const subset = subsets[cursor];
      transitions[subset.id] = {};
      if (subset.keys.some((key) => model.accepting.has(key))) acceptingStates.push(subset.id);
      for (let symbolIndex = 0; symbolIndex < alphabet.length; symbolIndex += 1) {
        const symbol = alphabet[symbolIndex], name = alphaNames[symbolIndex];
        const moved = new Set();
        for (const key of subset.keys) {
          for (const target of model.transitions.get(key).get(name) || []) moved.add(target);
        }
        const targetId = addSubset(Array.from(moved));
        transitions[subset.id][name] = targetId;
      }
    }
    const labels = {};
    subsets.forEach((subset) => { labels[subset.id] = `{${subset.keys.map((key) => stateLabel(model.stateByKey.get(key))).join(', ')}}`; });
    return {
      state: initialId,
      states: subsets.map((item) => ({ id: item.id, label: labels[item.id] })),
      alphabet: clone(alphabet),
      acceptingStates,
      transitions,
      subsetLabels: labels
    };
  }

  function minimize(machine) {
    const model = getModel(machine);
    const analysis = analyzeWithoutMinimize(model);
    if (!analysis.deterministic) throw new Error('A minimização direta exige um DFA: não pode haver transições epsilon nem múltiplos destinos. Use Determinizar primeiro.');
    const alphabet = model.alphabet;
    const alphaNames = model.alphaNames;
    let sink = 'string:\u0000AUTOMATA_SINK';
    while (model.stateByKey.has(sink)) sink += '_';
    const delta = new Map();
    const allKeys = model.keys.slice();
    let needsSink = false;
    for (const key of model.keys) {
      const row = new Map();
      for (const symbol of alphaNames) {
        const targets = model.transitions.get(key).get(symbol) || [];
        if (targets.length > 1) throw new Error('A máquina não é determinística.');
        if (!targets.length) { row.set(symbol, sink); needsSink = true; }
        else row.set(symbol, targets[0]);
      }
      delta.set(key, row);
    }
    if (needsSink) {
      allKeys.push(sink);
      delta.set(sink, new Map(alphaNames.map((symbol) => [symbol, sink])));
    }
    const reachable = new Set([model.start]), queue = [model.start];
    for (let i = 0; i < queue.length; i += 1) {
      const row = delta.get(queue[i]);
      for (const symbol of alphaNames) {
        const target = row.get(symbol);
        if (!reachable.has(target)) { reachable.add(target); queue.push(target); }
      }
    }
    const validKeys = allKeys.filter((key) => reachable.has(key));
    const isAccepting = (key) => model.accepting.has(key);
    let partitions = [validKeys.filter((key) => !isAccepting(key)), validKeys.filter(isAccepting)].filter((group) => group.length);
    let changed = true;
    while (changed) {
      changed = false;
      const partOf = new Map();
      partitions.forEach((group, index) => group.forEach((key) => partOf.set(key, index)));
      const refined = [];
      for (const group of partitions) {
        const buckets = new Map();
        for (const key of group) {
          const signature = JSON.stringify(alphaNames.map((symbol) => partOf.get(delta.get(key).get(symbol))));
          if (!buckets.has(signature)) buckets.set(signature, []);
          buckets.get(signature).push(key);
        }
        if (buckets.size > 1) changed = true;
        refined.push(...buckets.values());
      }
      partitions = refined;
    }
    const startPart = partitions.findIndex((group) => group.includes(model.start));
    if (startPart > 0) partitions.unshift(...partitions.splice(startPart, 1));
    const partOf = new Map();
    partitions.forEach((group, index) => group.forEach((key) => partOf.set(key, index)));
    const classes = {};
    partitions.forEach((group, index) => { classes[`M${index}`] = group.filter((key) => key !== sink).map((key) => stateLabel(model.stateByKey.get(key))); });
    const states = partitions.map((_, index) => ({ id: `M${index}`, label: `{${classes[`M${index}`].join(', ') || '∅'}}` }));
    const transitions = {};
    partitions.forEach((group, index) => {
      transitions[states[index].id] = {};
      for (const symbol of alphaNames) transitions[states[index].id][symbol] = states[partOf.get(delta.get(group[0]).get(symbol))].id;
    });
    const acceptingStates = partitions.flatMap((group, index) => group.some(isAccepting) ? [states[index].id] : []);
    return { state: states[0].id, states, alphabet: clone(alphabet), acceptingStates, transitions, equivalenceClasses: classes, completedWithSink: needsSink };
  }

  function analyzeWithoutMinimize(model) {
    let epsilonCount = 0, nondeterministicCells = 0;
    for (const key of model.keys) {
      const row = model.transitions.get(key);
      if (model.epsilonSymbol) epsilonCount += (row.get(model.epsilonSymbol) || []).length;
      for (const symbol of model.alphaNames) if ((row.get(symbol) || []).length > 1) nondeterministicCells += 1;
    }
    return { deterministic: epsilonCount === 0 && nondeterministicCells === 0 };
  }

  function compare(machineA, machineB) {
    const modelA = getModel(machineA), modelB = getModel(machineB);
    const alphabet = unique([...modelA.alphabet, ...modelB.alphabet], (symbol) => `${typeof symbol}:${String(symbol)}`);
    const alphaNames = alphabet.map(String);
    if (new Set(alphaNames).size !== alphaNames.length) throw new Error('Os alfabetos combinados contêm símbolos com a mesma representação textual.');
    const dfaA = determinize(machineA, alphabet), dfaB = determinize(machineB, alphabet);
    const parseDfa = (dfa) => {
      const accepting = new Set(dfa.acceptingStates);
      const delta = new Map(dfa.states.map((state) => { const id = String(stateId(state)); return [id, new Map(alphaNames.map((symbol) => [symbol, dfa.transitions[id][symbol]]))]; }));
      return { start: dfa.state, accepting, delta };
    };
    const a = parseDfa(dfaA), b = parseDfa(dfaB);
    const queue = [{ a: a.start, b: b.start, word: [] }], seen = new Set();
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const item = queue[cursor];
      const key = JSON.stringify([item.a, item.b]);
      if (seen.has(key)) continue;
      seen.add(key);
      const acceptsA = a.accepting.has(item.a), acceptsB = b.accepting.has(item.b);
      if (acceptsA !== acceptsB) return { equivalent: false, witness: item.word, acceptsA, acceptsB, exploredPairs: seen.size, alphabet };
      for (let i = 0; i < alphaNames.length; i += 1) {
        const symbol = alphaNames[i];
        queue.push({ a: a.delta.get(item.a).get(symbol), b: b.delta.get(item.b).get(symbol), word: [...item.word, alphabet[i]] });
      }
    }
    return { equivalent: true, witness: null, exploredPairs: seen.size, alphabet };
  }

  function toRegularExpression(machine, maxStates = 18) {
    const model = getModel(machine);
    if (model.states.length > maxStates) throw new Error(`A eliminação de estados pode gerar expressões enormes. O limite desta interface é ${maxStates} estados (a máquina tem ${model.states.length}).`);
    const start = '\u0000NEW_START', final = '\u0000NEW_FINAL';
    const nodes = [start, ...model.keys, final];
    const edges = new Map(nodes.map((from) => [from, new Map()]));
    const empty = '∅', epsilon = 'ε', maxExpressionLength = 100000;
    const checkSize = (expression) => {
      if (expression.length > maxExpressionLength) throw new Error('A expressão intermediária ficou muito grande (limite de 100 mil caracteres). Tente uma máquina menor ou simplifique os estados antes da conversão.');
      return expression;
    };
    const union = (left, right) => {
      if (!left || left === empty) return right || empty;
      if (!right || right === empty || left === right) return left;
      return checkSize(`(${left}|${right})`);
    };
    const concat = (...parts) => {
      if (parts.some((part) => !part || part === empty)) return empty;
      return checkSize(parts.filter((part) => part !== epsilon).join('') || epsilon);
    };
    const star = (value) => (!value || value === empty || value === epsilon) ? epsilon : checkSize(`(${value})*`);
    const add = (from, to, expression) => {
      const row = edges.get(from);
      row.set(to, union(row.get(to) || empty, expression));
    };
    const symbolExpression = (symbol) => {
      const value = String(symbol);
      if (value.length === 1) return /[\\.^$|?*+()[\]{}]/.test(value) ? `\\${value}` : value;
      return `⟨${value.replace(/⟩/g, '\\⟩')}⟩`;
    };
    add(start, model.start, epsilon);
    for (const accept of model.accepting) add(accept, final, epsilon);
    for (const from of model.keys) {
      for (const [symbol, targets] of model.transitions.get(from)) {
        const label = symbol === model.epsilonSymbol ? epsilon : symbolExpression(symbol);
        for (const target of targets) add(from, target, label);
      }
    }
    const remaining = new Set(nodes);
    remaining.delete(start); remaining.delete(final);
    const active = new Set(nodes);
    while (remaining.size) {
      let selected = null, bestScore = Infinity;
      for (const candidate of remaining) {
        let incoming = 0, outgoing = 0;
        for (const node of active) {
          if (node !== candidate && (edges.get(node).get(candidate) || empty) !== empty) incoming += 1;
          if (node !== candidate && (edges.get(candidate).get(node) || empty) !== empty) outgoing += 1;
        }
        const loop = edges.get(candidate).get(candidate) || empty;
        const score = incoming * outgoing * (loop === empty ? 1 : 2) + incoming + outgoing;
        if (score < bestScore) { bestScore = score; selected = candidate; }
      }
      const loopStar = star(edges.get(selected).get(selected) || empty);
      const predecessors = Array.from(active).filter((node) => node !== selected && (edges.get(node).get(selected) || empty) !== empty);
      const successors = Array.from(active).filter((node) => node !== selected && (edges.get(selected).get(node) || empty) !== empty);
      for (const from of predecessors) {
        for (const to of successors) {
          add(from, to, concat(edges.get(from).get(selected), loopStar, edges.get(selected).get(to)));
        }
      }
      for (const node of active) edges.get(node).delete(selected);
      edges.delete(selected);
      active.delete(selected);
      remaining.delete(selected);
    }
    return { expression: edges.get(start).get(final) || empty, notation: 'Símbolos de um caractere são literais; símbolos compostos são exibidos como ⟨token⟩. ε representa a palavra vazia e ∅ a linguagem vazia.' };
  }

  return { getModel, analyze, transitionTable, determinize, minimize, compare, toRegularExpression, stateKey, stateLabel };
});
