import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mostrarErro, estadoErro } from '@components/estado-erro.js';

// ESTADO DE ERRO de um painel.
//
// O que estes casos prendem e o caminho de VOLTA. O aviso troca o conteudo do
// container pelo proprio no, e guarda o que tirou para o "Tentar de novo"
// devolver. Duas falhas SEGUIDAS quebravam esse guardado: a segunda captura
// pegava o proprio aviso como "o que estava aqui", e o botao passava a trocar
// uma caixa de erro por outra. Quem estava com o servidor fora do ar (que e
// exatamente quando a falha se repete) nunca mais via a tabela.

const tabela = () => {
  const t = document.createElement('table');
  t.className = 'a-tabela';
  return t;
};

const avisoNaTela = () => document.querySelector('.dashboard-erro');
const botaoTentar = () => [...document.querySelectorAll('.dashboard-erro .btn')]
  .find(b => b.textContent.includes('Tentar de novo'));

describe('mostrarErro', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  test('troca o conteudo pelo aviso e devolve o que estava la', () => {
    const conteudo = tabela();
    container.appendChild(conteudo);

    const recarregar = vi.fn();
    mostrarErro(container, new Error('sem rede'), recarregar);

    expect(container.querySelector('.a-tabela')).toBeNull();
    expect(avisoNaTela()).not.toBeNull();
    expect(avisoNaTela().textContent).toContain('sem rede');

    botaoTentar().click();

    // O MESMO no volta, e nao uma copia: quem perde a identidade perde a
    // rolagem, a pagina e a selecao da tabela.
    expect(container.firstChild).toBe(conteudo);
    expect(avisoNaTela()).toBeNull();
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  // O CASO QUE MOTIVOU O CONSERTO.
  test('duas falhas seguidas nao guardam o proprio aviso', () => {
    const conteudo = tabela();
    container.appendChild(conteudo);

    const recarregar = vi.fn();
    mostrarErro(container, new Error('primeira falha'), recarregar);
    // A recarga automatica (o refresh de 60 s) falha de novo, com o aviso ainda
    // na tela. Antes do conserto era aqui que o guardado virava a caixa de erro.
    mostrarErro(container, new Error('segunda falha'), recarregar);

    expect(avisoNaTela().textContent).toContain('segunda falha');

    botaoTentar().click();

    // A tabela volta. Com o defeito no lugar, o container recebia a caixa de
    // erro velha e `.a-tabela` continuava fora do DOM.
    expect(container.firstChild).toBe(conteudo);
    expect(container.querySelectorAll('.dashboard-erro').length).toBe(0);
  });

  test('tres falhas seguidas tambem devolvem a tabela', () => {
    const conteudo = tabela();
    container.appendChild(conteudo);

    const recarregar = vi.fn();
    for (const n of ['a', 'b', 'c']) mostrarErro(container, new Error(n), recarregar);

    botaoTentar().click();

    expect(container.firstChild).toBe(conteudo);
    expect(avisoNaTela()).toBeNull();
  });

  // CONTROLE NEGATIVO: sem isto, guardar o conteudo do container PARA SEMPRE
  // passaria nos dois casos acima e quebraria o ciclo normal. Depois de
  // recuperar, a proxima falha tem de guardar o que estiver na tela naquela
  // hora, e nao o retrato antigo.
  test('depois de recuperar, a falha seguinte guarda o conteudo NOVO', () => {
    const primeiro = tabela();
    container.appendChild(primeiro);

    const recarregar = vi.fn(() => {
      // A recarga substitui a tabela, como a carga de verdade faz.
      const novo = tabela();
      novo.classList.add('recarregada');
      container.replaceChildren(novo);
    });

    mostrarErro(container, new Error('falhou'), recarregar);
    botaoTentar().click();
    expect(container.querySelector('.recarregada')).not.toBeNull();

    mostrarErro(container, new Error('falhou de novo'), vi.fn());
    botaoTentar().click();

    // Volta a tabela RECARREGADA, e nao a primeira.
    expect(container.querySelector('.recarregada')).not.toBeNull();
    expect(container.firstChild).not.toBe(primeiro);
  });

  // CONTROLE NEGATIVO da marca: um no que NAO e estado de erro nao pode ser
  // confundido com um, senao o container jamais atualizaria o guardado.
  test('conteudo que so parece erro nao confunde a captura', () => {
    const impostor = document.createElement('div');
    impostor.className = 'dashboard-erro';
    impostor.textContent = 'texto qualquer';
    container.appendChild(impostor);

    mostrarErro(container, new Error('falhou'), vi.fn());
    botaoTentar().click();

    expect(container.firstChild).toBe(impostor);
  });

  test('estadoErro sozinho monta o aviso com role de alerta e a mensagem do servidor', () => {
    const no = estadoErro(new Error('O exercício de 2026 está encerrado.'), vi.fn());

    expect(no.getAttribute('role')).toBe('alert');
    expect(no.textContent).toContain('encerrado');
  });
});
