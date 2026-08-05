import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O ACERVO DA DEMANDA EXTRA-PIT.
//
// O que estes casos FIXAM: a folha que já cumpre meta do PIT aparece na busca
// COM o motivo e SEM botão (o CHECK `versao_plano_ou_excecao` a recusaria, e a
// mensagem do banco nomeia a constraint em vez de dizer o que fazer); ligar e
// desligar chamam o servidor de verdade; e ligar NÃO reconstrói o diálogo, então
// o termo buscado sobrevive.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getVersoesExtraPit: vi.fn(() => Promise.resolve([])),
    getVersoesCandidatasExtraPit: vi.fn(() => Promise.resolve([])),
    associarVersaoExtraPit: vi.fn(() => Promise.resolve({})),
    desassociarVersaoExtraPit: vi.fn(() => Promise.resolve({})),
  };
});

import { openVersoesDialog } from '@pages/extra-pit/versoes-dialog.js';
import {
  getVersoesExtraPit,
  getVersoesCandidatasExtraPit,
  associarVersaoExtraPit,
  desassociarVersaoExtraPit,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

const DEMANDA = {
  id: 7,
  ano: 2026,
  demandante: 'CMS',
  tipo_produto: 'Carta Topografica 1:25.000',
  quantidade: 2,
};

// A folha livre: sem meta e sem outra demanda. É a única que pode ser ligada.
const LIVRE = {
  id: 101, versao: '1', nome: 'Edição 1', produto: 'Faxinal', mi: '2966-1-NE',
  inom: 'SF-22-Y-A-I-1-NE', lote: '2026_1a_CT', data_edicao: '2026-03-10',
  meta_pit_id: null, demanda_extra_id: null,
};

// A folha que JÁ CUMPRE META do PIT. O CHECK do banco recusa as duas juntas.
const COM_META = {
  id: 102, versao: '1', nome: 'Edição 1', produto: 'Soturno', mi: '2966-1-SE',
  inom: 'SF-22-Y-A-I-1-SE', lote: '2026_1a_CT', data_edicao: '2026-03-10',
  meta_pit_id: 55, meta_ano: 2026, meta_numero: 1, meta_item: '1.1',
  demanda_extra_id: null,
};

// A folha que já materializa OUTRA demanda extra.
const DE_OUTRA = {
  id: 103, versao: '2', nome: 'Edição 2', produto: 'Alegrete', mi: '2966-2-NE',
  lote: '2026_1a_CT', data_edicao: '2026-04-01',
  meta_pit_id: null, demanda_extra_id: 99,
};

const itens = () => [...document.querySelectorAll('.lista-versoes__item')];

const acharItem = (texto) =>
  itens().find(no => no.textContent.includes(texto));

const botaoDe = (no, rotulo) =>
  [...no.querySelectorAll('button')].find(b => b.textContent.includes(rotulo));

describe('openVersoesDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.querySelectorAll('.modal-backdrop, .modal').forEach(no => no.remove());
    document.body.innerHTML = '';
  });

  test('lista as versoes ja ligadas e o par prometido/materializado', async () => {
    logar({ administrador: true });
    getVersoesExtraPit.mockResolvedValueOnce([LIVRE]);

    openVersoesDialog({ demanda: DEMANDA });
    await flush();

    expect(getVersoesExtraPit).toHaveBeenCalledWith(7);
    const ligada = acharItem('2966-1-NE');
    expect(ligada).not.toBeUndefined();
    // O par que o servidor NÃO transforma em veredito: a régua dele é "pelo
    // menos uma", e a quantidade da 3.3 muda de unidade por linha.
    expect(document.body.textContent).toContain('promete 2 Carta Topografica 1:25.000');
  });

  // O CASO QUE O CHEFE PEDIU POR ESCRITO: a tela diz o motivo em vez de deixar o
  // servidor recusar com erro cru.
  //
  // CONTROLE NEGATIVO no mesmo caso: a folha LIVRE, da mesma lista, tem o botão.
  // Sem ela, "não achei botão" também passaria numa tela que não desenhou nada.
  test('a folha que ja cumpre meta do PIT vem com motivo e sem botao de ligar', async () => {
    logar({ administrador: true });
    getVersoesCandidatasExtraPit.mockResolvedValueOnce([LIVRE, COM_META, DE_OUTRA]);

    openVersoesDialog({ demanda: DEMANDA });
    await flush();

    const bloqueada = acharItem('2966-1-SE');
    expect(bloqueada).not.toBeUndefined();
    expect(bloqueada.textContent).toContain('Já cumpre a meta 1.1 do PIT de 2026');
    expect(bloqueada.classList.contains('lista-versoes__item--bloqueado')).toBe(true);
    expect(botaoDe(bloqueada, 'Ligar')).toBeUndefined();

    // A de outra demanda também não se liga, e diz por quê.
    const deOutra = acharItem('2966-2-NE');
    expect(deOutra.textContent).toContain('Já materializa outra demanda Extra-PIT');
    expect(botaoDe(deOutra, 'Ligar')).toBeUndefined();

    // CONTROLE NEGATIVO: a livre, na mesma lista, oferece o botão.
    const livre = acharItem('2966-1-NE');
    expect(botaoDe(livre, 'Ligar')).not.toBeUndefined();
  });

  // O BOTÃO É CLICADO DE VERDADE: teste que não clica não prova que o botão liga.
  test('clicar em Ligar chama o servidor e repinta as duas listas', async () => {
    logar({ administrador: true });
    getVersoesExtraPit.mockResolvedValueOnce([]);
    getVersoesCandidatasExtraPit.mockResolvedValueOnce([LIVRE]);

    openVersoesDialog({ demanda: DEMANDA });
    await flush();

    // Depois de ligar, a folha sai das candidatas e entra nas ligadas.
    getVersoesExtraPit.mockResolvedValueOnce([LIVRE]);
    getVersoesCandidatasExtraPit.mockResolvedValueOnce([]);

    botaoDe(acharItem('2966-1-NE'), 'Ligar').click();
    await flush();

    expect(associarVersaoExtraPit).toHaveBeenCalledWith(7, 101);
    // Releu as duas listas: a contagem da tela de trás depende disso.
    expect(getVersoesExtraPit).toHaveBeenCalledTimes(2);
    expect(getVersoesCandidatasExtraPit).toHaveBeenCalledTimes(2);
    expect(botaoDe(acharItem('2966-1-NE'), 'Desligar')).not.toBeUndefined();
  });

  test('clicar em Desligar chama o servidor com a versao certa', async () => {
    logar({ administrador: true });
    getVersoesExtraPit.mockResolvedValueOnce([LIVRE]);

    openVersoesDialog({ demanda: DEMANDA });
    await flush();

    botaoDe(acharItem('2966-1-NE'), 'Desligar').click();
    await flush();

    expect(desassociarVersaoExtraPit).toHaveBeenCalledWith(7, 101);
  });

  // A REGRA DE OURO: ligar não reconstrói o diálogo. Só as listas se repintam,
  // então o termo digitado e o foco continuam onde estavam. Sem isso, ligar
  // cinco folhas obrigaria a digitar a busca cinco vezes.
  test('ligar preserva o termo buscado e o foco do campo de busca', async () => {
    logar({ administrador: true });
    getVersoesExtraPit.mockResolvedValueOnce([]);
    getVersoesCandidatasExtraPit.mockResolvedValueOnce([LIVRE]);

    openVersoesDialog({ demanda: DEMANDA });
    await flush();

    const busca = document.querySelector('.form-field__input');
    busca.value = '2966';
    busca.focus();

    getVersoesExtraPit.mockResolvedValueOnce([LIVRE]);
    getVersoesCandidatasExtraPit.mockResolvedValueOnce([]);

    botaoDe(acharItem('2966-1-NE'), 'Ligar').click();
    await flush();

    // O MESMO nó de input, e não um recriado: o valor e o foco sobrevivem.
    expect(document.querySelector('.form-field__input')).toBe(busca);
    expect(busca.value).toBe('2966');
    expect(document.activeElement).toBe(busca);
  });

  // Quem só lê alcança a lista, e não os botões de escrita: a rota de leitura é
  // `verifyLogin`, e as de escrita são `verifyAdmin`. Oferecer o botão a quem o
  // servidor vai recusar entrega um 403 no lugar de uma tela.
  test('quem nao e administrador ve as ligadas, sem ligar nem desligar', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getVersoesExtraPit.mockResolvedValueOnce([LIVRE]);

    openVersoesDialog({ demanda: DEMANDA });
    await flush();

    expect(acharItem('2966-1-NE')).not.toBeUndefined();
    expect(botaoDe(acharItem('2966-1-NE'), 'Desligar')).toBeUndefined();
    // Nem a busca de candidatas é oferecida, e o servidor nem é consultado.
    expect(getVersoesCandidatasExtraPit).not.toHaveBeenCalled();
    expect(document.querySelector('.form-field__input')).toBeNull();
  });

  // O vínculo mudou, então a tela de trás precisa reler: a coluna "No acervo" é
  // calculada na leitura e ficaria velha.
  test('fechar depois de ligar avisa a tela de tras, e sem mudanca nao avisa', async () => {
    logar({ administrador: true });
    const onChanged = vi.fn();

    getVersoesExtraPit.mockResolvedValueOnce([]);
    getVersoesCandidatasExtraPit.mockResolvedValueOnce([LIVRE]);

    openVersoesDialog({ demanda: DEMANDA, onChanged });
    await flush();

    // CONTROLE NEGATIVO: fechar SEM mudar nada não avisa. Avisar à toa faria a
    // tabela de trás piscar e perder a página.
    document.querySelector('.modal__close')?.click();
    await flush();
    expect(onChanged).not.toHaveBeenCalled();

    // Agora com uma mudança de verdade.
    getVersoesExtraPit.mockResolvedValueOnce([]);
    getVersoesCandidatasExtraPit.mockResolvedValueOnce([LIVRE]);
    openVersoesDialog({ demanda: DEMANDA, onChanged });
    await flush();

    getVersoesExtraPit.mockResolvedValueOnce([LIVRE]);
    getVersoesCandidatasExtraPit.mockResolvedValueOnce([]);
    botaoDe(acharItem('2966-1-NE'), 'Ligar').click();
    await flush();

    document.querySelector('.modal__close')?.click();
    await flush();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
