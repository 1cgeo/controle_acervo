import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SITUACAO, SITUACAO_TRANSFERENCIA, TIPO_TRANSFERENCIA, AVISO_PATRIMONIO_PENDENTE,
  celulaPatrimonio, chipSituacao, chipSituacaoTransferencia, classeDaLinha,
  chipDias, textoVidaUtil,
} from './situacao.js';

// A ESCADA DA SITUAÇÃO, e por que ela não é uniforme.
//
// São cinco degraus de `equipamento.situacao` (er/equipamento.sql), e o chip de
// cada um NÃO usa a mesma família de cor: `Disponível`, `Afastado` e
// `Em manutenção` usam as variantes ESMAECIDAS que o sistema inteiro tem
// (css/chips.css, fundo com alfa baixo); `Indisponível` e `Baixado` são SÓLIDOS,
// com classe própria do módulo.
//
// A diferença é de leitura, e não de gosto: a lista tem 105 linhas, e o que se
// vai procurar nela é justamente o que parou. Um quarto tom pastel no meio de
// outros três não se distingue de relance, e a coluna de situação vira uma que
// se lê palavra por palavra.

const lerCss = (caminho) => readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), 'utf8');

/** O bloco de uma regra CSS pela classe, para conferir o que ela pinta. */
function blocoDaClasse(css, classe) {
  const inicio = css.indexOf(`.${classe} {`);
  if (inicio === -1) return null;
  return css.slice(inicio, css.indexOf('}', inicio));
}

const CSS_MODULO = lerCss('./equipamento.css');
const CSS_COMUM = lerCss('../../../css/chips.css');

describe('situacao: os códigos são os do domínio do servidor', () => {
  test('os cinco degraus, na ordem de precedência do banco', () => {
    // Espelham `equipamento.situacao` e `SITUACAO_EQUIPAMENTO` de
    // `server/src/utils/domain_constants.js`. Trocar um número aqui repinta o
    // chip errado sem erro de sintaxe.
    expect(SITUACAO).toEqual({
      DISPONIVEL: 1, AFASTADO: 2, EM_MANUTENCAO: 3, INDISPONIVEL: 4, BAIXADO: 5,
    });
    expect(SITUACAO_TRANSFERENCIA)
      .toEqual({ SOLICITADA: 1, AUTORIZADA: 2, CONCLUIDA: 3, CANCELADA: 4 });
    // Descarga é um TIPO de transferência, e não uma tabela à parte: são as 10
    // linhas "solicitado descarga" da planilha.
    expect(TIPO_TRANSFERENCIA).toEqual({ RECEBIMENTO: 1, CESSAO: 2, DESCARGA: 3 });
  });
});

