# Automata

Ferramenta web estática para modelar, simular e compartilhar máquinas de teoria dos autômatos.

## Executar

Abra `index.html` em um navegador moderno ou publique a pasta em qualquer hospedagem estática (GitHub Pages, Netlify, Cloudflare Pages etc.). Não há backend, etapa de build nem dependências remotas. O editor, o modo YAML, o parser de definições e a análise de JavaScript ficam dentro do projeto e funcionam offline.

Para testar localmente com um servidor HTTP:

```bash
python -m http.server 8000
```

Depois, acesse `http://localhost:8000`.

> Alguns navegadores restringem Web Workers criados a partir de `blob:` em páginas abertas diretamente via `file://`. Nesse caso, use um servidor HTTP local ou hospede a pasta estaticamente.

## Recursos

- Editor YAML e JavaScript com realce de sintaxe, números de linha, indentação, fechamento automático e correspondência de parênteses/colchetes.
- Parser YAML local e determinístico, sem chamadas de rede.
- Validação de estrutura e consistência: estados duplicados, estado inicial, estados de aceitação, origens/destinos de transições e símbolos fora do alfabeto.
- Diagnósticos clicáveis levam diretamente à linha do problema.
- Diagrama SVG arrastável e simulador exibidos lado a lado; os editores ficam em abas separadas.
- Simulação passo a passo ou execução completa, com histórico expansível.
- `null` como estado de parada.
- Biblioteca de várias máquinas persistida no `localStorage` e recuperação da última máquina aberta.
- Compartilhamento por URL com dados compactados no fragmento; importação de arquivos `.yaml`, `.yml`, `.json` e projetos `.automata.json`.
- Exportação de projeto completo em JSON, incluindo a definição YAML e a regra JavaScript.
- Regras executadas em um Web Worker separado, sem acesso ao DOM ou ao `localStorage` da aplicação.

## Formato da máquina

O arquivo de definição agora usa `machine.yaml`. YAML foi escolhido por ser mais compacto e legível que JSON, especialmente para máquinas com muitas transições. Cada mapa de transições pode ficar em uma única linha por estado:

```yaml
state: q0
states: [q0, q1]
alphabet: ["0", "1"]
acceptingStates: [q1]

transitions:
  q0: { "0": q0, "1": q1 }
  q1: { "0": q0, "1": q1 }
```

O parser embutido suporta o subconjunto de YAML usado para definições de dados: mapas e listas com indentação, mapas/listas em linha (`{...}` e `[...]`), strings simples e entre aspas, números, booleanos, `null`, comentários e strings multilinha `|`/`>`. Âncoras, aliases, tags customizadas, diretivas e múltiplos documentos YAML não fazem parte desse subconjunto.

Regras práticas:

- Identificadores como `q0` podem ser escritos sem aspas.
- Símbolos que representam caracteres numéricos devem ser strings: `alphabet: ["0", "1"]`. Sem aspas, `0` e `1` são números.
- Símbolos compostos podem ser strings, por exemplo `alphabet: [push, pop, "read blank"]`.
- Campos personalizados são permitidos. Use-os para pilhas, fitas, posições, memória, contadores e qualquer estrutura necessária à sua máquina.
- JSON legado continua sendo aceito na importação e é convertido para YAML quando a máquina é aberta.

Exemplo de dados adicionais para uma máquina de pilha ou fita:

```yaml
state: q0
states: [q0, q1]
alphabet: [a, b]
stack: [Z]
tape: ["_", a, b, "_"]
head: 1
memory:
  counter: 0
  flags: { accepted: false }
```

## Regra JavaScript

A regra recebe três argumentos. Os nomes são clicáveis no rodapé do editor e abrem a documentação completa de cada objeto.

- `operation`: símbolo atual da entrada.
- `machine`: objeto mutável com os campos convencionais (`state`, `states`, `alphabet`, `acceptingStates`, `transitions`) e quaisquer campos personalizados.
- `context`: contexto de execução com `step`, `index`, `input`, `remaining` e `history`.

Exemplo:

```js
const next = machine.transitions[machine.state]?.[operation];
if (next === undefined) throw new Error("Transição não definida");
return next;
```

A regra pode alterar os demais campos de `machine` (por exemplo, `stack`, `tape`, `head` ou `memory`) e deve retornar o identificador do próximo estado. O estado retornado deve constar em `machine.states`, exceto `null`, que encerra a execução. Retornar `undefined` é erro. A regra também pode retornar uma `Promise`.

Para entradas com símbolos de um caractere, digite a sequência diretamente. Para símbolos compostos, use um array JSON, por exemplo `["push", "pop"]`.

A análise de JavaScript usa Acorn: valida sintaxe e verifica a presença de um retorno explícito. O estado retornado e o comportamento da regra são conferidos durante a simulação, pois dependem dos dados e da execução concreta da máquina.

## Bibliotecas locais

- [CodeMirror 5](https://codemirror.net/5/) — editor e modos JavaScript/YAML, com addons de edição. Licença MIT.
- [Acorn 8.15.0](https://github.com/acornjs/acorn) — parser JavaScript usado para validar a sintaxe e inspecionar o retorno da regra. Licença MIT.
- `machine-format.js` — parser e serializador YAML subset do Automata, sem dependências externas.

Os arquivos de execução estão em `vendor/` e no diretório raiz. Não é necessário acessar os endereços dos projetos para usar o Automata; os links acima são apenas créditos/documentação.

## Compartilhamento

O link inclui uma representação gzip + Base64URL do projeto no fragmento da URL. Se a API de compressão não estiver disponível no navegador, o Automata usa Base64URL sem compressão. O link aponta para a instalação publicada do Automata; para projetos grandes, prefira exportar o arquivo `.automata.json`.
