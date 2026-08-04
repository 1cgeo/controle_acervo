import { describe, test, expect, vi, beforeEach } from 'vitest';

// Dois defeitos fixados aqui:
// 1) Tipo do id. createSelectField devolve o valor da opcao com o tipo original
//    (form-fields.js:198-201) e /api/metas devolve id como TEXTO. O servidor cobra
//    Joi.number().integer().strict() (pdr_schema.js:19), entao escolher a meta
//    dava 400 sempre.
// 2) A descricao do item. O dialog nunca mostrou nem enviou o campo, e o UPDATE
//    do servidor grava null no que nao vem (pdr_ctrl.js:13-27). Salvar apagava o
//    unico texto legivel do item, preenchido em 36 de 36 itens reais.

const { createPdrItem, updatePdrItem } = vi.hoisted(() => ({
  createPdrItem: vi.fn(() => Promise.resolve({})),
  updatePdrItem: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  createPdrItem,
  updatePdrItem,
  getNaturezaDespesa: vi.fn(() => Promise.resolve([
    { code: '339039', nome: 'Serviços de terceiros - pessoa jurídica', gnd: 3 },
  ])),
}));

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    // id como TEXTO, igual ao que /api/metas devolve.
    getMetasPit: vi.fn(() => Promise.resolve([
      { id: '3', numero: 3, descricao: 'Produção de Geoinformação para o EBGeo' },
    ])),
  };
});

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: vi.fn(() => ({ element: document.createElement('div'), recarregar: vi.fn() })),
}));

import { openPdrItemDialog } from '@modules/orcamento/pages/pdr/item-dialog.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function botao(rotulo) {
  return [...document.querySelectorAll('.modal__footer .btn')]
    .find(b => b.textContent.trim() === rotulo);
}

function campoPorRotulo(rotulo) {
  const campos = [...document.querySelectorAll('.modal__body .form-field')];
  const campo = campos.find(f => f.querySelector('.form-field__label')?.textContent.includes(rotulo));
  return campo ? campo.querySelector('select, input, textarea') : null;
}

const ITEM = {
  id: 10,
  ano: 2026,
  cod_nd: '339039',
  meta_pit_id: '3',
  item_label: '10',
  descricao: 'Produção de Geoinformação para o EBGeo (abastecimento Vtr)',
  gnd: 3,
  valor_solicitado: 11400,
  valor_autorizado: 11400,
  observacao: null,
};

describe('openPdrItemDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.setItem('@sca-orcamento-ano', '2026');
    vi.clearAllMocks();
  });

  test('meta_pit_id vai como numero, e nao como texto', async () => {
    await openPdrItemDialog({ item: ITEM });
    await flush();

    const meta = campoPorRotulo('Meta do PIT');
    meta.value = '3';
    meta.dispatchEvent(new Event('change', { bubbles: true }));

    botao('Salvar').click();
    await flush();

    expect(updatePdrItem).toHaveBeenCalledTimes(1);
    const corpo = updatePdrItem.mock.calls[0][1];
    expect(typeof corpo.meta_pit_id).toBe('number');
    expect(corpo.meta_pit_id).toBe(3);
  });

  test('meta em branco continua indo como null', async () => {
    await openPdrItemDialog({});
    await flush();

    campoPorRotulo('Natureza de despesa').value = '339039';
    campoPorRotulo('Natureza de despesa').dispatchEvent(new Event('change', { bubbles: true }));

    botao('Salvar').click();
    await flush();

    expect(createPdrItem).toHaveBeenCalledTimes(1);
    expect(createPdrItem.mock.calls[0][0].meta_pit_id).toBeNull();
  });

  test('a descricao do item aparece no formulario e sobrevive ao salvar', async () => {
    await openPdrItemDialog({ item: ITEM });
    await flush();

    const descricao = campoPorRotulo('Descrição');
    expect(descricao).not.toBeNull();
    expect(descricao.value).toBe(ITEM.descricao);

    botao('Salvar').click();
    await flush();

    const corpo = updatePdrItem.mock.calls[0][1];
    expect(corpo.descricao).toBe(ITEM.descricao);
  });
});
