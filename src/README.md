# Automata

Ferramenta web estática para modelar, simular e compartilhar máquinas de teoria dos autômatos.

## Executar

Abra `index.html` em um navegador moderno ou publique a pasta em qualquer hospedagem estática (GitHub Pages, Netlify, Cloudflare Pages etc.). Não há backend, dependências ou etapa de build.

Para testar localmente com um servidor HTTP:

```bash
python -m http.server 8000
```

Depois, acesse `http://localhost:8000`.

> Alguns navegadores restringem Web Workers criados a partir de `blob:` em páginas abertas diretamente via `file://`. Nesse caso, use um servidor HTTP local ou hospede a pasta estaticamente.

## Recursos

- Editor do objeto JSON da máquina e da regra JavaScript de execução.
- Estados e transições exibidos em um diagrama SVG arrastável.
- Simulação passo a passo ou execução completa, com histórico.
- `null` como estado de parada.
- Biblioteca de várias máquinas persistida no `localStorage`.
- Recuperação automática da última máquina aberta.
- Compartilhamento por URL com dados compactados no fragmento e importação/exportação JSON.
- Regras executadas em um Web Worker separado, sem acesso ao DOM ou ao `localStorage` da aplicação.

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

## Compartilhamento

O link inclui uma representação gzip + Base64URL do projeto no fragmento da URL. Se a API de compressão não estiver disponível no navegador, o Automata usa Base64URL sem compressão. O link aponta para a instalação publicada do Automata; para projetos grandes, prefira exportar o arquivo JSON.
