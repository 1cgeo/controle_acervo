import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// A PODA DO DOMINIO DE MATERIAL, de 2026-08-08.
//
// Tres colunas e cinco rotas morreram no servidor no mesmo dia. Uma referencia
// sobrevivente no client NAO quebra o build, nao quebra o teste da tela que a
// contem e nao aparece em nenhuma revisao: ela vira um campo que chega
// `undefined`, uma coluna que imprime '-' para sempre ou um 404 no clique. Foi
// assim que a categoria de material ficou meses sendo enviada por um dialogo que
// ninguem lia.
//
// Este teste le o FONTE, porque e a unica forma de cobrar uma ausencia. Ele
// falha no arquivo e na linha, e a mensagem diz o que pos aquilo no lugar.

const RAIZ = join(process.cwd(), 'src', 'js');

/** Todo .js de src/js, menos os proprios testes (que citam os nomes mortos). */
function fontes(dir = RAIZ, acc = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      fontes(caminho, acc);
    } else if (nome.endsWith('.js') && !nome.endsWith('.test.js')) {
      acc.push(caminho);
    }
  }
  return acc;
}

// A busca ignora COMENTARIO: explicar por que uma coluna morreu exige escrever o
// nome dela, e proibir isso seria proibir a explicacao. O que se cobra e o
// CODIGO.
function linhasDeCodigo(texto) {
  return texto
    .split('\n')
    .map((linha, i) => ({ numero: i + 1, texto: linha }))
    // Comentario de linha inteira e o caso comum nesta base; o de bloco entra
    // por `*` no comeco da linha continuada.
    .filter(({ texto: t }) => {
      const limpa = t.trim();
      return limpa !== '' && !limpa.startsWith('//') && !limpa.startsWith('*') && !limpa.startsWith('/*');
    });
}

/** Onde a expressao aparece em CODIGO, como 'arquivo:linha'. */
function ocorrencias(regex) {
  const achados = [];
  for (const caminho of fontes()) {
    const conteudo = readFileSync(caminho, 'utf8');
    for (const { numero, texto } of linhasDeCodigo(conteudo)) {
      if (regex.test(texto)) {
        achados.push(`${relative(process.cwd(), caminho)}:${numero}  ${texto.trim()}`);
      }
    }
  }
  return achados;
}

describe('a poda do dominio de material', () => {
  // `categoria_id` so escolhia entre a 7.2 (Papel) e a 7.3 (Tintas) do RPCMTec,
  // e o chefe fundiu as duas tabelas numa so.
  test('nenhum fonte manda categoria_id', () => {
    expect(ocorrencias(/\bcategoria_id\b/)).toEqual([]);
  });

  // `meta_anual` nunca teve leitor: nenhuma tela e nenhum relatorio a liam.
  test('nenhum fonte le meta_anual', () => {
    expect(ocorrencias(/\bmeta_anual\b/)).toEqual([]);
  });

  // `tipo_material.tipo_midia_id` era a ponte impressao -> consumo, e a ponte
  // morreu. A midia do ITEM DE PEDIDO continua viva, e e outra coisa: por isso a
  // busca e pelo dialogo do material, e nao pelo nome da coluna.
  test('o cadastro de insumo nao pede mais a midia que o consome', () => {
    const dialogo = readFileSync(
      join(RAIZ, 'modules', 'mapoteca', 'pages', 'insumos', 'material-dialog.js'),
      'utf8'
    );
    for (const morto of ['tipo_midia_id', 'categoria_id', 'meta_anual']) {
      expect(dialogo.includes(morto), `material-dialog.js ainda cita ${morto}`).toBe(false);
    }
  });

  // As quatro rotas de escrita de estoque sairam do servidor. Chamar qualquer
  // uma delas e 404 no clique, e o saldo hoje se move so pelo livro.
  test('nenhum fonte chama a escrita de estoque', () => {
    expect(ocorrencias(/estoque_material\/transferir/)).toEqual([]);
    expect(ocorrencias(/\b(create|update|delete)EstoqueMaterial\b/)).toEqual([]);
    expect(ocorrencias(/\btransferirEstoque\b/)).toEqual([]);
  });

  // `/consumo_material` virou UM dos quatro tipos de `/movimento_material`.
  // `/consumo_mensal` continua vivo, e o nome dele contem o do morto: por isso a
  // borda `\b` no fim.
  test('nenhum fonte chama /consumo_material', () => {
    expect(ocorrencias(/consumo_material\b/)).toEqual([]);
    expect(ocorrencias(/\b(get|create|update|delete)ConsumoMaterial\b/)).toEqual([]);
  });

  // As tres telas viraram uma. Um link para a rota velha e um 404 silencioso: o
  // roteador manda para /404 e nada explica o que aconteceu.
  test('nenhum fonte aponta para as rotas de tela que sumiram', () => {
    expect(ocorrencias(/mapoteca\/(materiais|estoque|consumo)\b/)).toEqual([]);
  });
});
