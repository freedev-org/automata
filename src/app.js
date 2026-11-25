'use strict';

(() => {
  const STORAGE_KEY = 'automata.library.v1';
  const LAST_KEY = 'automata.last-opened.v1';
  const MAX_WORKER_TIME = 1800;
  const DEFAULT_MACHINE = {
    state: 'q0',
    states: ['q0', 'q1'],
    alphabet: ['0', '1'],
    acceptingStates: ['q1'],
    transitions: {
      q0: { '0': 'q0', '1': 'q1' },
      q1: { '0': 'q0', '1': 'q1' }
    }
  };
  const DEFAULT_RULE = `const nextState = machine.transitions?.[machine.state]?.[operation];

if (nextState === undefined) {
  throw new Error(\`Transição não definida para estado "\${machine.state}" e símbolo "\${operation}".\`);
}

return nextState;`;

  const $ = (id) => document.getElementById(id);
  const els = {
    sidebar: $('sidebar'), machineList: $('machineList'), machineCount: $('machineCount'),
    newMachineButton: $('newMachineButton'), importButton: $('importButton'), helpButton: $('helpButton'),
    closeSidebar: $('closeSidebar'), openSidebar: $('openSidebar'), mobileScrim: $('mobileScrim'),
    breadcrumbName: $('breadcrumbName'), savedIndicator: $('savedIndicator'), duplicateButton: $('duplicateButton'),
    exportButton: $('exportButton'), shareButton: $('shareButton'), topHelpButton: $('topHelpButton'),
    machineName: $('machineName'), updatedLabel: $('updatedLabel'), machineTypeChip: $('machineTypeChip'),
    machineEditor: $('machineEditor'), ruleEditor: $('ruleEditor'), inputEditor: $('inputEditor'),
    formatMachineButton: $('formatMachineButton'), machineStatus: $('machineStatus'), stateCount: $('stateCount'),
    ruleHelpButton: $('ruleHelpButton'), alphabetLabel: $('alphabetLabel'), parseInputButton: $('parseInputButton'),
    inputStatus: $('inputStatus'), stateGraph: $('stateGraph'), graphEmpty: $('graphEmpty'),
    graphSummary: $('graphSummary'), graphResetButton: $('graphResetButton'),
    executionStatus: $('executionStatus'), runAllButton: $('runAllButton'), stepButton: $('stepButton'),
    resetButton: $('resetButton'), stepCounter: $('stepCounter'), tokenTrack: $('tokenTrack'),
    currentState: $('currentState'), lastTransition: $('lastTransition'), runResult: $('runResult'),
    executionLog: $('executionLog'), executionTime: $('executionTime'), helpDialog: $('helpDialog'),
    shareDialog: $('shareDialog'), importDialog: $('importDialog'), shareFeedback: $('shareFeedback'),
    copyShareLinkButton: $('copyShareLinkButton'), shareExportButton: $('shareExportButton'), shareLinkField: $('shareLinkField'),
    importTitle: $('importTitle'), importDescription: $('importDescription'), importMeta: $('importMeta'),
    variableDocsDialog: $('variableDocsDialog'), variableDocTitle: $('variableDocTitle'), variableDocContent: $('variableDocContent'),
    saveSharedButton: $('saveSharedButton'), openSharedButton: $('openSharedButton'),
    fileInput: $('fileInput'), toastRegion: $('toastRegion'),
    machineDiagnostics: $('machineDiagnostics'), ruleDiagnostics: $('ruleDiagnostics'),
    activeEditorStatus: $('activeEditorStatus'), machineTabStatus: $('machineTabStatus'), ruleTabStatus: $('ruleTabStatus'),
    historyCount: $('historyCount')
  };

  let machines = [];
  let current = null;
  let currentEphemeral = false;
  let parsedMachine = null;
  let execution = createEmptyExecution();
  let pendingShared = null;
  let saveTimer = null;
  let graphPositions = {};
  let dragState = null;
  let suppressEditorEvents = false;
  let activeEditorTab = 'machine';
  let editorInstances = {};
  let machineIsValid = true;
  let ruleIsValid = true;

  function createCodeEditor(textarea, mode) {
    const cm = CodeMirror.fromTextArea(textarea, {
      mode,
      theme: 'automata',
      lineNumbers: true,
      lineWrapping: false,
      tabSize: 2,
      indentUnit: 2,
      indentWithTabs: false,
      autoCloseBrackets: true,
      matchBrackets: true,
      styleActiveLine: true,
      foldGutter: true,
      gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      viewportMargin: 30,
      inputStyle: 'contenteditable',
      extraKeys: {
        'Tab': (editor) => editor.execCommand('indentMore'),
        'Shift-Tab': (editor) => editor.execCommand('indentLess'),
        'Ctrl-/': 'toggleComment',
        'Cmd-/': 'toggleComment'
      }
    });

    return {
      get value() { return cm.getValue(); },
      set value(value) {
        const next = String(value ?? '');
        if (cm.getValue() === next) return;
        const previous = suppressEditorEvents;
        suppressEditorEvents = true;
        cm.setValue(next);
        suppressEditorEvents = previous;
      },
      addEventListener(type, callback) {
        if (type === 'input') cm.on('change', () => { if (!suppressEditorEvents) callback(); });
      },
      focus() { cm.focus(); },
      refresh() { cm.refresh(); },
      jumpToLine(line, ch = 0) {
        const target = Math.max(0, Math.min(cm.lineCount() - 1, line));
        cm.focus();
        cm.setCursor({ line: target, ch });
        cm.scrollIntoView({ line: target, ch }, 100);
      },
      instance: cm
    };
  }

  function setupCodeEditors() {
    if (!window.CodeMirror || !window.acorn || !window.AutomataFormat) {
      toast('Não foi possível carregar o editor local. Verifique os arquivos da pasta vendor.', true);
      return;
    }
    const machineTextarea = els.machineEditor;
    const ruleTextarea = els.ruleEditor;
    els.machineEditor = createCodeEditor(machineTextarea, 'yaml');
    els.ruleEditor = createCodeEditor(ruleTextarea, 'javascript');
    editorInstances.machine = els.machineEditor.instance;
    editorInstances.rule = els.ruleEditor.instance;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function renderDiagnostics(container, diagnostics, fallbackText) {
    if (!container) return;
    if (!diagnostics.length) {
      container.innerHTML = `<span class="diagnostic-ok">✓ ${escapeHtml(fallbackText)}</span>`;
      return;
    }
    container.innerHTML = diagnostics.map((item) => {
      const kind = item.kind || 'warning';
      const location = Number.isInteger(item.line)
        ? `<button type="button" class="diagnostic-location" data-line="${item.line}" data-column="${Number.isInteger(item.column) ? item.column : 0}">linha ${item.line + 1} ↗</button>`
        : '';
      return `<div class="diagnostic-item ${kind}"><span class="diagnostic-symbol">${kind === 'error' ? '×' : '!'}</span><span class="diagnostic-message">${escapeHtml(item.message)}</span>${location}</div>`;
    }).join('');
  }

  function analyzeMachineDefinition(source) {
    const diagnostics = [];
    const parsed = AutomataFormat.parseMachineSource(source);
    if (!parsed.ok) {
      diagnostics.push({ kind: 'error', message: `Definição inválida: ${parsed.error}`, line: parsed.line, column: parsed.column });
      return diagnostics;
    }
    const machine = parsed.value;

    const seenStates = new Set();
    if (Array.isArray(machine.states)) {
      machine.states.forEach((state, index) => {
        const key = stateKey(state);
        if (seenStates.has(key)) diagnostics.push({ kind: 'error', message: `Estado duplicado na posição ${index + 1}: ${stateLabel(state)}.` });
        seenStates.add(key);
      });
    }

    if (machine.initialState !== undefined && machine.initialState !== null && Array.isArray(machine.states)) {
      if (!machine.states.some((state) => stateKey(state) === stateKey(machine.initialState))) {
        diagnostics.push({ kind: 'error', message: 'O campo initialState aponta para um estado que não existe em states.' });
      }
    }
    if (machine.acceptingStates !== undefined) {
      if (!Array.isArray(machine.acceptingStates)) {
        diagnostics.push({ kind: 'error', message: 'acceptingStates precisa ser uma lista de estados.' });
      } else if (Array.isArray(machine.states)) {
        machine.acceptingStates.forEach((state) => {
          if (!machine.states.some((candidate) => stateKey(candidate) === stateKey(state))) {
            diagnostics.push({ kind: 'error', message: `Estado de aceitação inexistente: ${stateLabel(state)}.` });
          }
        });
      }
    }

    if (Array.isArray(machine.alphabet)) {
      const symbols = new Set();
      machine.alphabet.forEach((symbol, index) => {
        const key = stateKey(symbol);
        if (symbols.has(key)) diagnostics.push({ kind: 'warning', message: `Símbolo duplicado no alfabeto (posição ${index + 1}): ${stateLabel(symbol)}.` });
        symbols.add(key);
      });
    }

    // Validate the conventional transition map without restricting custom machine data.
    if (machine.transitions && typeof machine.transitions === 'object' && !Array.isArray(machine.transitions) && Array.isArray(machine.states)) {
      const knownStates = new Set(machine.states.map(stateKey));
      Object.entries(machine.transitions).forEach(([from, bySymbol]) => {
        if (!machine.states.some((state) => String(stateId(state)) === from)) {
          diagnostics.push({ kind: 'warning', message: `A origem da transição "${from}" não corresponde a um estado declarado.` });
          return;
        }
        if (!bySymbol || typeof bySymbol !== 'object' || Array.isArray(bySymbol)) {
          diagnostics.push({ kind: 'error', message: `As transições do estado "${from}" precisam formar um mapa de símbolo para próximo estado.` });
          return;
        }
        Object.entries(bySymbol).forEach(([symbol, target]) => {
          if (Array.isArray(machine.alphabet) && !machine.alphabet.some((item) => String(item) === symbol)) {
            diagnostics.push({ kind: 'warning', message: `O símbolo "${symbol}" usado em ${from} não aparece no alfabeto.` });
          }
          if (target !== null && !knownStates.has(stateKey(target))) {
            diagnostics.push({ kind: 'warning', message: `A transição ${from} / ${symbol} aponta para "${String(target)}", que não está em states.` });
          }
        });
      });
    }

    return diagnostics;
  }

  function analyzeRuleCode(source) {
    const diagnostics = [];
    if (!source.trim()) return [{ kind: 'error', message: 'Escreva uma regra JavaScript antes de executar.' }];
    let ast;
    try {
      const wrapped = `function __automata_rule(operation, machine, context) {\n${source}\n}`;
      ast = acorn.parse(wrapped, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
    } catch (error) {
      const loc = error.loc || {};
      const line = Number.isInteger(loc.line) ? Math.max(0, loc.line - 2) : null;
      diagnostics.push({ kind: 'error', message: `JavaScript inválido: ${error.message}`, line, column: Number.isInteger(loc.column) ? loc.column : null });
      return diagnostics;
    }

    let foundReturn = false;
    let bareReturn = false;
    const walk = (node, isRoot = false) => {
      if (!node || typeof node !== 'object') return;
      if (!isRoot && /Function(?:Declaration|Expression)$/.test(node.type) || node.type === 'ArrowFunctionExpression') return;
      if (node.type === 'ReturnStatement') {
        foundReturn = true;
        if (!node.argument || (node.argument.type === 'Identifier' && node.argument.name === 'undefined')) {
          bareReturn = true;
          const line = Number.isInteger(node.loc?.start?.line) ? Math.max(0, node.loc.start.line - 2) : null;
          diagnostics.push({ kind: 'error', message: 'Este return produz undefined; o motor exige um estado válido ou null.', line });
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) value.forEach((child) => { if (child && typeof child.type === 'string') walk(child); });
        else if (value && typeof value.type === 'string') walk(value);
      }
    };
    const ruleFunction = ast.body[0];
    walk(ruleFunction.body, true);
    if (!foundReturn) diagnostics.unshift({ kind: 'error', message: 'A regra não contém return. Retorne o próximo estado ou null para encerrar.' });
    if (foundReturn && !bareReturn) {
      // Parsing succeeded and at least one explicit state/result is returned.
    }
    return diagnostics;
  }

  function validateRuleEditor() {
    const diagnostics = analyzeRuleCode(els.ruleEditor.value);
    renderDiagnostics(els.ruleDiagnostics, diagnostics, 'Sintaxe válida e retorno encontrado');
    const hasError = diagnostics.some((item) => item.kind === 'error');
    ruleIsValid = !hasError;
    const hasWarning = diagnostics.some((item) => item.kind === 'warning');
    if (els.ruleTabStatus) els.ruleTabStatus.textContent = hasError ? '!' : hasWarning ? '⚠' : '✓';
    if (els.ruleTabStatus) {
      els.ruleTabStatus.classList.toggle('invalid', hasError);
      els.ruleTabStatus.classList.toggle('has-warning', hasWarning);
    }
    updateActiveEditorStatus();
    return !hasError;
  }

  function validateMachineEditor() {
    const diagnostics = analyzeMachineDefinition(els.machineEditor.value);
    renderDiagnostics(els.machineDiagnostics, diagnostics, 'YAML e estrutura válidos');
    const hasError = diagnostics.some((item) => item.kind === 'error');
    machineIsValid = !hasError;
    const hasWarning = diagnostics.some((item) => item.kind === 'warning');
    if (els.machineTabStatus) els.machineTabStatus.textContent = hasError ? '!' : hasWarning ? '⚠' : '✓';
    if (els.machineTabStatus) {
      els.machineTabStatus.classList.toggle('invalid', hasError);
      els.machineTabStatus.classList.toggle('has-warning', hasWarning);
    }
    updateActiveEditorStatus();
    return !hasError;
  }

  function updateActiveEditorStatus() {
    if (!els.activeEditorStatus) return;
    if (activeEditorTab === 'machine') {
      const invalid = els.machineTabStatus?.classList.contains('invalid');
      const warning = els.machineTabStatus?.classList.contains('has-warning');
      els.activeEditorStatus.textContent = invalid ? 'Revisar estrutura' : warning ? 'Verificar avisos' : 'YAML válido';
      els.activeEditorStatus.classList.toggle('has-error', !!invalid);
      els.activeEditorStatus.classList.toggle('has-warning', !!warning);
    } else {
      const invalid = els.ruleTabStatus?.classList.contains('invalid');
      const warning = els.ruleTabStatus?.classList.contains('has-warning');
      els.activeEditorStatus.textContent = invalid ? 'Revisar regra' : warning ? 'Verificar avisos' : 'JavaScript válido';
      els.activeEditorStatus.classList.toggle('has-error', !!invalid);
      els.activeEditorStatus.classList.toggle('has-warning', !!warning);
    }
  }

  function activateEditorTab(tab) {
    activeEditorTab = tab === 'rule' ? 'rule' : 'machine';
    document.querySelectorAll('[data-editor-tab]').forEach((button) => {
      const active = button.dataset.editorTab === activeEditorTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('.editor-panel').forEach((panel) => {
      const active = panel.id === (activeEditorTab === 'machine' ? 'machineEditorPanel' : 'ruleEditorPanel');
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    if (els.formatMachineButton) els.formatMachineButton.hidden = activeEditorTab !== 'machine';
    updateActiveEditorStatus();
    const editor = editorInstances[activeEditorTab];
    if (editor) { editor.refresh(); requestAnimationFrame(() => editor.refresh()); }
  }

  function createEmptyExecution() {
    return { operations: [], snapshots: [], transitions: [], cursor: 0, error: null, startedAt: null, elapsed: null, hasRun: false };
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeMachine(name = 'Minha primeira máquina') {
    return {
      id: uid(), name, machineJson: AutomataFormat.stringifyMachineYaml(DEFAULT_MACHINE),
      rule: DEFAULT_RULE, input: '1011', updatedAt: Date.now()
    };
  }

  function safeParseMachine(source) {
    return AutomataFormat.parseMachineSource(source);
  }

  function stateId(value) {
    return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'id') ? value.id : value;
  }

  function stateKey(value) {
    const id = stateId(value);
    if (id === null) return 'null';
    if (typeof id === 'object') return `object:${JSON.stringify(id)}`;
    return `${typeof id}:${String(id)}`;
  }

  function stateLabel(value) {
    if (value === null) return 'null';
    if (value && typeof value === 'object') {
      return String(value.label ?? value.name ?? value.id ?? JSON.stringify(value));
    }
    return String(value);
  }

  function formatTime(timestamp) {
    if (!timestamp) return 'Rascunho';
    const date = new Date(timestamp);
    return `Editado ${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function loadLibrary() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(parsed)) {
        machines = parsed.filter((m) => m && typeof m.id === 'string' && typeof m.machineJson === 'string' && typeof m.rule === 'string');
      }
    } catch (_) { machines = []; }
  }

  function persistLibrary() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(machines));
      if (current && !currentEphemeral) localStorage.setItem(LAST_KEY, current.id);
      els.savedIndicator.innerHTML = '<span class="save-dot"></span> Salvo localmente';
      els.updatedLabel.textContent = formatTime(current?.updatedAt);
    } catch (error) {
      els.savedIndicator.textContent = 'Falha ao salvar';
      toast('Não foi possível salvar no localStorage. Verifique o espaço disponível.', true);
    }
  }

  function scheduleSave() {
    if (!current) return;
    current.updatedAt = Date.now();
    els.savedIndicator.innerHTML = '<span class="save-dot" style="background:#e7c47c"></span> Salvando…';
    els.updatedLabel.textContent = formatTime(current.updatedAt);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (currentEphemeral) {
        els.savedIndicator.innerHTML = '<span class="save-dot" style="background:#e7c47c"></span> Não salvo';
        return;
      }
      const index = machines.findIndex((m) => m.id === current.id);
      if (index >= 0) machines[index] = clone(current);
      else machines.unshift(clone(current));
      persistLibrary();
      renderMachineList();
    }, 250);
  }

  function flushCurrentSave() {
    clearTimeout(saveTimer);
    if (!current || currentEphemeral) return;
    const index = machines.findIndex((machine) => machine.id === current.id);
    if (index >= 0) machines[index] = clone(current);
    else machines.unshift(clone(current));
    persistLibrary();
    renderMachineList();
  }

  function renderMachineList() {
    els.machineList.innerHTML = '';
    els.machineCount.textContent = String(machines.length);
    if (!machines.length) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';
      empty.textContent = 'Sua biblioteca está vazia. Crie uma máquina para começar.';
      els.machineList.appendChild(empty);
      return;
    }
    machines.forEach((machine) => {
      const wrap = document.createElement('div');
      wrap.className = 'machine-item-wrap';
      const button = document.createElement('button');
      button.className = `machine-item${current && machine.id === current.id && !currentEphemeral ? ' active' : ''}`;
      button.type = 'button';
      button.innerHTML = `<span class="machine-glyph">◎</span><span class="machine-item-copy"><strong></strong><small></small></span>`;
      button.querySelector('strong').textContent = machine.name || 'Máquina sem nome';
      const parsed = safeParseMachine(machine.machineJson);
      const stateTotal = parsed.ok ? parsed.value.states.length : 'YAML inválido';
      button.querySelector('small').textContent = `${stateTotal} ${typeof stateTotal === 'number' ? 'estados' : ''}`;
      button.addEventListener('click', () => openMachine(machine.id));
      const remove = document.createElement('button');
      remove.className = 'machine-delete';
      remove.type = 'button';
      remove.title = `Excluir ${machine.name || 'máquina'}`;
      remove.setAttribute('aria-label', remove.title);
      remove.textContent = '×';
      remove.addEventListener('click', (event) => { event.stopPropagation(); deleteMachine(machine.id); });
      wrap.append(button, remove);
      els.machineList.appendChild(wrap);
    });
  }

  function closeSidebar() {
    els.sidebar.classList.remove('open');
    els.mobileScrim.classList.remove('show');
  }

  function openSidebar() {
    els.sidebar.classList.add('open');
    els.mobileScrim.classList.add('show');
  }

  function openMachine(id) {
    flushCurrentSave();
    const found = machines.find((m) => m.id === id);
    if (!found) return;
    clearTimeout(saveTimer);
    current = clone(found);
    currentEphemeral = false;
    graphPositions = {};
    loadCurrentIntoUI();
    try { localStorage.setItem(LAST_KEY, current.id); } catch (_) { /* storage unavailable */ }
    renderMachineList();
    closeSidebar();
  }

  function loadCurrentIntoUI() {
    if (!current) return;
    els.machineName.value = current.name || 'Máquina sem nome';
    els.breadcrumbName.textContent = current.name || 'Máquina sem nome';
    const storedDefinition = safeParseMachine(current.machineJson);
    if (storedDefinition.ok && String(current.machineJson).trim().startsWith('{')) {
      current.machineJson = AutomataFormat.stringifyMachineYaml(storedDefinition.value);
      if (!currentEphemeral) scheduleSave();
    }
    els.machineEditor.value = current.machineJson;
    els.ruleEditor.value = current.rule;
    validateMachineEditor();
    validateRuleEditor();
    els.inputEditor.value = current.input;
    els.updatedLabel.textContent = formatTime(current.updatedAt);
    els.savedIndicator.innerHTML = currentEphemeral
      ? '<span class="save-dot" style="background:#e7c47c"></span> Não salvo'
      : '<span class="save-dot"></span> Salvo localmente';
    execution = createEmptyExecution();
    refreshMachinePreview();
    resetExecution(false);
  }

  function createNewMachine() {
    flushCurrentSave();
    const machine = makeMachine(machines.length ? 'Nova máquina' : 'Minha primeira máquina');
    machines.unshift(machine);
    current = clone(machine);
    currentEphemeral = false;
    persistLibrary();
    loadCurrentIntoUI();
    activateEditorTab('machine');
    renderMachineList();
    closeSidebar();
    els.machineName.focus();
    els.machineName.select();
    toast('Template de máquina criado. Personalize o objeto e a regra.');
  }

  function duplicateCurrent() {
    if (!current) return;
    flushCurrentSave();
    const copy = clone(current);
    copy.id = uid();
    copy.name = `${current.name || 'Máquina'} — cópia`;
    copy.updatedAt = Date.now();
    machines.unshift(copy);
    current = clone(copy);
    currentEphemeral = false;
    persistLibrary();
    loadCurrentIntoUI();
    activateEditorTab('machine');
    renderMachineList();
    toast('Cópia criada na sua biblioteca.');
  }

  function deleteMachine(id) {
    if (current && current.id !== id) flushCurrentSave();
    const item = machines.find((m) => m.id === id);
    if (!item) return;
    if (!window.confirm(`Excluir "${item.name || 'Máquina sem nome'}" da biblioteca?`)) return;
    machines = machines.filter((m) => m.id !== id);
    if (current && current.id === id) {
      if (machines.length) current = clone(machines[0]);
      else {
        current = makeMachine('Minha primeira máquina');
        machines.push(clone(current));
      }
      currentEphemeral = false;
      loadCurrentIntoUI();
    }
    try { localStorage.setItem(LAST_KEY, current.id); } catch (_) { /* ignore */ }
    persistLibrary();
    renderMachineList();
    toast('Máquina excluída.');
  }

  function refreshMachinePreview() {
    const result = safeParseMachine(els.machineEditor.value);
    parsedMachine = result.ok ? result.value : null;
    if (!result.ok) {
      if (els.machineStatus) { els.machineStatus.textContent = 'YAML inválido'; els.machineStatus.style.color = 'var(--red)'; }
      validateMachineEditor();
      els.stateCount.textContent = result.error;
      els.alphabetLabel.textContent = 'Alfabeto: —';
      drawGraph(null);
      setInputStatus('Corrija a definição YAML antes de executar.', false);
      updateExecutionView();
      return;
    }
    if (els.machineStatus) { els.machineStatus.textContent = 'YAML válido'; els.machineStatus.style.color = 'var(--accent)'; }
    validateMachineEditor();
    els.stateCount.textContent = `${result.value.states.length} ${result.value.states.length === 1 ? 'estado' : 'estados'}`;
    els.alphabetLabel.textContent = `Alfabeto: { ${result.value.alphabet.map(stateLabel).join(', ')} }`;
    els.machineTypeChip.textContent = inferMachineType(result.value);
    drawGraph(result.value);
    validateInputOnly();
    updateExecutionView();
  }

  function inferMachineType(machine) {
    if (Array.isArray(machine.tape) || Object.prototype.hasOwnProperty.call(machine, 'head')) return 'Máquina de fita';
    if (Array.isArray(machine.stack) || Object.prototype.hasOwnProperty.call(machine, 'stack')) return 'Máquina com pilha';
    if (machine.transitions && typeof machine.transitions === 'object') return 'Máquina de estados';
    return 'Máquina personalizada';
  }

  function equalValue(a, b) {
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }

  function tokenizeInput(raw, alphabet) {
    const value = raw.trim();
    if (!value) return { ok: true, operations: [] };
    if (value.startsWith('[')) {
      try {
        const arr = JSON.parse(value);
        if (!Array.isArray(arr)) return { ok: false, error: 'A entrada JSON precisa ser um array.' };
        return { ok: true, operations: arr };
      } catch (error) { return { ok: false, error: `Array JSON inválido: ${error.message}` }; }
    }
    const symbols = alphabet.filter((symbol) => typeof symbol === 'string' && symbol.length > 0).slice().sort((a, b) => b.length - a.length);
    if (!symbols.length) return { ok: false, error: 'Para digitar a entrada como texto, defina símbolos string não vazios no alfabeto. Ou use um array JSON.' };
    const operations = [];
    let index = 0;
    while (index < value.length) {
      const match = symbols.find((symbol) => value.startsWith(symbol, index));
      if (!match) return { ok: false, error: `Nenhum símbolo do alfabeto corresponde ao trecho na posição ${index + 1}.` };
      operations.push(match);
      index += match.length;
    }
    return { ok: true, operations };
  }

  function validateInputOnly() {
    if (!parsedMachine) return;
    const parsed = tokenizeInput(els.inputEditor.value, parsedMachine.alphabet);
    if (!parsed.ok) { setInputStatus(parsed.error, false); return; }
    const invalid = parsed.operations.find((op) => !parsedMachine.alphabet.some((symbol) => equalValue(symbol, op)));
    if (invalid !== undefined) {
      setInputStatus(`Símbolo ${JSON.stringify(invalid)} não pertence ao alfabeto da máquina.`, false);
      return;
    }
    setInputStatus(`${parsed.operations.length} ${parsed.operations.length === 1 ? 'símbolo validado' : 'símbolos validados'} · entrada compatível com o alfabeto.`, true);
  }

  function setInputStatus(message, valid) {
    els.inputStatus.textContent = message;
    els.inputStatus.style.color = valid ? '#8fbf91' : '#e59a9e';
  }

  function getValidatedOperations() {
    if (!parsedMachine) throw new Error('O objeto da máquina contém erros.');
    const result = tokenizeInput(els.inputEditor.value, parsedMachine.alphabet);
    if (!result.ok) throw new Error(result.error);
    for (let index = 0; index < result.operations.length; index += 1) {
      const op = result.operations[index];
      if (!parsedMachine.alphabet.some((symbol) => equalValue(symbol, op))) {
        throw new Error(`O símbolo ${JSON.stringify(op)} na posição ${index + 1} não pertence ao alfabeto.`);
      }
    }
    return result.operations;
  }

  function refreshCurrentFromFields() {
    if (!current) return;
    current.name = els.machineName.value.trim() || 'Máquina sem nome';
    current.machineJson = els.machineEditor.value;
    current.rule = els.ruleEditor.value;
    current.input = els.inputEditor.value;
    els.breadcrumbName.textContent = current.name;
    scheduleSave();
  }

  function onMachineEdited() {
    refreshCurrentFromFields();
    refreshMachinePreview();
    resetExecution(false);
  }

  function onRuleEdited() {
    refreshCurrentFromFields();
    validateRuleEditor();
    resetExecution(false);
    updateExecutionView();
  }

  function onInputEdited() {
    refreshCurrentFromFields();
    resetExecution(false);
    validateInputOnly();
    updateExecutionView();
  }

  function resetExecution(showToast = true) {
    execution = createEmptyExecution();
    if (parsedMachine) execution.snapshots = [clone(parsedMachine)];
    updateExecutionView();
    if (showToast) toast('Execução reiniciada.');
    if (parsedMachine) drawGraph(parsedMachine);
  }

  function drawGraph(machine) {
    const svg = els.stateGraph;
    if (!machine || !Array.isArray(machine.states) || !machine.states.length) {
      svg.innerHTML = '';
      els.graphEmpty.hidden = false;
      els.graphSummary.textContent = 'Sem estados';
      return;
    }
    els.graphEmpty.hidden = true;
    const states = machine.states;
    const count = states.length;
    const cx = 340, cy = 202;
    const radius = count <= 2 ? 116 : count <= 7 ? 145 : count <= 12 ? 160 : 169;
    const cacheKey = current ? current.id : 'temp';
    if (!graphPositions[cacheKey]) graphPositions[cacheKey] = {};
    const positions = graphPositions[cacheKey];
    const coords = new Map();
    states.forEach((state, index) => {
      const key = stateKey(state);
      if (!positions[key]) {
        const angle = count === 2 ? Math.PI * index : -Math.PI / 2 + (Math.PI * 2 * index / count);
        positions[key] = { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
      }
      coords.set(key, positions[key]);
    });
    const edgesMap = new Map();
    const addEdge = (from, to, label, observed = false) => {
      const fromKey = stateKey(from), toKey = stateKey(to);
      const key = `${fromKey}→${toKey}`;
      const existing = edgesMap.get(key) || { from, to, labels: [], observed: false };
      if (!existing.labels.some((v) => equalValue(v, label))) existing.labels.push(label);
      existing.observed = existing.observed || observed;
      edgesMap.set(key, existing);
    };
    if (machine.transitions && typeof machine.transitions === 'object') {
      Object.entries(machine.transitions).forEach(([from, map]) => {
        if (!map || typeof map !== 'object') return;
        const state = states.find((item) => String(stateId(item)) === from) ?? from;
        Object.entries(map).forEach(([operation, to]) => addEdge(state, to, operation));
      });
    }
    execution.transitions.forEach((item) => addEdge(item.from, item.to, item.operation, true));

    const hasStop = Array.from(edgesMap.values()).some((edge) => edge.to === null);
    const stop = { x: 603, y: 345 };
    const getPoint = (state) => state === null ? stop : coords.get(stateKey(state));
    const edgeValues = Array.from(edgesMap.values());
    const defs = `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L7,3 z" fill="#8292a9" /></marker><marker id="arrowGreen" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L7,3 z" fill="#a6e3a1" /></marker></defs>`;
    let edgeMarkup = '';
    const edgePairCounts = new Map();
    edgeValues.forEach((edge) => {
      const key = [stateKey(edge.from), stateKey(edge.to)].sort().join('|');
      edgePairCounts.set(key, (edgePairCounts.get(key) || 0) + 1);
    });
    const edgePairSeen = new Map();
    edgeValues.forEach((edge) => {
      const start = getPoint(edge.from), end = getPoint(edge.to);
      if (!start || !end) return;
      const labels = edge.labels.map((v) => String(v)).join(', ');
      if (stateKey(edge.from) === stateKey(edge.to)) {
        const x = start.x, y = start.y;
        const d = `M ${x - 13} ${y - 24} C ${x - 58} ${y - 80}, ${x + 58} ${y - 80}, ${x + 13} ${y - 24}`;
        edgeMarkup += `<path class="edge ${edge.observed ? 'observed' : ''}" d="${d}" ${edge.observed ? 'marker-end="url(#arrowGreen)"' : ''}/><text class="edge-label" x="${x}" y="${y - 73}" text-anchor="middle">${escapeXml(labels)}</text>`;
      } else {
        const dx = end.x - start.x, dy = end.y - start.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        const nx = -dy / len, ny = dx / len;
        const pair = [stateKey(edge.from), stateKey(edge.to)].sort().join('|');
        const index = edgePairSeen.get(pair) || 0;
        edgePairSeen.set(pair, index + 1);
        const curveOffset = (edgePairCounts.get(pair) > 1 ? (index % 2 === 0 ? 1 : -1) * 24 : 0);
        const sx = start.x + dx / len * 27, sy = start.y + dy / len * 27;
        const ex = end.x - dx / len * (edge.to === null ? 20 : 28), ey = end.y - dy / len * (edge.to === null ? 20 : 28);
        const qx = (sx + ex) / 2 + nx * curveOffset, qy = (sy + ey) / 2 + ny * curveOffset;
        const lx = .25 * sx + .5 * qx + .25 * ex, ly = .25 * sy + .5 * qy + .25 * ey - 7;
        const path = `M ${sx} ${sy} Q ${qx} ${qy} ${ex} ${ey}`;
        edgeMarkup += `<path class="edge ${edge.observed ? 'observed' : ''}" d="${path}" ${edge.observed ? 'marker-end="url(#arrowGreen)"' : ''}/><text class="edge-label" x="${lx}" y="${ly}" text-anchor="middle">${escapeXml(labels)}</text>`;
      }
    });
    let nodeMarkup = '';
    const initialState = Object.prototype.hasOwnProperty.call(machine, 'initialState') ? machine.initialState : machine.state;
    const initialKey = stateKey(initialState);
    const activeMachine = execution.snapshots.length ? execution.snapshots[Math.min(execution.cursor, execution.snapshots.length - 1)] : machine;
    const activeKey = stateKey(activeMachine?.state);
    states.forEach((state) => {
      const key = stateKey(state);
      const p = coords.get(key);
      const isInitial = key === initialKey;
      const isCurrent = key === activeKey;
      const label = stateLabel(state);
      const shortLabel = label.length > 14 ? `${label.slice(0, 12)}…` : label;
      const sub = isInitial ? 'INICIAL' : '';
      nodeMarkup += `<g class="state-node ${isInitial ? 'initial' : ''} ${isCurrent ? 'current' : ''}" data-state-key="${escapeXml(key)}" transform="translate(${p.x} ${p.y})" tabindex="0" role="img" aria-label="Estado ${escapeXml(label)}">${isCurrent ? '<circle class="node-halo" r="34"/>' : ''}<circle class="node-circle" r="26"/><text class="node-label" y="1">${escapeXml(shortLabel)}</text>${sub ? '<text class="node-initial-tag" y="42">INICIAL</text>' : ''}</g>`;
    });
    if (hasStop) nodeMarkup += `<g transform="translate(${stop.x} ${stop.y})"><rect class="stop-node" x="-30" y="-16" width="60" height="32" rx="7"/><text class="stop-label">null / fim</text></g>`;
    const initPoint = coords.get(stateKey(initialState));
    const startArrow = initPoint ? `<path d="M ${initPoint.x - 55} ${initPoint.y} L ${initPoint.x - 31} ${initPoint.y}" stroke="#a6e3a1" stroke-width="1.7" fill="none" marker-end="url(#arrowGreen)"/>` : '';
    svg.innerHTML = defs + edgeMarkup + startArrow + nodeMarkup;
    els.graphSummary.textContent = `${count} ${count === 1 ? 'estado' : 'estados'} · ${edgeValues.length} ${edgeValues.length === 1 ? 'transição' : 'transições'}${hasStop ? ' · inclui parada' : ''}`;
    bindGraphDragging();
  }

  function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
  }

  function bindGraphDragging() {
    const svg = els.stateGraph;
    svg.onpointerdown = (event) => {
      const node = event.target.closest?.('.state-node');
      if (!node) return;
      const key = node.dataset.stateKey;
      const cacheKey = current ? current.id : 'temp';
      dragState = { key, cacheKey };
      try { svg.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
      event.preventDefault();
    };
    svg.onpointermove = (event) => {
      if (!dragState) return;
      const rect = svg.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * 680;
      const y = (event.clientY - rect.top) / rect.height * 420;
      const positions = graphPositions[dragState.cacheKey];
      if (positions && positions[dragState.key]) {
        positions[dragState.key] = { x: Math.max(35, Math.min(645, x)), y: Math.max(35, Math.min(385, y)) };
        drawGraph(parsedMachine);
      }
    };
    svg.onpointerup = () => { dragState = null; };
    svg.onpointercancel = () => { dragState = null; };
  }

  function updateExecutionView() {
    const validMachine = parsedMachine;
    const previewInput = validMachine ? tokenizeInput(els.inputEditor.value, validMachine.alphabet) : null;
    const previewInputValid = !!previewInput && previewInput.ok && previewInput.operations.every((op) => validMachine.alphabet.some((symbol) => equalValue(symbol, op)));
    const inputInvalid = !!validMachine && !previewInputValid;
    const ops = (execution.hasRun || execution.operations.length) ? execution.operations : (previewInputValid ? previewInput.operations : []);
    const snapshots = execution.snapshots;
    const cursor = execution.cursor;
    els.stepCounter.textContent = `${cursor} / ${ops.length} passos`;
    els.tokenTrack.innerHTML = '';
    if (!validMachine || !ops.length) {
      const placeholder = document.createElement('span');
      placeholder.className = 'track-placeholder';
      placeholder.textContent = !validMachine ? 'Corrija o objeto da máquina para visualizar a execução.' : inputInvalid ? 'Corrija o input para visualizar os símbolos.' : 'Entrada vazia: a máquina não tem símbolos para processar.';
      els.tokenTrack.appendChild(placeholder);
    } else {
      ops.forEach((operation, index) => {
        const token = document.createElement('span');
        token.className = `token ${index < cursor ? 'done' : index === cursor && !execution.error ? 'current' : 'upcoming'}`;
        token.textContent = String(operation);
        token.title = `Símbolo ${index + 1}: ${String(operation)}`;
        els.tokenTrack.appendChild(token);
      });
    }
    const machineAtCursor = snapshots.length ? snapshots[Math.min(cursor, snapshots.length - 1)] : validMachine;
    els.currentState.textContent = machineAtCursor ? stateLabel(machineAtCursor.state) : '—';
    if (execution.transitions.length) {
      const transition = execution.transitions[execution.transitions.length - 1];
      els.lastTransition.textContent = `${stateLabel(transition.from)} —${String(transition.operation)}→ ${stateLabel(transition.to)}`;
    } else els.lastTransition.textContent = '—';

    const status = els.executionStatus;
    status.className = 'execution-status';
    if (execution.error) {
      status.classList.add('error'); status.innerHTML = '<i></i> Erro';
    } else if (execution.hasRun && machineAtCursor?.state === null) {
      status.classList.add('done'); status.innerHTML = '<i></i> Parada';
    } else if (execution.hasRun && cursor >= ops.length) {
      status.classList.add('done'); status.innerHTML = '<i></i> Concluída';
    } else if (execution.hasRun && cursor > 0) {
      status.classList.add('running'); status.innerHTML = '<i></i> Em execução';
    } else {
      status.classList.add('idle'); status.innerHTML = '<i></i> Aguardando';
    }

    let resultText = 'Não iniciado';
    let resultClass = 'result-muted';
    if (execution.error) { resultText = 'Erro na regra'; resultClass = 'result-reject'; }
    else if (execution.hasRun && machineAtCursor?.state === null) { resultText = 'Parada (null)'; resultClass = 'result-muted'; }
    else if (execution.hasRun && cursor >= ops.length) {
      const accepting = Array.isArray(machineAtCursor?.acceptingStates) ? machineAtCursor.acceptingStates : null;
      if (accepting) {
        const accepted = accepting.some((state) => stateKey(state) === stateKey(machineAtCursor.state));
        resultText = accepted ? 'Aceita' : 'Rejeitada';
        resultClass = accepted ? 'result-accept' : 'result-reject';
      } else { resultText = 'Finalizado'; resultClass = 'result-accept'; }
    } else if (execution.hasRun) { resultText = 'Em andamento'; resultClass = ''; }
    els.runResult.textContent = resultText;
    els.runResult.className = resultClass;
    els.executionTime.textContent = execution.elapsed !== null ? `${execution.elapsed} ms` : '';

    if (els.historyCount) els.historyCount.textContent = `${execution.transitions.length + (execution.error ? 1 : 0)} eventos`;
    els.executionLog.innerHTML = '';
    if (execution.error) {
      const err = document.createElement('div');
      err.className = 'log-row log-error';
      err.innerHTML = `<span class="log-index">ERR</span><span class="log-route"></span><span class="log-op">falha</span>`;
      err.querySelector('.log-route').textContent = `Passo ${execution.error.step + 1}: ${execution.error.message}`;
      els.executionLog.appendChild(err);
    }
    if (!execution.transitions.length && !execution.error) {
      const placeholder = document.createElement('div');
      placeholder.className = 'log-placeholder';
      placeholder.innerHTML = '<span class="log-icon">⌁</span> Execute a máquina para ver o histórico de transições.';
      els.executionLog.appendChild(placeholder);
    } else {
      execution.transitions.slice(-30).forEach((transition, visibleIndex) => {
        const row = document.createElement('div');
        row.className = 'log-row';
        row.innerHTML = `<span class="log-index">${String(Math.max(0, execution.transitions.length - 30) + visibleIndex + 1).padStart(2, '0')}</span><span class="log-route"></span><span class="log-op"></span>`;
        row.querySelector('.log-route').innerHTML = `<b>${escapeXml(stateLabel(transition.from))}</b> → <b>${escapeXml(stateLabel(transition.to))}</b>`;
        row.querySelector('.log-op').textContent = String(transition.operation);
        els.executionLog.appendChild(row);
      });
    }
    if (validMachine) drawGraph(validMachine);
    const finished = execution.hasRun && (cursor >= ops.length || machineAtCursor?.state === null || execution.error);
    const canRun = !!validMachine && machineIsValid && ruleIsValid;
    els.stepButton.disabled = !canRun || !!execution.error || finished;
    els.runAllButton.disabled = !canRun;
    els.stepButton.style.opacity = els.stepButton.disabled ? '.5' : '1';
    els.runAllButton.style.opacity = els.runAllButton.disabled ? '.5' : '1';
  }

  function createWorkerSource() {
    return `
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const stateId = (value) => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'id') ? value.id : value;
      const stateKey = (value) => {
        const id = stateId(value);
        if (id === null) return 'null';
        if (typeof id === 'object') return 'object:' + JSON.stringify(id);
        return typeof id + ':' + String(id);
      };
      self.onmessage = async (event) => {
        const data = event.data;
        const snapshots = [];
        const transitions = [];
        let machine;
        try {
          machine = clone(data.machine);
          const rule = new Function('operation', 'machine', 'context', '"use strict";\\n' + data.code);
          const contextHistory = clone(data.history || []);
          for (let offset = 0; offset < data.operations.length; offset += 1) {
            const operation = data.operations[offset];
            const absoluteStep = data.startIndex + offset;
            const before = clone(machine.state);
            const context = {
              step: absoluteStep,
              index: absoluteStep,
              input: clone(data.fullInput),
              remaining: clone(data.fullInput.slice(absoluteStep + 1)),
              history: clone(contextHistory)
            };
            let nextState;
            try { nextState = rule(operation, machine, context); }
            catch (error) { throw Object.assign(new Error(error && error.message ? error.message : String(error)), { automataStep: absoluteStep }); }
            if (nextState && typeof nextState.then === 'function') nextState = await nextState;
            if (nextState === undefined) throw Object.assign(new Error('A regra retornou undefined. Retorne o próximo estado ou null para parar.'), { automataStep: absoluteStep });
            machine.state = nextState;
            if (nextState !== null) {
              const states = Array.isArray(machine.states) ? machine.states : [];
              if (!states.some((state) => stateKey(state) === stateKey(nextState))) {
                throw Object.assign(new Error('Estado inválido: ' + String(nextState) + '. Inclua-o em machine.states ou retorne null.'), { automataStep: absoluteStep });
              }
            }
            transitions.push({ from: before, operation: clone(operation), to: clone(nextState) });
            snapshots.push(clone(machine));
            contextHistory.push(clone(machine));
            if (nextState === null) break;
          }
          self.postMessage({ ok: true, snapshots, transitions });
        } catch (error) {
          self.postMessage({ ok: false, snapshots, transitions, error: { message: error && error.message ? error.message : String(error), step: Number.isInteger(error && error.automataStep) ? error.automataStep : data.startIndex + snapshots.length } });
        }
      };
    `;
  }

  function runInWorker(machine, code, operations, startIndex, fullInput, history) {
    return new Promise((resolve, reject) => {
      let worker;
      let objectUrl;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (worker) worker.terminate();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('A regra excedeu o limite de execução (1,8 s). Verifique se existe um loop infinito.')), MAX_WORKER_TIME);
      try {
        const blob = new Blob([createWorkerSource()], { type: 'text/javascript' });
        objectUrl = URL.createObjectURL(blob);
        worker = new Worker(objectUrl);
        worker.onmessage = (event) => finish(resolve, event.data);
        worker.onerror = (event) => finish(reject, new Error(event.message || 'Falha ao executar a regra no Web Worker.'));
        worker.postMessage({ machine, code, operations, startIndex, fullInput, history });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function runOneStep() {
    if (!parsedMachine || !machineIsValid) { toast('Corrija o objeto da máquina antes de executar.', true); return; }
    if (!validateRuleEditor()) { toast('Corrija a regra JavaScript antes de executar.', true); return; }
    let operations;
    try { operations = getValidatedOperations(); }
    catch (error) { setInputStatus(error.message, false); toast(error.message, true); return; }
    if (!execution.snapshots.length) execution.snapshots = [clone(parsedMachine)];
    if (!execution.operations.length) execution.operations = operations;
    if (execution.cursor >= operations.length) { toast('A entrada já foi totalmente processada.'); return; }
    const currentSnapshot = execution.snapshots[Math.min(execution.cursor, execution.snapshots.length - 1)];
    if (currentSnapshot.state === null) { toast('A máquina já está parada (state: null).'); return; }
    els.stepButton.disabled = true;
    els.executionStatus.className = 'execution-status running';
    els.executionStatus.innerHTML = '<i></i> Executando';
    const started = performance.now();
    try {
      const result = await runInWorker(currentSnapshot, els.ruleEditor.value, [operations[execution.cursor]], execution.cursor, operations, execution.snapshots.slice(0, execution.cursor + 1));
      execution.hasRun = true;
      execution.startedAt = execution.startedAt || Date.now();
      if (result.snapshots?.length) {
        execution.snapshots.push(...result.snapshots);
        execution.transitions.push(...result.transitions);
        execution.cursor += result.snapshots.length;
      }
      if (!result.ok) execution.error = result.error;
      execution.elapsed = Math.round(performance.now() - started);
    } catch (error) {
      execution.hasRun = true;
      execution.error = { message: error.message, step: execution.cursor };
      execution.elapsed = Math.round(performance.now() - started);
    }
    updateExecutionView();
  }

  async function runAll() {
    if (!parsedMachine || !machineIsValid) { toast('Corrija o objeto da máquina antes de executar.', true); return; }
    if (!validateRuleEditor()) { toast('Corrija a regra JavaScript antes de executar.', true); return; }
    let operations;
    try { operations = getValidatedOperations(); }
    catch (error) { setInputStatus(error.message, false); toast(error.message, true); return; }
    resetExecution(false);
    execution.operations = operations;
    execution.snapshots = [clone(parsedMachine)];
    execution.hasRun = true;
    execution.startedAt = Date.now();
    if (!operations.length) {
      execution.elapsed = 0;
      updateExecutionView();
      toast('Entrada vazia: nenhum passo foi necessário.');
      return;
    }
    els.runAllButton.disabled = true;
    els.executionStatus.className = 'execution-status running';
    els.executionStatus.innerHTML = '<i></i> Executando';
    const started = performance.now();
    try {
      const result = await runInWorker(parsedMachine, els.ruleEditor.value, operations, 0, operations, [clone(parsedMachine)]);
      execution.snapshots.push(...(result.snapshots || []));
      execution.transitions.push(...(result.transitions || []));
      execution.cursor = (result.snapshots || []).length;
      if (!result.ok) execution.error = result.error;
      execution.elapsed = Math.round(performance.now() - started);
    } catch (error) {
      execution.error = { message: error.message, step: 0 };
      execution.elapsed = Math.round(performance.now() - started);
    }
    updateExecutionView();
  }

  function toast(message, isError = false) {
    const node = document.createElement('div');
    node.className = `toast${isError ? ' error' : ''}`;
    node.textContent = message;
    els.toastRegion.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  function projectData(machine = current) {
    return {
      format: 'automata-project', version: 1,
      name: machine.name || 'Máquina sem nome',
      machineJson: machine.machineJson,
      rule: machine.rule,
      input: machine.input ?? ''
    };
  }

  function downloadProject(machine = current) {
    if (!machine) return;
    const data = JSON.stringify(projectData(machine), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slugify(machine.name || 'automata')}.automata.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Arquivo JSON exportado.');
  }

  function slugify(value) {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'automata';
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(encoded) {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function encodeSharedProject(project) {
    const input = new TextEncoder().encode(JSON.stringify(project));
    if ('CompressionStream' in window) {
      try {
        const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
        const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
        return `gz.${bytesToBase64Url(compressed)}`;
      } catch (_) { /* fall back to plain Base64URL */ }
    }
    return `b64.${bytesToBase64Url(input)}`;
  }

  async function decodeSharedProject(value) {
    const dot = value.indexOf('.');
    const type = dot >= 0 ? value.slice(0, dot) : 'b64';
    const bytes = base64UrlToBytes(dot >= 0 ? value.slice(dot + 1) : value);
    let raw = bytes;
    if (type === 'gz') {
      if (!('DecompressionStream' in window)) throw new Error('Este navegador não oferece suporte à descompressão gzip. Importe o arquivo JSON em vez do link.');
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const project = JSON.parse(new TextDecoder().decode(raw));
    return validateProject(project);
  }

  function validateProject(project) {
    if (!project || typeof project !== 'object') throw new Error('Arquivo de projeto inválido.');
    const machineJson = typeof project.machineJson === 'string' ? project.machineJson : project.machine ? JSON.stringify(project.machine, null, 2) : null;
    if (!machineJson || typeof project.rule !== 'string') throw new Error('O projeto precisa conter machineJson e rule.');
    const parsed = safeParseMachine(machineJson);
    if (!parsed.ok) throw new Error(`Definição da máquina inválida: ${parsed.error}`);
    return {
      name: String(project.name || 'Máquina compartilhada').slice(0, 80),
      machineJson,
      rule: project.rule,
      input: String(project.input ?? '')
    };
  }

  async function openShareFromHash() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('share=')) return;
    try {
      const params = new URLSearchParams(hash.slice(1));
      const encoded = params.get('share');
      if (!encoded) return;
      pendingShared = await decodeSharedProject(encoded);
      showImportDialog(pendingShared);
    } catch (error) {
      toast(`Não foi possível abrir o compartilhamento: ${error.message}`, true);
    }
  }

  function showImportDialog(project) {
    els.importTitle.textContent = project.name;
    els.importDescription.textContent = 'Você recebeu uma máquina Automata. Confira os dados e salve uma cópia na sua biblioteca.';
    const parsed = safeParseMachine(project.machineJson);
    const states = parsed.ok ? parsed.value.states.length : 0;
    const alphabet = parsed.ok ? parsed.value.alphabet.length : 0;
    els.importMeta.innerHTML = '';
    [`${states} estados`, `${alphabet} símbolos`, `${new TextEncoder().encode(project.rule).length} bytes de regra`].forEach((label) => {
      const span = document.createElement('span'); span.textContent = label; els.importMeta.appendChild(span);
    });
    if (!els.importDialog.open) els.importDialog.showModal();
  }

  function importIntoLibrary(project, ephemeral = false) {
    const item = { id: uid(), name: project.name, machineJson: project.machineJson, rule: project.rule, input: project.input, updatedAt: Date.now() };
    if (ephemeral) {
      current = item;
      currentEphemeral = true;
    } else {
      machines.unshift(item);
      current = clone(item);
      currentEphemeral = false;
      persistLibrary();
      renderMachineList();
    }
    loadCurrentIntoUI();
    closeSidebar();
  }

  const VARIABLE_DOCUMENTATION = {
    operation: {
      title: 'operation — símbolo atual',
      intro: 'É o símbolo da entrada que a máquina está processando nesta chamada da regra. A cada passo, o Automata entrega exatamente um elemento da sequência de entrada.',
      sections: [
        ['Tipo e valor', 'O valor mantém o tipo definido no alfabeto: normalmente string, mas também pode ser número, booleano ou objeto. Símbolos numéricos devem ser escritos entre aspas no YAML quando representarem caracteres, por exemplo "0" e "1".'],
        ['Como usar', 'Compare o símbolo com os valores do seu alfabeto ou use-o para consultar a tabela de transições. Para símbolos compostos, a entrada pode ser informada como uma lista JSON, por exemplo ["push", "pop"].']
      ],
      example: 'if (operation === "0") {\n  return "q0";\n}\n\nreturn machine.transitions[machine.state]?.[operation] ?? null;'
    },
    machine: {
      title: 'machine — objeto mutável da máquina',
      intro: 'Contém todo o estado atual da máquina. O Automata entrega uma cópia isolada desse objeto à regra em cada passo. Você pode ler e modificar propriedades livremente; as alterações são incluídas no snapshot do próximo passo.',
      sections: [
        ['Campos convencionais', '<code>state</code>: estado atual; começa no estado inicial e é substituído pelo retorno da regra. <code>states</code>: lista de estados válidos (strings, números ou objetos com <code>id</code>). <code>alphabet</code>: lista de símbolos permitidos na entrada. <code>acceptingStates</code>: lista opcional de estados de aceitação, usada pelo simulador para indicar aceitação. <code>transitions</code>: mapa opcional de estado → símbolo → próximo estado, se quiser usar uma tabela convencional.'],
        ['Campos personalizados', 'Adicione qualquer dado que sua máquina precisar: <code>stack</code>, <code>tape</code>, <code>head</code>, <code>memory</code>, contadores, registradores, pilhas auxiliares ou objetos aninhados. O Automata não impõe um esquema fixo a esses campos.'],
        ['Retorno da regra', 'O valor retornado pela regra passa a ser <code>machine.state</code>. Ele precisa corresponder a um item de <code>machine.states</code>, comparado pelo <code>id</code> quando o estado for um objeto. Retornar <code>null</code> encerra a execução imediatamente. Retornar <code>undefined</code> é erro.']
      ],
      example: 'machine.stack.push(operation);\nmachine.head += 1;\n\nreturn machine.transitions[machine.state][operation];'
    },
    context: {
      title: 'context — contexto da execução',
      intro: 'É um objeto informativo criado pelo motor para a chamada atual. Use-o para saber em qual passo está, consultar a entrada original e observar snapshots anteriores.',
      sections: [
        ['step e index', 'Números inteiros com índice baseado em zero. Indicam a posição do símbolo atual na entrada. Os dois campos são aliases e possuem o mesmo valor.'],
        ['input', 'Cópia da sequência completa de símbolos que está sendo processada. É um array, inclusive quando o usuário digitou uma sequência simples como 0101.'],
        ['remaining', 'Array contendo os símbolos que vêm depois do símbolo atual. Não inclui <code>operation</code>.'],
        ['history', 'Array com snapshots anteriores da máquina, incluindo o snapshot disponível no início do passo atual. São cópias; alterar esse histórico não altera a máquina em execução.']
      ],
      example: 'if (context.remaining.length === 0) {\n  // Este é o último símbolo.\n}\n\nconsole.log(context.step, operation);'
    }
  };

  function openVariableDocumentation(name) {
    const doc = VARIABLE_DOCUMENTATION[name];
    if (!doc) return;
    els.variableDocTitle.textContent = doc.title;
    els.variableDocContent.innerHTML = '';
    const intro = document.createElement('p');
    intro.className = 'variable-doc-intro';
    intro.textContent = doc.intro;
    els.variableDocContent.appendChild(intro);
    doc.sections.forEach(([heading, body]) => {
      const section = document.createElement('section');
      section.className = 'variable-doc-section';
      const title = document.createElement('h3');
      title.textContent = heading;
      const paragraph = document.createElement('p');
      paragraph.innerHTML = body;
      section.append(title, paragraph);
      els.variableDocContent.appendChild(section);
    });
    if (doc.example) {
      const label = document.createElement('h3');
      label.className = 'variable-doc-example-title';
      label.textContent = 'Exemplo';
      const pre = document.createElement('pre');
      pre.className = 'help-code';
      pre.textContent = doc.example.replace(/\\n/g, '\n');
      els.variableDocContent.append(label, pre);
    }
    openDialog(els.variableDocsDialog);
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function bindEvents() {
    window.addEventListener('pagehide', flushCurrentSave);
    els.newMachineButton.addEventListener('click', createNewMachine);
    els.machineName.addEventListener('input', () => {
      refreshCurrentFromFields();
      els.breadcrumbName.textContent = current.name;
      renderMachineList();
    });
    els.machineEditor.addEventListener('input', onMachineEdited);
    els.ruleEditor.addEventListener('input', onRuleEdited);
    document.querySelectorAll('[data-editor-tab]').forEach((button) => {
      button.addEventListener('click', () => activateEditorTab(button.dataset.editorTab));
    });
    [els.machineDiagnostics, els.ruleDiagnostics].forEach((container) => {
      container?.addEventListener('click', (event) => {
        const target = event.target.closest('[data-line]');
        if (!target) return;
        const editorTab = container === els.machineDiagnostics ? 'machine' : 'rule';
        activateEditorTab(editorTab);
        const editor = els[editorTab === 'machine' ? 'machineEditor' : 'ruleEditor'];
        editor.jumpToLine(Number(target.dataset.line), Number(target.dataset.column || 0));
      });
    });
    els.inputEditor.addEventListener('input', onInputEdited);
    els.formatMachineButton.addEventListener('click', () => {
      const parsed = safeParseMachine(els.machineEditor.value);
      if (!parsed.ok) { toast(`Não foi possível formatar: ${parsed.error}`, true); return; }
      els.machineEditor.value = AutomataFormat.stringifyMachineYaml(parsed.value);
      onMachineEdited();
      toast('Definição YAML formatada.');
    });
    els.parseInputButton.addEventListener('click', () => {
      try { getValidatedOperations(); validateInputOnly(); toast('Input compatível com o alfabeto.'); }
      catch (error) { setInputStatus(error.message, false); toast(error.message, true); }
    });
    els.ruleHelpButton.addEventListener('click', () => openDialog(els.helpDialog));
    document.querySelectorAll('[data-variable-doc]').forEach((button) => {
      button.addEventListener('click', () => openVariableDocumentation(button.dataset.variableDoc));
    });
    els.helpButton.addEventListener('click', () => { openDialog(els.helpDialog); closeSidebar(); });
    els.topHelpButton.addEventListener('click', () => openDialog(els.helpDialog));
    els.openSidebar.addEventListener('click', openSidebar);
    els.closeSidebar.addEventListener('click', closeSidebar);
    els.mobileScrim.addEventListener('click', closeSidebar);
    els.duplicateButton.addEventListener('click', duplicateCurrent);
    els.exportButton.addEventListener('click', () => downloadProject());
    els.shareButton.addEventListener('click', () => { els.shareFeedback.textContent = ''; els.shareLinkField.value = ''; els.shareLinkField.hidden = true; openDialog(els.shareDialog); });
    els.copyShareLinkButton.addEventListener('click', async () => {
      if (!current) return;
      els.copyShareLinkButton.disabled = true;
      els.shareFeedback.textContent = 'Preparando link…';
      try {
        const encoded = await encodeSharedProject(projectData());
        const url = new URL(window.location.href);
        url.hash = `share=${encoded}`;
        const link = url.toString();
        if (link.length > 30000) {
          els.shareFeedback.textContent = 'O link ficou muito grande. Use a opção de exportar JSON para compartilhar esta máquina.';
          return;
        }
        els.shareLinkField.value = link;
        els.shareLinkField.hidden = false;
        try {
          await navigator.clipboard.writeText(link);
          els.shareFeedback.textContent = `Link copiado (${Math.round(link.length / 1024 * 10) / 10} KB). Quem abrir poderá salvar uma cópia.`;
          toast('Link compartilhável copiado.');
        } catch (_) {
          els.shareLinkField.focus();
          els.shareLinkField.select();
          els.shareFeedback.textContent = `Link gerado (${Math.round(link.length / 1024 * 10) / 10} KB). Se não foi copiado, selecione o campo acima e copie o conteúdo.`;
        }
      } catch (error) {
        els.shareFeedback.textContent = `Não foi possível gerar o link: ${error.message}`;
      } finally { els.copyShareLinkButton.disabled = false; }
    });
    els.shareExportButton.addEventListener('click', () => downloadProject());
    els.importButton.addEventListener('click', () => { closeSidebar(); els.fileInput.click(); });
    els.fileInput.addEventListener('change', async () => {
      const file = els.fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        let project = null;
        try {
          const parsedFile = JSON.parse(text);
          if (parsedFile && (parsedFile.format === 'automata-project' || typeof parsedFile.rule === 'string')) {
            project = validateProject(parsedFile);
          } else {
            const machine = AutomataFormat.parseMachineSource(text);
            if (!machine.ok) throw new Error(machine.error);
            project = { name: file.name.replace(/\.(automata\.)?(json|ya?ml)$/i, '') || 'Máquina importada', machineJson: AutomataFormat.stringifyMachineYaml(machine.value), rule: DEFAULT_RULE, input: '' };
          }
        } catch (jsonError) {
          const machine = AutomataFormat.parseMachineSource(text);
          if (!machine.ok) throw new Error(machine.error || jsonError.message);
          project = { name: file.name.replace(/\.(automata\.)?(json|ya?ml)$/i, '') || 'Máquina importada', machineJson: AutomataFormat.stringifyMachineYaml(machine.value), rule: DEFAULT_RULE, input: '' };
        }
        importIntoLibrary(project, false);
        toast('Máquina importada para sua biblioteca.');
      } catch (error) { toast(`Falha ao importar: ${error.message}`, true); }
      els.fileInput.value = '';
    });
    els.saveSharedButton.addEventListener('click', () => {
      if (!pendingShared) return;
      importIntoLibrary(pendingShared, false);
      pendingShared = null;
      els.importDialog.close();
      toast('Máquina salva na sua biblioteca.');
      cleanShareHash();
    });
    els.openSharedButton.addEventListener('click', () => {
      if (!pendingShared) return;
      importIntoLibrary(pendingShared, true);
      pendingShared = null;
      els.importDialog.close();
      toast('Máquina aberta sem salvar na biblioteca.');
      cleanShareHash();
    });
    els.runAllButton.addEventListener('click', runAll);
    els.stepButton.addEventListener('click', runOneStep);
    els.resetButton.addEventListener('click', () => resetExecution(true));
    els.graphResetButton.addEventListener('click', () => { graphPositions = {}; if (parsedMachine) drawGraph(parsedMachine); });
    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => $(button.dataset.close).close());
    });
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); createNewMachine();
      }
      if (event.key === 'Escape') closeSidebar();
    });
  }

  function cleanShareHash() {
    if (window.location.hash.includes('share=')) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }

  async function init() {
    setupCodeEditors();
    loadLibrary();
    bindEvents();
    if (!machines.length) {
      const starter = makeMachine('Minha primeira máquina');
      machines.push(starter);
      current = clone(starter);
      currentEphemeral = false;
      persistLibrary();
    } else {
      const lastId = (() => { try { return localStorage.getItem(LAST_KEY); } catch (_) { return null; } })();
      const last = machines.find((machine) => machine.id === lastId) || machines[0];
      current = clone(last);
      currentEphemeral = false;
    }
    loadCurrentIntoUI();
    activateEditorTab('machine');
    renderMachineList();
    await openShareFromHash();
  }

  init();
})();
