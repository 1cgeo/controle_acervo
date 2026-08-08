import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { SITUACAO_PEDIDO, SITUACOES_DA_FILA } from '@modules/mapoteca/situacao-pedido.js';
import { chipSituacaoPedido } from '@components/status-chip.js';

// A PODA DO PEDIDO, de 2026-08-08 (migracao 1.42.0).
//
// Uma situacao de dominio, uma coluna do pedido e uma coluna do item morreram no
// servidor no mesmo dia, e o rotulo de outra situacao mudou. Uma referencia
// sobrevivente no client NAO quebra o build, nao quebra o teste da tela que a
// contem e nao aparece em nenhuma revisao: ela vira um campo que chega
// `undefined`, uma coluna que imprime '-' para sempre, uma opcao de situacao que
// o Joi do servidor recusa na gravacao ou um rotulo que ninguem mais usa.
//
// Este teste le o FONTE, porque e a unica forma de cobrar uma ausencia. Ele
// falha no arquivo e na linha, e a mensagem diz o que pos aquilo no lugar.
//
// Ele tem tambem uma metade POSITIVA, e ela e o ponto: `tipo_midia_fornecida_id`
// FICA. As duas colunas tinham o mesmo sufixo, o mesmo formulario e destinos
// opostos, porque a medicao das mesmas 1759 linhas deu zero divergencia numa e
// 25 na outra. Sem o teste que exige a sobrevivente, a proxima limpeza as trata
// como par e apaga o unico registro de tyvek pedido e sulfite entregue.

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

describe('a poda do pedido: o que morreu', () => {
  // `pedido.omds` tinha 124 linhas preenchidas e UM valor distinto em todas
  // ('1º CGEO'): uma constante disfarcada de coluna. Quem preenche a coluna
  // "OMDS" do RTM e o proprio 1º CGEO.
  test('nenhum fonte manda nem le omds', () => {
    expect(ocorrencias(/\bomds\b/i)).toEqual([]);
  });

  // O rotulo da tela morreu junto com a coluna.
  test('nenhum fonte escreve "OM responsavel" nem "OMDS" na tela', () => {
    expect(ocorrencias(/OM responsável/)).toEqual([]);
  });

  // `produto_pedido.quantidade_fornecida` era IGUAL a `quantidade` em 1759 de
  // 1759 linhas preenchidas. Quem guarda o que de fato saiu da impressora e
  // `mapoteca.impressao_item`, com data e autor de cada sessao.
  test('nenhum fonte manda nem le quantidade_fornecida', () => {
    expect(ocorrencias(/\bquantidade_fornecida\b/)).toEqual([]);
  });

  test('nenhum fonte oferece o campo "Quantidade fornecida"', () => {
    expect(ocorrencias(/Quantidade fornecida/)).toEqual([]);
  });

  // A situacao 1 ('Pre cadastramento do pedido realizado') era a primeira da
  // lista e a mais oferecida pelo formulario, e ZERO dos 166 pedidos a usavam.
  // Uma opcao viva aqui seria uma escolha que o Joi do servidor recusa na
  // gravacao, sem a tela saber por que.
  test('nenhum fonte cita a situacao que saiu do dominio', () => {
    expect(ocorrencias(/PRE_CADASTRAMENTO/)).toEqual([]);
    expect(ocorrencias(/Pré cadastramento do pedido realizado/)).toEqual([]);
  });

  // O code 2 trocou de ROTULO, e nao de code: 'DIEx/Oficio do pedido recebido'
  // virou 'Pedido Recebido'. O nome da constante acompanhou.
  test('nenhum fonte usa o nome nem o rotulo velhos do code 2', () => {
    expect(ocorrencias(/DOCUMENTO_RECEBIDO/)).toEqual([]);
    expect(ocorrencias(/DIEx\/Ofício do pedido recebido/)).toEqual([]);
  });
});

