# Automata

Ferramenta web estática para modelar, simular e compartilhar máquinas de teoria dos autômatos.

## Executar

Abra `index.html` em um navegador moderno ou publique a pasta em qualquer hospedagem estática (GitHub Pages, Netlify, Cloudflare Pages etc.). Não há backend, etapa de build nem dependências remotas. Os arquivos JavaScript das bibliotecas usadas pelo editor ficam dentro de `vendor/`, então o realce de sintaxe e a análise estática funcionam offline.

Para testar localmente com um servidor HTTP:

```bash
python -m http.server 8000
```

Depois, acesse `http://localhost:8000`.

> Alguns navegadores restringem Web Workers criados a partir de `blob:` em páginas abertas diretamente via `file://`. Nesse caso, use um servidor HTTP local ou hospede a pasta estaticamente.

## Recursos

- Editor JSON e JavaScript com realce de sintaxe, números de linha, indentação, fechamento automático e correspondência de parênteses/colchetes.
- Análise imediata da sintaxe JSON e JavaScript. A estrutura JSON também é verificada quanto aos campos essenciais, estados duplicados, estados iniciais/finais e referências convencionais de transição.
- Diagnósticos clicáveis levam diretamente à linha do problema.
- Diagrama SVG arrastável e simulador exibidos lado a lado; os editores ficam em abas separadas para reduzir a poluição visual.
- Simulação passo a passo ou execução completa, com histórico expansível.
- `null` como estado de parada.
- Biblioteca de várias máquinas persistida no `localStorage` e recuperação da última máquina aberta.
- Compartilhamento por URL com dados compactados no fragmento e importação/exportação JSON.
- Regras executadas em um Web Worker separado, sem acesso ao DOM ou ao `localStorage` da aplicação.

A análise de JavaScript é estática: valida a sintaxe e verifica a presença de um retorno explícito. A validade do estado retornado e o comportamento da regra são conferidos durante a simulação, pois dependem dos dados e da execução concreta da máquina.

## Modelo básico

```json
{
  "state": "q0",
  "states": ["q0", "q1"],
  "alphabet": ["0", "1"],
  "acceptingStates": ["q1"],
  "transitions": {
    "q0": { "0": "q0", "1": "q1" },
    "q1": { "0": "q0", "1": "q1" }
  }
}
```

A regra recebe três argumentos: `operation`, `machine` e `context`. Exemplo:

```js
const next = machine.transitions[machine.state]?.[operation];
if (next === undefined) throw new Error("Transição não definida");
return next;
```

A regra pode alterar os demais campos de `machine` (por exemplo, `stack`, `tape`, `head` ou `memory`) e deve retornar o identificador do próximo estado. O estado retornado deve constar em `machine.states`, exceto `null`, que encerra a execução. Estados podem ser strings, números ou objetos com uma propriedade `id`.

O argumento `context` oferece `step`/`index` (posição do símbolo, começando em zero), `input` (entrada completa), `remaining` (símbolos seguintes) e `history` (snapshots anteriores da máquina). A regra também pode retornar uma `Promise`.

Para entradas com símbolos de um caractere, digite a sequência diretamente. Para símbolos compostos, use um array JSON, por exemplo `["push", "pop"]`.

## Bibliotecas locais

- [CodeMirror 5.58.3](https://codemirror.net/5/) — editor, modo JavaScript/JSON e addons de edição. Licença MIT.
- [Acorn 8.15.0](https://github.com/acornjs/acorn) — parser JavaScript usado para validar a sintaxe e inspecionar o retorno da regra. Licença MIT.

Os arquivos de execução estão em `vendor/`. Não é necessário acessar os endereços dos projetos para usar o Automata; os links acima são apenas créditos/documentação.

## Compartilhamento

O link inclui uma representação gzip + Base64URL do projeto no fragmento da URL. Se a API de compressão não estiver disponível no navegador, o Automata usa Base64URL sem compressão. O link aponta para a instalação publicada do Automata; para projetos grandes, prefira exportar o arquivo JSON.
