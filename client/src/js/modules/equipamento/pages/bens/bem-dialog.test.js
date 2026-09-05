import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A HERANÇA DE VIDA ÚTIL, e o defeito silencioso que ela evita.
//
// `GET /api/equipamento` devolve `vida_util_meses` JÁ RESOLVIDO por
// `COALESCE(e.vida_util_meses, t.vida_util_meses)`, e `vida_util_herdada` diz
// quando o número veio do TIPO, com a coluna do bem em NULO.
//
// Se o formulário nascesse com esse número preenchido, editar QUALQUER outra
// coisa no bem gravaria o valor herdado na coluna dele. A partir dali o bem
// deixaria de acompanhar o tipo, e NADA acusaria: o valor gravado é igual ao que
// a tela já mostrava. Mudar a vida útil do tipo simplesmente não alcançaria mais
// aquele bem.
//
// Por isso o campo fica VAZIO quando `vida_util_herdada` é verdadeiro, e a ajuda
// diz o que o branco significa.

const servico = vi.hoisted(() => ({
  createEquipamento: vi.fn(() => Promise.resolve({ id: 1 })),
  updateEquipamento: vi.fn(() => Promise.resolve({})),
}));
vi.mock('@modules/equipamento/services/equipamento-service.js', () => servico);

const toast = vi.hoisted(() => ({
  showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
}));
vi.mock('@utils/toast.js', () => toast);

import { abrirBemDialog } from './bem-dialog.js';

const DOMINIO = {
  classe_suprimento: [{ code: 6, nome: 'VI' }, { code: 9, nome: 'IX' }],
  secao_detentora: [{ code: 1, nome: 'Cia Lev' }, { code: 2, nome: 'Cia Prod' }],
};

const TIPOS = [
  { id: 1, nome: 'Estação Total', vida_util_meses: 120, ativo: true },
  { id: 8, nome: 'Bastão para topografia', vida_util_meses: 180, ativo: false },
];

/** O bem que NÃO declara vida útil própria: os 120 meses vieram do tipo. */
const BEM_HERDADO = {
  id: 1,
  nr_patrimonio: '104820700014462',
  classe_id: 6,
  tipo_id: 1,
  modelo: 'TOPCON CTS-3007',
  nr_serie: null,
  data_entrada_carga: '2014-07-29',
  vida_util_meses: 120,
  vida_util_herdada: true,
  secao_detentora_id: 1,
  ativo: true,
  observacao: null,
};

/** O mesmo bem, mas com vida útil PRÓPRIA gravada na coluna dele. */
const BEM_PROPRIO = { ...BEM_HERDADO, vida_util_meses: 96, vida_util_herdada: false };

function campo(rotulo) {
  const campos = [...document.querySelectorAll('.modal__body .form-field')];
  const achado = campos.find(f => f.querySelector('.form-field__label')?.textContent.includes(rotulo));
  return achado ? achado.querySelector('select, input, textarea') : null;
}

function botao(rotulo) {
  return [...document.querySelectorAll('.modal__footer .btn')]
    .find(b => b.textContent.trim() === rotulo);
}

/** Abre a lista do combo de tipo e devolve o texto dela. */
async function opcoesDoCombo() {
  const combo = document.querySelector('.combo');
  combo.querySelector('input').focus();
  combo.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
  return combo.textContent;
}

