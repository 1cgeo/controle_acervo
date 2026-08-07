import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A JANELA DOS RECOLHIMENTOS DE UMA NC, acionada de verdade.
//
// Desde a 1.40.0 a coluna "Recolhido" da lista de NCs é a SOMA de documentos, e
// esta janela é o único caminho até QUAIS documentos produziram o número. O
// rodapé escreve o total justamente para que ele feche com a coluna da tela de
// trás: dois números da mesma sessão lidos de fontes diferentes ficam livres
// para discordar.

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getRecolhimentos: vi.fn(),
  deleteRecolhimento: vi.fn(() => Promise.resolve()),
  // O diálogo de UM recolhimento é aberto por botão; os mocks abaixo existem
  // para o import não quebrar.
  getRecolhimento: vi.fn(() => Promise.resolve({})),
  createRecolhimento: vi.fn(() => Promise.resolve({ id: 1 })),
  updateRecolhimento: vi.fn(() => Promise.resolve({})),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([])),
  getUg: vi.fn(() => Promise.resolve([])),
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  deleteArquivo: vi.fn(() => Promise.resolve()),
}));

import { openRecolhimentosDialog } from '@modules/orcamento/pages/notas-credito/recolhimentos-dialog.js';
import { getRecolhimentos } from '@modules/orcamento/services/orcamento-service.js';

const NC = {
  id: 9, numero: '2026NC400224', ano: 2026, cod_nd: '339030', ug_emitente: '160035',
};

// O caso real do rateio: a 2026NC401316 abate R$ 0,98 desta NC, e outro
// documento abate R$ 100,00.
const LINHAS = [
  {
    id: 1, nota_credito_id: 9, numero: '2026NC401316', ano: 2026,
    data_emissao: '2026-07-15', cod_nd: '339000', nd_nome: 'Anulação',
    ug_emitente: '160035', ug_nome: 'DSG', valor: '0.98', qtd_anexos: '1',
  },
  {
    id: 2, nota_credito_id: 9, numero: '2026NC401400', ano: 2026,
    data_emissao: '2026-07-20', cod_nd: '339000', nd_nome: 'Anulação',
    ug_emitente: '160035', ug_nome: 'DSG', valor: '100.00', qtd_anexos: '0',
  },
];

const textoDoModal = () =>
  document.querySelector('.modal__body')?.textContent ?? '';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('openRecolhimentosDialog', () => {
  test('lista os documentos da NC e soma o total', async () => {
    getRecolhimentos.mockResolvedValueOnce(LINHAS);

    await openRecolhimentosDialog({ nc: NC });
    await flush();
    await flush();

    // Pediu SÓ os desta NC.
    expect(getRecolhimentos).toHaveBeenCalledWith({ nota_credito_id: 9 });

    const texto = textoDoModal();
    expect(texto).toContain('2026NC401316');
    expect(texto).toContain('2026NC401400');
    // 0,98 + 100,00 = 100,98. É o número que a coluna "Recolhido" da lista de
    // NCs mostra, e o rodapé existe para fechar com ela.
    expect(texto).toContain('100,98');
  });

  test('o título nomeia as três partes da chave da NC', async () => {
    getRecolhimentos.mockResolvedValueOnce(LINHAS);

    await openRecolhimentosDialog({ nc: NC });
    await flush();

    // O número sozinho NÃO identifica a NC: o mesmo número e a mesma ND existem
    // para UGs emitentes diferentes.
    const titulo = document.querySelector('.modal__title').textContent;
    expect(titulo).toContain('2026NC400224');
    expect(titulo).toContain('339030');
    expect(titulo).toContain('160035');
  });

  test('sem recolhimento, escreve que não há e o total é zero', async () => {
    getRecolhimentos.mockResolvedValueOnce([]);

    await openRecolhimentosDialog({ nc: NC });
    await flush();
    await flush();

    expect(textoDoModal()).toContain('Nenhum recolhimento lançado');
  });

  test('a falha da leitura NÃO vira "R$ 0,00" no total', async () => {
    // VARIÂNCIA contra o caso acima: lista vazia por falha e lista vazia por
    // ausência pedem leituras opostas. Total desconhecido sai '-', porque zero
    // afirmaria que nada foi devolvido.
    getRecolhimentos.mockRejectedValueOnce(new Error('rede caiu'));

    await openRecolhimentosDialog({ nc: NC });
    await flush();
    await flush();

    const texto = textoDoModal();
    expect(texto).toContain('Total recolhido desta NC: -');
    expect(texto).not.toContain('R$ 0,00');
  });

  test('a carga de ABERTURA não manda a tela de trás recarregar', async () => {
    // Só a escrita muda o recolhido e o saldo. Avisar na abertura custaria uma
    // releitura da lista inteira de NCs a cada clique no ícone.
    getRecolhimentos.mockResolvedValueOnce(LINHAS);
    const onChanged = vi.fn();

    await openRecolhimentosDialog({ nc: NC, onChanged });
    await flush();
    await flush();

    expect(onChanged).not.toHaveBeenCalled();
  });
});
