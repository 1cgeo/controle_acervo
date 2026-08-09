import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A TELA DA INSTITUIÇÃO e o que ela move na SESSÃO (2026-08-09).
//
// `nome` e `sigla` não ficam só nesta rota: eles viajam no login e moram em
// `@store/auth-store.js`, porque é de lá que saem o remetente da etiqueta de
// envio e o `orgao_produtor` sugerido no cadastro de versão -- telas que não
// podem gastar uma chamada por desenho.
//
// Daí o que este arquivo guarda: quem corrige o nome aqui tem de ver o efeito
// AGORA. Sem reconferir a sessão, o administrador que acabou de trocar o nome
// imprimiria o antigo na etiqueta até sair e entrar de novo, e nada na tela
// diria que o papel ficou para trás.

vi.mock('@services/plataforma-service.js', () => ({
  getInstituicao: vi.fn(),
  atualizarInstituicao: vi.fn(),
  getUnidadesGestoras: vi.fn(),
}));

vi.mock('@services/api-client.js', () => ({
  sincronizarSessao: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: vi.fn(() => ({
    element: document.createElement('div'),
    recarregar: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { renderInstituicao } from '@pages/instituicao/index.js';
import * as svc from '@services/plataforma-service.js';
import { sincronizarSessao } from '@services/api-client.js';
import { showError } from '@utils/toast.js';

const INSTITUICAO = {
  id: 1,
  nome: '1º Centro de Geoinformação',
  sigla: '1º CGEO',
  ug_code: '160382',
  ug_nome: '1 CGEO',
};

const campoPorRotulo = (rotulo) => [...document.querySelectorAll('.form-field')]
  .find(c => (c.querySelector('.form-field__label')?.textContent || '').startsWith(rotulo));

const inputDe = (rotulo) => campoPorRotulo(rotulo).querySelector('input, select');

const preencher = (rotulo, valor) => {
  const campo = inputDe(rotulo);
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
};

/** Monta a tela ja carregada e devolve o container. */
async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderInstituicao(container);
  await flush();
  return container;
}

beforeEach(() => {
  svc.getInstituicao.mockResolvedValue(INSTITUICAO);
  svc.getUnidadesGestoras.mockResolvedValue([{ code: '160382', nome: '1 CGEO' }]);
  svc.atualizarInstituicao.mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('#/instituicao: o formulário', () => {
  test('abre com o que o servidor tem, e não com nome escrito no código', async () => {
    await montar();

    expect(inputDe('Nome por extenso').value).toBe('1º Centro de Geoinformação');
    expect(inputDe('Sigla').value).toBe('1º CGEO');
  });

  test('salvar manda os três campos', async () => {
    await montar();

    preencher('Nome por extenso', '4º Centro de Geoinformação');
    preencher('Sigla', '4º CGEO');
    document.querySelector('.instituicao__form').requestSubmit();
    await flush();

    expect(svc.atualizarInstituicao).toHaveBeenCalledWith({
      nome: '4º Centro de Geoinformação',
      sigla: '4º CGEO',
      ug_code: '160382',
    });
  });
});

describe('#/instituicao: o que a gravação move na sessão', () => {
  test('gravar reconfere a sessão, para o nome novo valer nas outras telas', async () => {
    await montar();

    preencher('Nome por extenso', '4º Centro de Geoinformação');
    preencher('Sigla', '4º CGEO');
    document.querySelector('.instituicao__form').requestSubmit();
    await flush();

    expect(sincronizarSessao).toHaveBeenCalledTimes(1);
  });

  // Gravação recusada não mexe na sessão: reconferir aqui pediria ao servidor a
  // mesma foto que já está guardada, e o erro é o que a pessoa tem de ler.
  test('gravação recusada NÃO reconfere a sessão', async () => {
    svc.atualizarInstituicao.mockRejectedValue(new Error('A Unidade Gestora informada não existe'));

    await montar();
    document.querySelector('.instituicao__form').requestSubmit();
    await flush();

    expect(sincronizarSessao).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('A Unidade Gestora informada não existe');
  });

  // Reconferir é melhoria, e nunca pré-requisito: a gravação já aconteceu, e uma
  // falha na reconferência não pode pintar de vermelho o que deu certo.
  test('falha ao reconferir a sessão não derruba a tela', async () => {
    sincronizarSessao.mockRejectedValue(new Error('sem rede'));

    await montar();
    document.querySelector('.instituicao__form').requestSubmit();
    await flush();

    expect(showError).not.toHaveBeenCalled();
  });
});
