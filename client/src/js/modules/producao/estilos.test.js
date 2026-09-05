import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// A RÉGUA QUE FALTAVA, e ela nasceu de um defeito que ficou invisível.
//
// O CSS DO CLIENTE É GLOBAL. Não há CSS Modules: cada `import './x.css'` de uma
// página entra no MESMO bundle, na ordem em que `modules/producao/index.js`
// importa as páginas, e a última declaração de uma propriedade ganha. Duas telas
// que batizam o bloco BEM com o mesmo nome não convivem -- elas se sobrescrevem,
// e quem perde é sempre a que foi importada primeiro.
//
// O CASO CONCRETO: `atividade-subfase` e `atividade-usuario` desenham, cada uma,
// uma linha do tempo, e as duas chamavam o bloco de `linha-tempo`. Em
// `linha-tempo__barra` uma pedia `position: absolute` (a faixa posicionada por
// porcentagem dentro do trilho) e a outra `position: relative` (a barra inteira
// da pessoa). A segunda é importada depois, então a barra da subfase virava um
// `<span>` inline sem largura: a tela "Atividade por subfase" desenhava os
// trilhos VAZIOS, com todas as faixas certas no DOM.
//
// POR QUE NENHUM TESTE PEGOU: o vitest roda com `css: false` (ver
// `vitest.config.js`), então o jsdom nunca aplica folha nenhuma e as duas telas
// continuavam verdes. Só a leitura das FOLHAS acha isto, e é o que este arquivo
// faz.
//
// O ALCANCE DESTA RÉGUA É O MÓDULO, e não o cliente. `folhasDe(AQUI)` varre
// `modules/producao/` e mais nada: uma página daqui que batize um bloco com o
// mesmo nome de um de `acervo`, de `mapoteca` ou de `client/src/css/*.css`
// continua invisível para este caso, embora o bundle seja o mesmo. Ampliar a
// varredura para `client/src` inteiro não é de uma linha: hoje existem 13 pares
// de classe declarada por duas folhas ali, a maioria legítima (componente
// global que uma página sobrescreve de propósito), então a régua maior precisa
// de uma lista de exceções nomeada, uma a uma.
const AQUI = join(fileURLToPath(import.meta.url), '..');

/** Todos os `.css` do módulo, em qualquer profundidade. */
function folhasDe(raiz) {
  const achadas = [];
  for (const nome of readdirSync(raiz)) {
    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) achadas.push(...folhasDe(caminho));
    else if (nome.endsWith('.css')) achadas.push(caminho);
  }
  return achadas;
}

/**
 * Classes UTILITÁRIAS GLOBAIS, que toda folha pode REFERENCIAR sem declarar.
 *
 * `hidden` mora em `css/base.css` e vale para o cliente inteiro; uma página que
 * escreve `.producao-painel__falhas.hidden` está compondo com ela, e não
 * batizando um bloco. Sem esta lista, a segunda página do módulo que fizesse o
 * mesmo deixaria a régua vermelha apontando uma colisão que não existe.
 */
const GLOBAIS = new Set(['hidden']);

/**
 * As classes que a folha DECLARA.
 *
 * Os comentários saem antes, senão uma classe citada numa explicação (e é o que
 * estes arquivos mais fazem) contaria como declaração. O `[0-9]` inicial fica de
 * fora porque `0.12` em `color-mix(... 12%)` casaria como a classe `12`.
 *
 * A leitura é GROSSA de propósito: toda ocorrência de `.nome` conta, inclusive a
 * de um seletor composto ou descendente. Quando isso passar a doer com outro
 * utilitário global, o nome dele entra em `GLOBAIS` -- ler qual das classes do
 * seletor é o SUJEITO exigiria um parser de CSS, e não vale a dependência.
 */
function classesDe(texto) {
  const semComentario = texto.replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = new Set();
  for (const achado of semComentario.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) {
    if (!GLOBAIS.has(achado[1])) classes.add(achado[1]);
  }
  return classes;
}

describe('o CSS do módulo produção é global, e os blocos não podem colidir', () => {
  test('nenhuma classe é declarada por duas folhas do módulo', () => {
    const folhas = folhasDe(AQUI);
    // A VARIÂNCIA PRIMEIRO: sem folha nenhuma, o caso passaria por vacuidade.
    expect(folhas.length).toBeGreaterThan(5);

    const porClasse = new Map();
    for (const folha of folhas) {
      for (const classe of classesDe(readFileSync(folha, 'utf8'))) {
        if (!porClasse.has(classe)) porClasse.set(classe, []);
        porClasse.get(classe).push(relative(AQUI, folha).replace(/\\/g, '/'));
      }
    }

    // Aferido como LISTA, e não uma a uma, para a mensagem de falha dizer QUAL
    // classe voltou a ser declarada em dois lugares e em quais arquivos.
    const colididas = [...porClasse.entries()]
      .filter(([, arquivos]) => arquivos.length > 1)
      .map(([classe, arquivos]) => `${classe}: ${arquivos.join(', ')}`);

    expect(colididas).toEqual([]);
  });
});