const corpoEnviado = () => servico.updateEquipamento.mock.calls.at(-1)[1];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('bem-dialog: a herança da vida útil', () => {
  test('com vida útil HERDADA, o campo abre VAZIO', async () => {
    abrirBemDialog({ bem: BEM_HERDADO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    const vidaUtil = campo('Vida útil própria');
    expect(vidaUtil).not.toBeNull();
    // Vazio, e não "120": repetir o herdado no campo é o que materializaria a
    // herança na primeira gravação de qualquer outro campo.
    expect(vidaUtil.value).toBe('');
  });

  test('editar o MODELO não grava o valor herdado na coluna do bem', async () => {
    abrirBemDialog({ bem: BEM_HERDADO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    campo('Modelo').value = 'TOPCON CTS-3007 (revisado)';
    botao('Salvar').click();
    await flush();
    await flush();

    expect(servico.updateEquipamento).toHaveBeenCalledTimes(1);
    const corpo = corpoEnviado();
    expect(corpo.modelo).toBe('TOPCON CTS-3007 (revisado)');
    // ESTA é a linha que importa: nulo, e não 120. Com 120 aqui, o bem passaria
    // a declarar a própria vida útil e pararia de acompanhar o tipo, sem que
    // ninguém tivesse pedido isso e sem nada mudar na tela.
    expect(corpo.vida_util_meses).toBeNull();
  });

  test('digitar um valor É a forma de romper a herança, e ela rompe', async () => {
    abrirBemDialog({ bem: BEM_HERDADO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    campo('Vida útil própria').value = '84';
    botao('Salvar').click();
    await flush();
    await flush();

    expect(corpoEnviado().vida_util_meses).toBe(84);
  });

  test('com vida útil PRÓPRIA, o campo abre preenchido e o valor sobrevive', async () => {
    // O outro lado: o campo em branco não pode significar "esqueci de mostrar".
    // Quem já declarou 96 meses tem de ver 96 e regravar 96.
    abrirBemDialog({ bem: BEM_PROPRIO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    expect(campo('Vida útil própria').value).toBe('96');

    botao('Salvar').click();
    await flush();
    await flush();

    expect(corpoEnviado().vida_util_meses).toBe(96);
  });

  test('apagar o campo de um bem com valor próprio DEVOLVE a herança', async () => {
    abrirBemDialog({ bem: BEM_PROPRIO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    campo('Vida útil própria').value = '';
    botao('Salvar').click();
    await flush();
    await flush();

    // Em branco NÃO é zero: é "volta a herdar do tipo".
    expect(corpoEnviado().vida_util_meses).toBeNull();
  });

  test('a ajuda do campo diz o que o branco significa', async () => {
    abrirBemDialog({ bem: BEM_HERDADO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    const bloco = [...document.querySelectorAll('.modal__body .form-field')]
      .find(f => f.querySelector('.form-field__label')?.textContent.includes('Vida útil própria'));
    expect(bloco.textContent).toContain('vale a vida útil do tipo');
  });

  test('bem novo nasce sem vida útil própria, herdando o que o tipo disser', async () => {
    abrirBemDialog({ dominio: DOMINIO, tipos: TIPOS });
    await flush();

    expect(campo('Vida útil própria').value).toBe('');
  });
});

describe('bem-dialog: dar baixa é aqui, e não é excluir', () => {
  test('o bem em carga abre com "Ativo" marcado', async () => {
    abrirBemDialog({ bem: BEM_HERDADO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    expect(campo('Ativo (em carga)').checked).toBe(true);
  });

  test('desmarcar "Ativo" grava ativo = false, que é o que deriva "Baixado"', async () => {
    // A situação `Baixado` sai de `ativo = false` pela função
    // `equipamento.situacao_em(dia)`: não existe campo de situação para digitar.
    abrirBemDialog({ bem: BEM_HERDADO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    const ativo = campo('Ativo (em carga)');
    ativo.checked = false;
    botao('Salvar').click();
    await flush();
    await flush();

    expect(corpoEnviado().ativo).toBe(false);
    // E nada de campo de situação no corpo: ela é DERIVADA no banco.
    expect(corpoEnviado()).not.toHaveProperty('situacao_id');
  });

  test('o bem novo nasce ativo', async () => {
    abrirBemDialog({ dominio: DOMINIO, tipos: TIPOS });
    await flush();

    expect(campo('Ativo (em carga)').checked).toBe(true);
  });
});

describe('bem-dialog: o que a tela cobra antes de gastar uma requisição', () => {
  test('sem patrimônio, o erro fica NO CAMPO e nada é enviado', async () => {
    abrirBemDialog({ dominio: DOMINIO, tipos: TIPOS });
    await flush();

    botao('Salvar').click();
    await flush();

    expect(servico.createEquipamento).not.toHaveBeenCalled();
    const bloco = [...document.querySelectorAll('.modal__body .form-field')]
      .find(f => f.querySelector('.form-field__label')?.textContent.includes('Número de patrimônio'));
    expect(bloco.textContent).toContain('Informe o número de patrimônio');
  });

  test('os combos saem do domínio pelo `code`, e o tipo pelo `id` do cadastro', async () => {
    abrirBemDialog({ bem: BEM_HERDADO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    expect([...campo('Classe de suprimento').options].map(o => o.value))
      .toEqual(['', '6', '9']);
    expect([...campo('Seção detentora').options].map(o => o.value))
      .toEqual(['', '1', '2']);
  });

  test('tipo INATIVO continua sendo oferecido NA EDIÇÃO, marcado como tal', async () => {
    // Os bens existentes daquele tipo continuam como estão, e a ficha deles
    // precisa poder ser salva sem trocar o tipo.
    abrirBemDialog({ bem: BEM_HERDADO, dominio: DOMINIO, tipos: TIPOS });
    await flush();

    expect(await opcoesDoCombo()).toContain('Bastão para topografia (inativo)');
  });

  test('tipo INATIVO NÃO é oferecido no cadastro de bem NOVO', async () => {
    // É a promessa que a Configuração faz a quem desmarca "Ativo" num tipo:
    // "Tipo inativo não é oferecido no cadastro de bem novo, e os bens
    // existentes ficam como estão" (`configuracao/tipo-dialog.js`). Oferecê-lo
    // aqui fazia daquela caixa uma marca sem efeito nenhum: o tipo tirado de
    // circulação continuava a um clique de entrar em bem novo.
    abrirBemDialog({ dominio: DOMINIO, tipos: TIPOS });
    await flush();

    const opcoes = await opcoesDoCombo();
    expect(opcoes).toContain('Estação Total');
    expect(opcoes).not.toContain('Bastão para topografia (inativo)');
    expect(opcoes).not.toContain('Bastão para topografia');
  });
});