describe('situacao: a escada do chip, sólida em cima e esmaecida embaixo', () => {
  test('as três brandas usam as variantes esmaecidas que o sistema já tem', () => {
    const classes = (id) => chipSituacao(id, 'x').className;

    expect(classes(SITUACAO.DISPONIVEL)).toBe('chip chip--success');
    expect(classes(SITUACAO.AFASTADO)).toBe('chip chip--info');
    expect(classes(SITUACAO.EM_MANUTENCAO)).toBe('chip chip--warning');
  });

  test('Indisponível e Baixado NÃO entram no catálogo comum: têm classe própria', () => {
    expect(chipSituacao(SITUACAO.INDISPONIVEL, 'Indisponível').className)
      .toBe('chip chip--equip-indisponivel');
    expect(chipSituacao(SITUACAO.BAIXADO, 'Baixado').className)
      .toBe('chip chip--equip-baixado');

    // E não são um apelido de variante existente: se um dia alguém as trocar por
    // `chip--error` e `chip--default`, elas voltam a ser pastel e este caso cai.
    for (const classe of ['chip--equip-indisponivel', 'chip--equip-baixado']) {
      expect(blocoDaClasse(CSS_COMUM, classe), `${classe} migrou para chips.css`).toBeNull();
      expect(blocoDaClasse(CSS_MODULO, classe), `${classe} não existe no CSS do módulo`)
        .not.toBeNull();
    }
  });

  test('as duas de cima são SÓLIDAS, e as três de baixo esmaecidas', () => {
    // SÓLIDO = fundo por token cheio, com o texto escrito por cima dele. Um
    // `rgba(..., 0.12)` aqui seria o pastel que estas duas existem para não ser.
    for (const classe of ['chip--equip-indisponivel', 'chip--equip-baixado']) {
      const bloco = blocoDaClasse(CSS_MODULO, classe);
      expect(bloco, `${classe} não pinta fundo por token`).toMatch(/background:\s*var\(--/);
      expect(bloco, `${classe} ficou com fundo translúcido`).not.toMatch(/rgba\(/);
      expect(bloco, `${classe} não declara a cor do texto sobre fundo forte`)
        .toMatch(/color:\s*var\(--/);
    }

    // O contraste do outro lado: as três brandas continuam com fundo de alfa
    // baixo no catálogo comum, e é isso que faz as duas de cima saltarem.
    for (const classe of ['chip--success', 'chip--info', 'chip--warning']) {
      expect(blocoDaClasse(CSS_COMUM, classe), `${classe} deixou de ser esmaecida`)
        .toMatch(/background:\s*rgba\([^)]*0\.\d+\)/);
    }
  });

  test('situação nova, sem cor, aparece no neutro em vez de sumir', () => {
    const novo = chipSituacao(9, 'Extraviado');
    expect(novo.className).toBe('chip chip--default');
    expect(novo.textContent).toBe('Extraviado');
  });

  test('sem o nome do servidor, o chip ainda diz de que código está falando', () => {
    expect(chipSituacao(4).textContent).toBe('Situação 4');
    expect(chipSituacao(null).textContent).toBe('Sem situação');
  });

  test('o código pode chegar como texto do JSON e mesmo assim casar', () => {
    expect(chipSituacao('4', 'Indisponível').className).toBe('chip chip--equip-indisponivel');
  });
});

describe('situacao: o chip da transferência', () => {
  test('cancelada é NEUTRA, e não vermelha: o vermelho já tem dono', () => {
    const cor = (id) => chipSituacaoTransferencia(id, 'x').className;

    expect(cor(SITUACAO_TRANSFERENCIA.SOLICITADA)).toBe('chip chip--info');
    expect(cor(SITUACAO_TRANSFERENCIA.AUTORIZADA)).toBe('chip chip--primary');
    expect(cor(SITUACAO_TRANSFERENCIA.CONCLUIDA)).toBe('chip chip--success');
    expect(cor(SITUACAO_TRANSFERENCIA.CANCELADA)).toBe('chip chip--default');
    // Cancelar uma solicitação é desfecho normal; o vermelho sólido é do bem
    // parado, e repeti-lo aqui roubaria a única cor que grita na tela.
    expect(cor(SITUACAO_TRANSFERENCIA.CANCELADA)).not.toContain('equip-indisponivel');
  });
});

describe('situacao: a faixa da linha repete a severidade fora da coluna', () => {
  test('só os três graves ganham faixa, e o disponível não ganha nada', () => {
    expect(classeDaLinha({ situacao_id: SITUACAO.INDISPONIVEL })).toBe('equip-linha--indisponivel');
    expect(classeDaLinha({ situacao_id: SITUACAO.BAIXADO })).toBe('equip-linha--baixado');
    expect(classeDaLinha({ situacao_id: SITUACAO.EM_MANUTENCAO })).toBe('equip-linha--manutencao');
    expect(classeDaLinha({ situacao_id: SITUACAO.DISPONIVEL })).toBe('');
    expect(classeDaLinha({ situacao_id: SITUACAO.AFASTADO })).toBe('');
    // Linha sem situação nenhuma não pode explodir a tabela inteira.
    expect(classeDaLinha({})).toBe('');
    expect(classeDaLinha(null)).toBe('');
  });
});

describe('situacao: os dias parados', () => {
  test('a escala nasce do dado real: um ano no vermelho, três meses no laranja', () => {
    // Há bem parado desde 22/07/2019. O corte de um ano é o vermelho porque
    // nenhuma manutenção legítima leva isso; 90 dias é quando a espera deixa de
    // ser rotina.
    expect(chipDias(2574).className).toContain('chip--equip-indisponivel');
    expect(chipDias(365).className).toContain('chip--equip-indisponivel');
    expect(chipDias(364).className).toContain('chip--warning');
    expect(chipDias(90).className).toContain('chip--warning');
    expect(chipDias(89).className).toContain('chip--info');
    expect(chipDias(0).className).toContain('chip--info');
  });

  test('o singular do primeiro dia, e o milhar separado no resto', () => {
    expect(chipDias(1).textContent).toBe('1 dia');
    expect(chipDias(2574).textContent).toBe('2.574 dias');
  });

  test('sem número não inventa chip: devolve o traço', () => {
    expect(chipDias(null)).toBe('-');
    expect(chipDias(undefined)).toBe('-');
    expect(chipDias('')).toBe('-');
    expect(chipDias('sei lá')).toBe('-');
  });
});

describe('situacao: a vida útil diz de onde o número veio', () => {
  test('valor próprio do bem sai como texto puro, em MESES', () => {
    // Meses, sempre: é como a coluna guarda (`vida_util_meses SMALLINT`) e é o
    // número que se digita no formulário. Quem converte para anos é o documento.
    expect(textoVidaUtil(120, false)).toBe('120 meses');
  });

  test('valor HERDADO do tipo vem marcado, porque editar o bem mudaria isso', () => {
    const no = textoVidaUtil(120, true);
    expect(no).toBeInstanceOf(HTMLElement);
    expect(no.textContent).toContain('120 meses');
    expect(no.textContent).toContain('do tipo');
    expect(no.getAttribute('title')).toContain('herdado');
  });

  test('sem vida útil nenhuma, traço', () => {
    expect(textoVidaUtil(null, false)).toBe('-');
    expect(textoVidaUtil(undefined, true)).toBe('-');
  });
});

describe('situacao: o patrimônio por conferir se distingue do verdadeiro', () => {
  // O número provisório tem a MESMA FORMA de um verdadeiro. Sem marca, ele se lê
  // como identidade do bem no SIAFI em toda tela, que é exatamente o que a coluna
  // `patrimonio_pendente` existe para impedir.

  test('o número conferido sai limpo, sem marca nenhuma', () => {
    const no = celulaPatrimonio({ nr_patrimonio: '104820700014462' });
    expect(no.className).toBe('equip-patrimonio');
    expect(no.textContent).toBe('104820700014462');
    expect(no.querySelector('svg')).toBeNull();
    expect(no.title).toBe('');
  });

  test('o número por conferir ganha classe, ícone e a frase inteira no title', () => {
    const no = celulaPatrimonio({ nr_patrimonio: 'PENDENTE-01', patrimonio_pendente: true });
    expect(no.className).toContain('equip-patrimonio--pendente');
    // ÍCONE MAIS COR, e nunca só cor: quem não distingue as duas cores continuaria
    // sem ver a diferença.
    expect(no.querySelector('svg')).not.toBeNull();
    expect(no.textContent).toContain('PENDENTE-01');
    expect(no.title).toBe(AVISO_PATRIMONIO_PENDENTE);
  });

  test('só o booleano verdadeiro marca, e não o valor "quase verdadeiro"', () => {
    // O servidor devolve booleano. Marcar por veracidade solta faria uma string
    // vazia ou um 0 vindos de outro caminho decidirem a marca.
    for (const valor of [false, null, undefined, 'true', 1]) {
      const no = celulaPatrimonio({ nr_patrimonio: '104820700014462', patrimonio_pendente: valor });
      expect(no.className).toBe('equip-patrimonio');
    }
  });

  test('a marca sobrevive à impressão em preto e branco', () => {
    // Terceira pista, além do ícone e da cor: a borda tracejada. O CSS é a prova,
    // porque a classe sozinha não diz o que ela pinta.
    const bloco = blocoDaClasse(CSS_MODULO, 'equip-patrimonio--pendente');
    expect(bloco).not.toBeNull();
    expect(bloco).toContain('dashed');
  });
});
