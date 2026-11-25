/*
 * Automata Machine Definition format
 * A deliberately small, deterministic YAML 1.2 subset parser/serializer.
 * Supports block mappings/sequences, flow maps/sequences, quoted/plain
 * scalars, comments, and literal/folded block strings. No network required.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutomataFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function makeError(message, line, column = 0) {
    const error = new Error(message);
    error.line = line;
    error.column = column;
    return error;
  }

  function stripComment(text) {
    let quote = null;
    let escaped = false;
    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (quote === '"' && ch === '\\' && !escaped) { escaped = true; continue; }
        if (ch === quote && !escaped) quote = null;
        escaped = false;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '[' || ch === '{') depth += 1;
      else if (ch === ']' || ch === '}') depth -= 1;
      else if (ch === '#' && depth === 0 && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
    }
    return text.trimEnd();
  }

  function splitTopLevel(text, delimiter = ',') {
    const result = [];
    let quote = null;
    let escaped = false;
    let square = 0;
    let curly = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (quote === '"' && ch === '\\' && !escaped) { escaped = true; continue; }
        if (ch === quote && !escaped) quote = null;
        escaped = false;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '[') square += 1;
      else if (ch === ']') square -= 1;
      else if (ch === '{') curly += 1;
      else if (ch === '}') curly -= 1;
      else if (ch === delimiter && square === 0 && curly === 0) {
        result.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    result.push(text.slice(start).trim());
    return result;
  }

  function findTopLevelColon(text) {
    let quote = null;
    let escaped = false;
    let square = 0;
    let curly = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (quote === '"' && ch === '\\' && !escaped) { escaped = true; continue; }
        if (ch === quote && !escaped) quote = null;
        escaped = false;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '[') square += 1;
      else if (ch === ']') square -= 1;
      else if (ch === '{') curly += 1;
      else if (ch === '}') curly -= 1;
      else if (ch === ':' && square === 0 && curly === 0 && (i === text.length - 1 || /\s/.test(text[i + 1]))) return i;
    }
    return -1;
  }

  function scalarValue(text, line) {
    const value = text.trim();
    if (!value) return '';
    if (value[0] === '"') {
      try { return JSON.parse(value); }
      catch (_) { throw makeError('String entre aspas duplas inválida.', line, 0); }
    }
    if (value[0] === "'") {
      if (value[value.length - 1] !== "'") throw makeError('String entre aspas simples não foi fechada.', line, 0);
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (/^(?:null|Null|NULL|~)$/.test(value)) return null;
    if (/^(?:true|True|TRUE)$/.test(value)) return true;
    if (/^(?:false|False|FALSE)$/.test(value)) return false;
    if (/^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value)) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    if (/^[-+]?0x[\da-f]+$/i.test(value)) return Number(value);
    if (/^[&*!|>`]/.test(value)) throw makeError(`Recurso YAML não suportado: ${value[0]}. Use strings simples ou entre aspas.`, line, 0);
    return value;
  }

  function parseInline(text, line) {
    const value = text.trim();
    if (!value) return null;
    if (value[0] === '[') {
      if (value[value.length - 1] !== ']') throw makeError('Lista entre colchetes não foi fechada.', line, value.length);
      const inner = value.slice(1, -1).trim();
      if (!inner) return [];
      return splitTopLevel(inner).map((item) => parseInline(item, line));
    }
    if (value[0] === '{') {
      if (value[value.length - 1] !== '}') throw makeError('Mapa entre chaves não foi fechado.', line, value.length);
      const inner = value.slice(1, -1).trim();
      const object = Object.create(null);
      if (!inner) return object;
      for (const pair of splitTopLevel(inner)) {
        const colon = findTopLevelColon(pair);
        if (colon < 0) throw makeError(`Par de mapa inválido: "${pair}". Esperado "chave: valor".`, line, 0);
        const keyValue = parseInline(pair.slice(0, colon), line);
        if (keyValue !== null && typeof keyValue === 'object') throw makeError('Chaves de mapa precisam ser valores simples.', line, 0);
        const key = String(keyValue);
        if (Object.prototype.hasOwnProperty.call(object, key)) throw makeError(`Chave duplicada: "${key}".`, line, 0);
        object[key] = parseInline(pair.slice(colon + 1), line);
      }
      return object;
    }
    if ((value[0] === '"' || value[0] === "'") && value[value.length - 1] !== value[0]) {
      throw makeError('String entre aspas não foi fechada.', line, 0);
    }
    return scalarValue(value, line);
  }

  function parseYaml(source) {
    const rawLines = String(source).replace(/^\uFEFF/, '').split(/\r?\n/);
    const lines = [];
    rawLines.forEach((raw, index) => {
      if (/\t/.test(raw.match(/^\s*/)?.[0] || '')) throw makeError('Use espaços, não tabulações, para indentar YAML.', index, 0);
      const indent = raw.match(/^ */)[0].length;
      const text = stripComment(raw.slice(indent));
      if (!text.trim() || text.trim() === '---' || text.trim() === '...') return;
      lines.push({ indent, text: text.trimEnd(), line: index });
    });
    if (!lines.length) throw makeError('A definição da máquina está vazia.', 0, 0);

    function parseBlock(start, indent) {
      const isSequence = /^-(?:\s|$)/.test(lines[start].text);
      if (isSequence) return parseSequence(start, indent);
      return parseMapping(start, indent);
    }

    function parseBlockValue(index, parentIndent) {
      if (index < lines.length && lines[index].indent > parentIndent) return parseBlock(index, lines[index].indent);
      return { value: null, next: index };
    }

    function parseSequence(start, indent) {
      const array = [];
      let index = start;
      while (index < lines.length && lines[index].indent === indent && /^-(?:\s|$)/.test(lines[index].text)) {
        const line = lines[index];
        const remainder = line.text.replace(/^-(?:\s+)?/, '').trim();
        index += 1;
        if (!remainder) {
          const child = parseBlockValue(index, indent);
          array.push(child.value);
          index = child.next;
        } else {
          const colon = findTopLevelColon(remainder);
          if (colon >= 0 && remainder[0] !== '{' && remainder[0] !== '[') {
            // Compact support for sequence items that begin with a mapping pair.
            const object = Object.create(null);
            const key = String(parseInline(remainder.slice(0, colon), line.line));
            const rhs = remainder.slice(colon + 1).trim();
            if (Object.prototype.hasOwnProperty.call(object, key)) throw makeError(`Chave duplicada: "${key}".`, line.line, 0);
            if (rhs) object[key] = parseInline(rhs, line.line);
            else {
              const child = parseBlockValue(index, indent + 2);
              object[key] = child.value;
              index = child.next;
            }
            // Remaining mapping fields are accepted as inline flow maps to keep the grammar unambiguous.
            if (index < lines.length && lines[index].indent > indent) {
              const next = lines[index];
              if (next.indent === indent + 2) {
                while (index < lines.length && lines[index].indent === indent + 2 && !/^-(?:\s|$)/.test(lines[index].text)) {
                  const pairColon = findTopLevelColon(lines[index].text);
                  if (pairColon < 0) throw makeError('Esperado "chave: valor" neste item da lista.', lines[index].line, 0);
                  const pairKey = String(parseInline(lines[index].text.slice(0, pairColon), lines[index].line));
                  if (Object.prototype.hasOwnProperty.call(object, pairKey)) throw makeError(`Chave duplicada: "${pairKey}".`, lines[index].line, 0);
                  const pairRhs = lines[index].text.slice(pairColon + 1).trim();
                  index += 1;
                  if (pairRhs) object[pairKey] = parseInline(pairRhs, next.line);
                  else {
                    const child = parseBlockValue(index, indent + 2);
                    object[pairKey] = child.value;
                    index = child.next;
                  }
                }
              }
            }
            array.push(object);
          } else {
            array.push(parseInline(remainder, line.line));
            if (index < lines.length && lines[index].indent > indent) throw makeError('Indentação inesperada após item da lista.', lines[index].line, 0);
          }
        }
      }
      return { value: array, next: index };
    }

    function parseMapping(start, indent) {
      const object = Object.create(null);
      let index = start;
      while (index < lines.length && lines[index].indent === indent && !/^-(?:\s|$)/.test(lines[index].text)) {
        const line = lines[index];
        const colon = findTopLevelColon(line.text);
        if (colon < 0) throw makeError(`Esperado "chave: valor", recebido "${line.text}".`, line.line, 0);
        const parsedKey = parseInline(line.text.slice(0, colon), line.line);
        if (parsedKey === null || typeof parsedKey === 'object') throw makeError('A chave precisa ser um texto ou número simples.', line.line, 0);
        const key = String(parsedKey);
        if (Object.prototype.hasOwnProperty.call(object, key)) throw makeError(`Chave duplicada: "${key}".`, line.line, 0);
        const rhs = line.text.slice(colon + 1).trim();
        index += 1;
        if (rhs === '|' || rhs === '>' || rhs === '|-' || rhs === '>-') {
          const chunks = [];
          let blockIndent = null;
          while (index < lines.length && lines[index].indent > indent) {
            if (blockIndent === null) blockIndent = lines[index].indent;
            chunks.push(' '.repeat(Math.max(0, lines[index].indent - blockIndent)) + lines[index].text);
            index += 1;
          }
          object[key] = rhs[0] === '>' ? chunks.join(' ').trim() + (rhs.endsWith('-') ? '' : '\n') : chunks.join('\n') + (rhs.endsWith('-') ? '' : '\n');
        } else if (rhs) {
          object[key] = parseInline(rhs, line.line);
          if (index < lines.length && lines[index].indent > indent) throw makeError('Indentação inesperada. Verifique os espaços antes deste campo.', lines[index].line, 0);
        } else {
          const child = parseBlockValue(index, indent);
          object[key] = child.value;
          index = child.next;
        }
      }
      if (index < lines.length && lines[index].indent > indent) throw makeError('Indentação inesperada. Cada nível deve avançar de forma consistente.', lines[index].line, 0);
      return { value: object, next: index };
    }

    const root = parseBlock(0, lines[0].indent);
    if (root.next !== lines.length) throw makeError('Não foi possível interpretar toda a definição.', lines[root.next].line, 0);
    return root.value;
  }

  function parseMachineSource(source) {
    const text = String(source ?? '').trim();
    if (!text) return { ok: false, error: 'A definição da máquina está vazia.', line: 0, column: 0 };
    let value;
    try {
      // JSON remains fully supported for legacy projects and pasted definitions.
      if (text[0] === '{') {
        try { value = JSON.parse(text); }
        catch (_) { value = parseInline(text, 0); }
      } else value = parseYaml(text);
    } catch (error) {
      const match = String(error.message).match(/position\s+(\d+)/i);
      let line = Number.isInteger(error.line) ? error.line : null;
      let column = Number.isInteger(error.column) ? error.column : null;
      if (match) {
        const before = text.slice(0, Number(match[1]));
        line = before.split('\n').length - 1;
        column = before.length - before.lastIndexOf('\n') - 1;
      }
      return { ok: false, error: error.message, line, column };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'A raiz da definição precisa ser um mapa/objeto.' };
    if (!Array.isArray(value.states)) return { ok: false, error: 'Adicione "states" com a lista de estados da máquina.' };
    if (!Array.isArray(value.alphabet)) return { ok: false, error: 'Adicione "alphabet" com a lista de símbolos aceitos.' };
    if (!Object.prototype.hasOwnProperty.call(value, 'state')) return { ok: false, error: 'Defina "state" com o estado inicial.' };
    const stateId = (state) => state && typeof state === 'object' && Object.prototype.hasOwnProperty.call(state, 'id') ? state.id : state;
    const keyOf = (state) => {
      const id = stateId(state);
      return id === null ? 'null' : `${typeof id}:${typeof id === 'object' ? JSON.stringify(id) : String(id)}`;
    };
    if (value.state !== null && !value.states.some((state) => keyOf(state) === keyOf(value.state))) {
      return { ok: false, error: 'O estado inicial precisa existir em "states" (ou ser null para iniciar parada).' };
    }
    return { ok: true, value };
  }

  function quoteString(value) {
    if (value === '') return '""';
    const safe = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)
      && !/^(?:null|true|false|~|[-+]?(?:\d|\.\d))$/i.test(value)
      && !/^(?:yes|no|on|off)$/i.test(value);
    return safe ? value : JSON.stringify(value);
  }

  function yamlScalar(value, asKey = false) {
    if (value === null) return 'null';
    if (typeof value === 'string') return quoteString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'undefined') return 'null';
    return null;
  }

  function isScalar(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
  }

  function inlineYaml(value) {
    if (isScalar(value)) return yamlScalar(value);
    if (Array.isArray(value)) return `[${value.map(inlineYaml).join(', ')}]`;
    if (value && typeof value === 'object') {
      return `{ ${Object.entries(value).map(([key, item]) => `${quoteString(String(key))}: ${inlineYaml(item)}`).join(', ')} }`;
    }
    return 'null';
  }

  function emitYamlValue(value, indent, forceBlock = false) {
    const pad = ' '.repeat(indent);
    if (isScalar(value)) return yamlScalar(value);
    if (Array.isArray(value)) {
      const candidate = inlineYaml(value);
      if (!forceBlock && (value.every(isScalar) || candidate.length <= 88)) return candidate;
      if (!value.length) return '[]';
      return `\n${value.map((item) => {
        if (isScalar(item) || Array.isArray(item) || (item && typeof item === 'object')) return `${pad}- ${inlineYaml(item)}`;
        return `${pad}- null`;
      }).join('\n')}`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      if (!entries.length) return '{}';
      const candidate = inlineYaml(value);
      if (!forceBlock && entries.every(([, item]) => isScalar(item)) && candidate.length <= 92) return candidate;
      return `\n${entries.map(([key, item]) => `${pad}${quoteString(String(key))}: ${emitYamlValue(item, indent + 2)}`).join('\n')}`;
    }
    return 'null';
  }

  function stringifyMachineYaml(machine) {
    if (!machine || typeof machine !== 'object' || Array.isArray(machine)) throw new TypeError('A máquina precisa ser um objeto.');
    return `${Object.entries(machine).map(([key, value]) => {
      const rendered = emitYamlValue(value, 2, value && typeof value === 'object' && !Array.isArray(value));
      return `${quoteString(key)}:${rendered.startsWith('\n') ? '' : ' '}${rendered}`;
    }).join('\n')}\n`;
  }

  return { parseYaml, parseMachineSource, stringifyMachineYaml };
});
