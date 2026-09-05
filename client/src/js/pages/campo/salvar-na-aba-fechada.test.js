import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O "SALVAR" DO CAMPO E A ABA QUE ESCONDE O ERRO.
//
// Na EDICAO o conteudo do modal sao tres abas, e o rodape com "Salvar" e do
// modal: ele fica visivel nas tres. A troca de aba DESANEXA o no do formulario
// (`clearChildren` em `tabs.js`), entao `nomeField.setError(...)` pintava numa
// arvore invisivel: nada acontecia na tela. Sem toast, sem foco, sem
// fechamento. O botao parecia morto e a pessoa clicava de novo.
//
// O caso comum e o da AREA: `campo.geometria` so vem pela ficha, e o campo
// importado do SAP 2.3.5 chega sem finalidade marcada. Quem vai a aba "Fotos e
// videos" juntar uma foto e volta para salvar levava a recusa em silencio.

vi.mock('@services/campo-service.js', () => ({
  criarCampo: vi.fn(() => Promise.resolve({ id: 1 })),
  atualizarCampo: vi.fn(() => Promise.resolve({ id: 1 })),
  listarImagensCampo: vi.fn(() => Promise.resolve([])),
  enviarImagemCampo: vi.fn(),
  excluirImagemCampo: vi.fn(),
  atualizarImagemCampo: vi.fn(),
  urlDaImagemCampo: vi.fn(() => Promise.resolve('blob:x')),
  listarTracksCampo: vi.fn(() => Promise.resolve([])),
  importarTrackCampo: vi.fn(),
  excluirTrackCampo: vi.fn(),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { openCampoDialog } from '@pages/campo/campo-dialog.js';
import { atualizarCampo } from '@services/campo-service.js';

const SITUACOES = [{ code: 1, nome: 'Planejado' }, { code: 2, nome: 'Executado' }];
const CATEGORIAS = [{ code: 1, nome: 'Reambulação' }, { code: 2, nome: 'Apoio geodésico' }];
const ANOS = [{ ano: 2026 }];

// A ficha de um campo importado: com area e SEM finalidade marcada.
const CAMPO = {
  id: 46,
  nome: 'Reambulação Santiago',
  descricao: null,
  ano: 2026,
  situacao_id: 1,
  data_inicio: '2026-03-02',
  data_fim: '2026-03-14',
  placas_vtr: null,
  militares_externos: null,
  categorias: [],
  militares: [],
  versoes: [],
  geometria: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
};

const aba = (rotulo) => [...document.querySelectorAll('.tabs button')]
  .find(b => b.textContent.trim() === rotulo);
const abaAtiva = () => document.querySelector('.tabs button[aria-selected="true"]')
  .textContent.trim();
const botao = (rotulo) => [...document.querySelectorAll('.modal__footer button')]
  .find(b => b.textContent.trim() === rotulo);

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('o Salvar do campo com o erro na aba fechada', () => {
  test('a recusa traz a aba dos dados de volta, e a mensagem fica NA TELA', async () => {
    openCampoDialog({
      campo: CAMPO, situacoes: SITUACOES, categorias: CATEGORIAS, anos: ANOS,
    });
    await flush();
    expect(abaAtiva()).toBe('Dados do campo');

    // A pessoa vai juntar uma foto...
    aba('Fotos e vídeos').click();
    await flush();
    expect(abaAtiva()).toBe('Fotos e vídeos');

    // ...e clica em "Salvar", que continua visível no rodapé do modal.
    botao('Salvar').click();
    await flush();

    expect(atualizarCampo).not.toHaveBeenCalled();
    // A aba voltou sozinha...
    expect(abaAtiva()).toBe('Dados do campo');
    // ...e a recusa esta NO DOM, e nao numa arvore desanexada. Antes disto o
    // texto existia so no no solto, e `document.body` nao o continha.
    expect(document.body.textContent).toContain('Marque ao menos uma finalidade');
  });

  // CONTROLE NEGATIVO: sem recusa, o Salvar salva e nao mexe na aba.
  test('sem recusa o campo salva, e a aba escolhida não muda antes disso', async () => {
    openCampoDialog({
      campo: { ...CAMPO, categorias: [{ id: 1, nome: 'Reambulação' }] },
      situacoes: SITUACOES, categorias: CATEGORIAS, anos: ANOS,
    });
    await flush();

    aba('Fotos e vídeos').click();
    await flush();

    botao('Salvar').click();
    await flush();

    expect(atualizarCampo).toHaveBeenCalledTimes(1);
  });
});
