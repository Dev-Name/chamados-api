const fs = require('fs');
const htmlFile = 'public/index.html';
const blkFile = 'tests/_an_newblk.js';
let src = fs.readFileSync(htmlFile, 'utf8');
let blk = fs.readFileSync(blkFile, 'utf8').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
const L = src.split('\n');
const blkLines = blk.split('\n');

// 1) âncora do início da função antiga (renderAnalysts), única ocorrência
const startIdx = L.findIndex((x) => /^\s*function renderAnalysts\(\) \{/.test(x));
if (startIdx < 0) { console.error('START anchor missing'); process.exit(1); }

// 2) âncora do início da função nova: primeira linha que começa a vinda do bloco
const firstLineOfBlk = blkLines[0];
const startOfScope = L.findIndex((x, i) => i === startIdx + 1 + blkLines.length - 1);
// encontre o fim do antigo escopo de renderAnalysts: linha que fecha a função
// procura a partir de startIdx a linha '}' no mesmo nível (função é nivel 1, indent 2 espaços)
let depth = 0, endIdx = -1;
for (let i = startIdx; i < L.length; i++) {
  const line = L[i];
  const open = (line.match(/\{/g) || []).length;
  const close = (line.match(/\}/g) || []).length;
  depth += open - close;
  if (depth === 0 && i > startIdx && /^\s*\}/.test(line)) { endIdx = i; break; }
}
if (endIdx < 0) { console.error('END anchor missing'); process.exit(1); }

// 3) âncora do handler #a-add (bloco atual logo após renderAnalysts)
const aAddIdx = L.findIndex((x, i) => i > endIdx && x.includes("getElementById('a-add')"));
if (aAddIdx < 0) { console.error('a-add anchor missing'); process.exit(1); }
// expande o bloco do handler de a-add até '});' no mesmo nível (dentro de addEventListener)
let d2 = 0, aAddEndIdx = -1;
for (let i = aAddIdx; i < L.length; i++) {
  const line = L[i];
  d2 += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
  if (d2 <= 0 && i > aAddIdx) { aAddEndIdx = i; break; }
}
if (aAddEndIdx < 0) { console.error('a-add end missing'); process.exit(1); }

// 4) novo handler #a-add: abre formulário de criação
const aAddNew = [
  "  document.getElementById('a-add').addEventListener('click', () => { openAnalystForm(null); });",
];

const out = L.slice(0, startIdx)
  .concat(blkLines)
  .concat([''])
  .concat(L.slice(endIdx + 1, aAddIdx))
  .concat(aAddNew)
  .concat(L.slice(aAddEndIdx + 1));

fs.writeFileSync(htmlFile, out.join('\n'), 'utf8');
console.log('OK. Removidas linhas', startIdx + 1, '..', endIdx + 1, '(renderAnalysts) e', aAddIdx + 1, '..', aAddEndIdx + 1, '(a-add). Novo total de linhas:', out.length);
