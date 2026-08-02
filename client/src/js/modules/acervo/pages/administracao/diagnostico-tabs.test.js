import { describe, test, expect, vi, beforeEach } from 'vitest';

// As tres abas sao a MESMA lista paginada com colunas diferentes -- o laco, o
// rodape e o descarte de resposta atrasada vivem em `lista-paginada.js` e tem
// teste proprio la. O que se prova aqui e o que cada uma escolhe MOSTRAR, que e
// a unica coisa que as separa.
vi.mock('@modules/acervo/services/admin-service.js', () => ({
  getArquivosIncorretos: vi.fn(),
  getArquivosDeletados: vi.fn(),
  getDownloadsDeletados: vi.fn(),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { renderArquivosProblemaTab } from '@modules/acervo/pages/administracao/arquivos-problema-tab.js';
import { renderArquivosExcluidosTab } from '@modules/acervo/pages/administracao/arquivos-excluidos-tab.js';
import { renderDownloadsExcluidosTab } from '@modules/acervo/pages/administracao/downloads-excluidos-tab.js';
import * as svc from '@modules/acervo/services/admin-service.js';

const umaPagina = (dados) => ({
  dados,
  pagination: {
    totalItems: dados.length, totalPages: 1, currentPage: 1, pageSize: 20,
  },
});

let container;

const montar = async (render) => {
  container = document.createElement('div');
  return render(container);
};

const cabecalhos = () =>
  [...container.querySelectorAll('thead th')].map(th => th.textContent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('aba Arquivos com problema', () => {
  // A lista une duas origens (arquivo vivo com erro de carregamento e arquivo ja
  // excluido cuja exclusao falhou), e a coluna "Situação" e o que as separa. Sem
  // ela, dois trabalhos diferentes virariam uma lista so, indistinguivel.
  test('mostra a situacao que separa as duas origens', async () => {
    svc.getArquivosIncorretos.mockResolvedValue(umaPagina([
      {
        id: 1, nome: 'Carta 2757', nome_arquivo: 'CT_s12_2757', extensao: 'tif',
        versao_nome: '1ª Edição', volume_nome: 'Acervo principal',
        tipo: 'Arquivo com erro', data_modificacao: '2026-08-01T10:00:00-03:00',
      },
      {
        id: 2, nome: 'Carta 2758', nome_arquivo: 'CT_s12_2758', extensao: 'tif',
        versao_nome: 'Versão removida', volume_nome: 'Acervo principal',
        tipo: 'Arquivo deletado com erro', data_modificacao: '2026-07-30T10:00:00-03:00',
      },
    ]));

    const aba = await montar(renderArquivosProblemaTab);

    expect(cabecalhos()).toContain('Situação');
    expect(container.textContent).toContain('Arquivo com erro');
    expect(container.textContent).toContain('Arquivo deletado com erro');
    expect(container.textContent).toContain('CT_s12_2757.tif');

    aba.cleanup();
  });

  // Lista vazia aqui NAO quer dizer "esta tudo certo": a marca e gravada pela
  // verificacao contra o volume, e sem ela a lista e a foto da ultima vez que
  // alguem rodou. A tela diz isso.
  test('avisa que a lista depende da ultima verificacao', async () => {
    svc.getArquivosIncorretos.mockResolvedValue(umaPagina([]));

    const aba = await montar(renderArquivosProblemaTab);

    expect(container.textContent).toContain('última verificação');

    aba.cleanup();
  });
});

describe('aba Arquivos excluídos', () => {
  // O motivo e o campo que justifica a lapide existir: excluir exige motivo
  // justamente para o registro nao sumir sem historia.
  test('mostra o motivo, quem excluiu e quando', async () => {
    svc.getArquivosDeletados.mockResolvedValue(umaPagina([{
      id: 7, produto: 'Porto Alegre', mi: '2987-2', versao: '1ª Edição',
      nome_arquivo: 'CT_s12_2987-2_1dsg', extensao: 'tif', tamanho_mb: 42.5,
      volume_armazenamento_nome: 'Acervo principal',
      motivo_exclusao: 'folha cadastrada em duplicidade',
      usuario_delete_nome: 'Fulano', data_delete: '2026-07-15T09:00:00-03:00',
    }]));

    const aba = await montar(renderArquivosExcluidosTab);

    expect(container.textContent).toContain('folha cadastrada em duplicidade');
    expect(container.textContent).toContain('Fulano');
    expect(container.textContent).toContain('Porto Alegre');

    aba.cleanup();
  });

  // A lapide guarda o REGISTRO, e nao o byte: o arquivo no volume pode ter ido
  // junto, e um botao de restaurar prometeria o que o sistema nao cumpre.
  test('nao oferece restaurar', async () => {
    svc.getArquivosDeletados.mockResolvedValue(umaPagina([{
      id: 7, produto: 'Porto Alegre', nome_arquivo: 'x', extensao: 'tif',
      motivo_exclusao: 'teste', data_delete: '2026-07-15T09:00:00-03:00',
    }]));

    const aba = await montar(renderArquivosExcluidosTab);

    expect(container.querySelector('.data-table__action-btn')).toBeNull();
    expect(container.textContent).toContain('não há como restaurar daqui');

    aba.cleanup();
  });
});

describe('aba Downloads excluídos', () => {
  test('mostra quem baixou e o motivo da exclusao do arquivo', async () => {
    svc.getDownloadsDeletados.mockResolvedValue(umaPagina([{
      id: 3, usuario_nome: 'Beltrano', data_download: '2026-07-10T14:00:00-03:00',
      arquivo_nome: 'Carta 2987-2', nome_arquivo: 'CT_s12_2987-2_1dsg',
      motivo_exclusao: 'folha cadastrada em duplicidade',
      data_delete: '2026-07-15T09:00:00-03:00',
    }]));

    const aba = await montar(renderDownloadsExcluidosTab);

    expect(container.textContent).toContain('Beltrano');
    expect(container.textContent).toContain('folha cadastrada em duplicidade');

    aba.cleanup();
  });
});
