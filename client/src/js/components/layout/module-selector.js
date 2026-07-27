import { el } from '@utils/dom.js';
import { nomeModulo } from '@store/auth-store.js';
import { modulosAcessiveis, rotaInicial } from '@modules/registry.js';

/**
 * Seletor de modulo da navbar.
 *
 * Mostra SO os modulos em que a pessoa tem perfil (o administrador global ve
 * todos os portados). O rotulo vem do catalogo `dominio.modulo` do servidor,
 * guardado no login: nenhum nome de modulo fica decorado aqui.
 *
 * Trocar de modulo e trocar a rota: escreve `location.hash` e o roteador
 * resolve, sem recarregar a pagina.
 *
 * @returns {{element:HTMLElement, setModulo:Function}}
 */
export function createModuleSelector() {
  const acessiveis = modulosAcessiveis();

  const select = el('select', {
    className: 'navbar__modulo',
    'aria-label': 'Módulo',
    title: 'Trocar de módulo',
    onChange: (e) => {
      const destino = rotaInicial(e.target.value);
      if (location.hash !== `#${destino}`) location.hash = destino;
    },
  }, acessiveis.map(m => el('option', {
    value: m.id,
    textContent: nomeModulo(m.id),
  })));

  // Sem opcao nenhuma (ou uma so), o controle nao tem o que oferecer.
  if (acessiveis.length <= 1) {
    select.classList.add('navbar__modulo--unico');
    select.disabled = true;
  }

  /**
   * Sincroniza o valor exibido com o modulo da rota atual.
   * @param {string|null} moduloId
   */
  function setModulo(moduloId) {
    if (moduloId && acessiveis.some(m => m.id === moduloId)) {
      select.value = moduloId;
    }
  }

  return { element: select, setModulo };
}
