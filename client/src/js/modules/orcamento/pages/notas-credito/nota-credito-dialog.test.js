import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Regressao do bug: ao EDITAR uma NC, o select de classificacao vinha vazio
// porque as opcoes eram montadas com c.id (inexistente) em vez de c.code. Este
// teste fixa que, no modo edicao, o select de classificacao vem pre-selecionado
// com o classificacao_id da NC.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotaCredito: vi.fn(() => Promise.resolve({
    id: 5, ano: 2026, numero: '2026NC400134', cod_nd: '339015',
    valor_nc: 1000, classificacao_id: 2, ug_emitente: '160089',
  })),
  createNotaCredito: vi.fn(() => Promise.resolve({})),
  updateNotaCredito: vi.fn(() => Promise.resolve({})),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([{ code: '339015', nome: 'Diárias', gnd: 3 }])),
  getPlanoInterno: vi.fn(() => Promise.resolve([])),
  getUg: vi.fn(() => Promise.resolve([{ code: '160089', nome: 'DSG' }])),
  getClassificacaoNc: vi.fn(() => Promise.resolve([
    { code: 1, nome: 'PDR' },
    { code: 2, nome: 'Extra-PDR' },
  ])),
  getNotasCredito: vi.fn(() => Promise.resolve([])),
  getPdrItens: vi.fn(() => Promise.resolve([])),
  // Anexos (componente file-attachment, carregado no modo edicao da NC)
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  deleteArquivo: vi.fn(() => Promise.resolve()),
}));

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return { ...real, getMetasPit: vi.fn(() => Promise.resolve([])) };
});

import { openNotaCreditoDialog } from '@modules/orcamento/pages/notas-credito/nota-credito-dialog.js';
import {
  updateNotaCredito,
  getPdrItens,
} from '@modules/orcamento/services/orcamento-service.js';
import { getMetasPit } from '@services/plataforma-service.js';

// Acha o select cujo .form-field tem o label com o texto dado.
function selectByLabel(label) {
  const fields = [...document.querySelectorAll('.modal__body .form-field')];
  const field = fields.find(f => f.querySelector('.form-field__label')?.textContent.includes(label));
  return field ? field.querySelector('.form-field__select') : null;
}

// Todos os rotulos de campo do formulario aberto.
function rotulos() {
  return [...document.querySelectorAll('.modal__body .form-field__label')]
    .map(l => l.textContent.trim());
}

function botao(texto) {
  return [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === texto);
}

describe('openNotaCreditoDialog (edicao)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('o select de classificacao vem pre-selecionado com o valor da NC', async () => {
    // O ano vem por PARAMETRO de quem abre o dialog: ele nao le store global.
    await openNotaCreditoDialog({ ncId: 5, ano: 2026 });
    await flush();
    await flush();

    const select = selectByLabel('Classificação');
    expect(select).not.toBeNull();
    expect(select.value).toBe('2');
    const selecionada = select.options[select.selectedIndex];
    expect(selecionada.textContent).toBe('Extra-PDR');
  });

  // A META SAIU DO FORMULARIO NA 1.31.0. Ela e a meta do item do PDR, e nao uma
  // segunda escolha do operador: enquanto o campo existia, escolher uma meta
  // diferente da do item gravava a contradicao sem aviso nenhum.
  test('nao ha campo "Meta do PIT": ela vem do item do PDR', async () => {
    await openNotaCreditoDialog({ ncId: 5, ano: 2026 });
    await flush();
    await flush();

    // Rede contra o falso verde: o formulario tem de estar montado, senao a lista
    // vazia satisfaria a assercao sem provar nada.
    // 'Data de emissão' e opcional, entao o rotulo sai sem o '*' dos
    // obrigatorios, do mesmo jeito que 'Meta do PIT' saia.
    expect(rotulos()).toContain('Data de emissão');
    expect(rotulos()).not.toContain('Meta do PIT');
    expect(selectByLabel('Meta do PIT')).toBeNull();
    // O dialog tambem nao busca mais a lista de metas.
    expect(getMetasPit).not.toHaveBeenCalled();
    // E continua buscando os itens do PDR, que e de onde a meta passa a vir.
    expect(getPdrItens).toHaveBeenCalled();
  });

  test('salvar nao manda meta_pit_id no corpo', async () => {
    await openNotaCreditoDialog({ ncId: 5, ano: 2026 });
    await flush();
    await flush();

    botao('Salvar').click();
    await flush();

    expect(updateNotaCredito).toHaveBeenCalledTimes(1);
    const corpo = updateNotaCredito.mock.calls[0][1];
    // `in`, e nao `== null`: mandar a chave com null tambem seria mandar.
    expect('meta_pit_id' in corpo).toBe(false);
    // A NC lida e Extra-PDR (classificacao 2), entao nem item do PDR vai.
    expect('pdr_item_id' in corpo).toBe(false);
    expect(corpo.classificacao_id).toBe(2);
  });

  // O VALOR RECOLHIDO SAIU DO FORMULARIO NA 1.40.0, pelo mesmo motivo da meta:
  // ele era um numero digitado, e o documento que produziu a devolucao nao
  // existia em lugar nenhum. Medido em 2026-08-07 contra o SAG: das 17 NCs alvo
  // do ano, 5 estavam com 0,00 no SCA e nada acusava.
  test('nao ha campo "Valor recolhido": ele e a soma dos documentos de recolhimento', async () => {
    await openNotaCreditoDialog({ ncId: 5, ano: 2026 });
    await flush();
    await flush();

    // Rede contra o falso verde: o formulario tem de estar montado. O asterisco
    // e do campo obrigatorio, e faz parte do texto do rotulo.
    expect(rotulos()).toContain('Valor da NC*');
    expect(rotulos()).not.toContain('Valor recolhido');
  });

  test('salvar nao manda valor_recolhido no corpo', async () => {
    await openNotaCreditoDialog({ ncId: 5, ano: 2026 });
    await flush();
    await flush();

    botao('Salvar').click();
    await flush();

    const corpo = updateNotaCredito.mock.calls[0][1];
    // `in`, e nao `== null`: o validador estrito do modulo recusa a chave
    // desconhecida com 400, mesmo que o valor va nulo.
    expect('valor_recolhido' in corpo).toBe(false);
  });
});
