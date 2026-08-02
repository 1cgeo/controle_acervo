import { el } from '@utils/dom.js';

/**
 * Escolha de VÁRIOS militares do cadastro, com busca.
 *
 * POR QUE NÃO `<select multiple>`: o nativo exige Ctrl para marcar o segundo
 * nome e desmarca tudo num clique distraído, e não tem busca. Com trinta
 * militares isso é um controle que se erra sem perceber.
 *
 * POR QUE NÃO CHIPS com autocompletar: `createChipInput` guarda TEXTO, e o que
 * se guarda aqui é o uuid de uma pessoa do cadastro. Um chip digitado à mão
 * voltaria ao problema que este componente existe para resolver.
 *
 * A CAIXA TEM ALTURA FIXA e rola por dentro. Sem isso, um formulário de
 * capacitação com trinta militares empurraria os botões de salvar para fora da
 * tela, e a lista continuaria crescendo a cada militar novo no cadastro.
 *
 * QUEM JÁ ESTÁ MARCADO APARECE MESMO SE ESTIVER DESATIVADO no cadastro. Quem
 * participou de uma capacitação em março e saiu da Divisão em julho não pode
 * sumir da linha de março; a lista o mostra com a marca de desativado, e ele só
 * some se alguém o desmarcar.
 *
 * @param {Object} options
 * @param {string} options.label
 * @param {Array<{uuid:string, nome_guerra:string, posto_abrev:string, ativo?:boolean}>} options.usuarios
 * @param {Array<string>} [options.selecionados] - uuids já marcados
 * @param {string} [options.helpText]
 * @returns {{element:HTMLElement, getValue:()=>string[], setError:(m:string|null)=>void}}
 */
export function createSeletorMilitares({
  label,
  usuarios = [],
  selecionados = [],
  helpText,
} = {}) {
  const marcados = new Set(selecionados);

  const contador = el('span', {
    style: { color: 'var(--text-secondary)', fontWeight: 'var(--font-weight-normal)' },
  });

  const lista = el('div', {
    style: {
      maxHeight: '180px',
      overflowY: 'auto',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-xs)',
    },
  });

  const busca = el('input', {
    className: 'form-field__input',
    type: 'search',
    placeholder: 'Buscar militar...',
    'aria-label': `Buscar em ${label}`,
    onInput: () => desenhar(),
  });

  const erro = el('div', { className: 'form-field__error hidden' });

  function atualizarContador() {
    contador.textContent = marcados.size
      ? ` (${marcados.size} selecionado${marcados.size > 1 ? 's' : ''})`
      : '';
  }

  function desenhar() {
    const termo = busca.value.trim().toLowerCase();
    lista.innerHTML = '';

    const visiveis = usuarios.filter(u => {
      if (!termo) return true;
      return `${u.posto_abrev || ''} ${u.nome_guerra} ${u.nome || ''}`
        .toLowerCase()
        .includes(termo);
    });

    if (!visiveis.length) {
      lista.appendChild(el('div', {
        style: { padding: 'var(--space-sm)', color: 'var(--text-secondary)' },
        textContent: 'Nenhum militar encontrado.',
      }));
      return;
    }

    for (const u of visiveis) {
      const caixa = el('input', { type: 'checkbox', className: 'form-field__checkbox' });
      caixa.checked = marcados.has(u.uuid);
      caixa.addEventListener('change', () => {
        if (caixa.checked) marcados.add(u.uuid);
        else marcados.delete(u.uuid);
        atualizarContador();
      });

      lista.appendChild(el('label', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          padding: '4px var(--space-xs)',
          cursor: 'pointer',
        },
      }, [
        caixa,
        `${u.posto_abrev || ''} ${u.nome_guerra}`.trim(),
        u.ativo === false
          ? el('span', {
            style: { color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' },
            textContent: '(desativado)',
          })
          : null,
      ]));
    }
  }

  atualizarContador();
  desenhar();

  const element = el('div', { className: 'form-field' }, [
    el('label', { className: 'form-field__label' }, [label, contador]),
    busca,
    lista,
    helpText ? el('div', { className: 'form-field__help', textContent: helpText }) : null,
    erro,
  ]);

  return {
    element,
    getValue: () => [...marcados],
    setError: (mensagem) => {
      if (mensagem) {
        erro.textContent = mensagem;
        erro.classList.remove('hidden');
        element.classList.add('form-field--error');
      } else {
        erro.textContent = '';
        erro.classList.add('hidden');
        element.classList.remove('form-field--error');
      }
    },
  };
}