describe('a poda do pedido: o que FICOU, e nao e o par do que saiu', () => {
  // A metade positiva do guard. `tipo_midia_fornecida_id` mediu 25 DIVERGENCIAS
  // REAIS nas mesmas 1759 linhas em que a quantidade fornecida mediu zero: a
  // folha pedida em tyvek e atendida em sulfite so esta registrada aqui.
  //
  // As duas tinham o mesmo sufixo e o mesmo formulario. O sufixo nao e
  // argumento, a medicao e: quem for podar a proxima coluna "fornecida" mede
  // antes de agrupar pelo nome.
  test('a MIDIA fornecida continua no dialogo do item', () => {
    const dialogo = readFileSync(
      join(RAIZ, 'modules', 'mapoteca', 'pages', 'pedidos', 'dialog-produto.js'),
      'utf8'
    );
    expect(dialogo).toContain('tipo_midia_fornecida_id');
    expect(dialogo).toContain('Mídia fornecida');
  });

  test('a MIDIA fornecida continua declarada no contrato do service', () => {
    const service = readFileSync(
      join(RAIZ, 'modules', 'mapoteca', 'services', 'mapoteca-service.js'),
      'utf8'
    );
    expect(service).toContain('tipo_midia_fornecida_id');
  });
});

describe('a poda do pedido: o dominio de situacao no client', () => {
  test('nao ha mais nenhuma situacao de code 1', () => {
    expect(Object.values(SITUACAO_PEDIDO)).not.toContain(1);
  });

  // O BURACO NA NUMERACAO E DELIBERADO: renumerar as outras seis reescreveria a
  // situacao dos 166 pedidos, e code de dominio ja gravado em `auditoria.evento`
  // e exatamente o que nao se renumera.
  test('as outras seis mantiveram o code que sempre tiveram', () => {
    expect(SITUACAO_PEDIDO).toEqual({
      PEDIDO_RECEBIDO: 2,
      EM_ANDAMENTO: 3,
      REMETIDO: 4,
      CONCLUIDO: 5,
      CANCELADO: 6,
      AGUARDANDO_PRODUCAO: 7,
    });
  });

  // A fila de impressao do servidor (`SITUACOES_FILA_IMPRESSAO`) perdeu a
  // situacao 1 junto: sao dois codes, e nao tres.
  test('a fila perdeu um elemento, e ficou com Recebido e Em andamento', () => {
    expect(SITUACOES_DA_FILA).toEqual([
      SITUACAO_PEDIDO.PEDIDO_RECEBIDO,
      SITUACAO_PEDIDO.EM_ANDAMENTO,
    ]);
  });

  // O cabecalho do arquivo COPIA o DDL linha a linha, e e de la que a proxima
  // pessoa tira o code certo. Copia desatualizada produz tela que mente com a
  // cara de estar certa, que e o motivo de o comentario existir.
  test('o cabecalho que copia o DDL acompanhou o rotulo novo', () => {
    const fonte = readFileSync(
      join(RAIZ, 'modules', 'mapoteca', 'situacao-pedido.js'),
      'utf8'
    );
    expect(fonte).toContain('2 Pedido Recebido');
    expect(fonte).not.toContain('2 DIEx/Oficio do pedido recebido');
    expect(fonte).not.toContain('1 Pre cadastramento do pedido realizado');
  });

  // O ROTULO vem do servidor (`situacao_pedido_nome`), e o chip so escolhe a
  // cor pelo code. O code 2 continua sendo o mesmo, e por isso continua com a
  // mesma cor: o pedido recebido nao mudou de aparencia na tela por causa de
  // uma troca de nome.
  test('o chip do code 2 pinta o rotulo novo, com a cor de sempre', () => {
    const alvo = chipSituacaoPedido(2, 'Pedido Recebido');

    expect(alvo.textContent).toBe('Pedido Recebido');
    expect(alvo.className).toContain('chip--info');
  });
});
