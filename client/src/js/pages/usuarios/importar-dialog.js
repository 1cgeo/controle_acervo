import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { showSuccess, showError } from '@utils/toast.js';
import { importarUsuarios } from '@services/plataforma-service.js';

/** Texto de busca de uma pessoa, sem acento e em minusculas. */
function chaveDeBusca(u) {
  return [u.login, u.nome, u.nome_guerra, u.tipo_posto_grad]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Normaliza o termo digitado do mesmo jeito, para "joao" achar "João". */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Modal de importacao de pessoas do Auth Server.
 *
 * O Auth Server e a fonte dos usuarios da DGEO inteira, entao esta lista chega
 * grande. Antes era uma coluna crua de checkbox, sem busca, sem contador e sem
 * selecionar tudo: achar uma pessoa era rolar a lista com o olho, e importar
 * uma turma inteira era clicar dezenas de vezes.
 *
 * Importar aqui NAO concede acesso a modulo nenhum: cria a pessoa no SCA sem
 * perfil. Liberar continua sendo ato explicito, na tela de perfis. O rodape diz
 * isso, porque a confusao entre as duas coisas e o erro natural de quem importa
 * pela primeira vez.
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.disponiveis - pessoas devolvidas pelo Auth Server
 * @param {(u:Object)=>string} opts.nomeExibicao
 * @param {Function} opts.onSaved - recarrega a lista
 */
export function abrirImportarDialog({ disponiveis, nomeExibicao, onSaved }) {
  const pessoas = disponiveis.map(u => ({
    dados: u,
    busca: chaveDeBusca(u),
    marcada: false,
  }));

  const linhas = new Map();

  // ---------------------------------------------------------------------------
  // Busca
  // ---------------------------------------------------------------------------
  const buscaInput = el('input', {
    className: 'form-field__input',
    type: 'search',
    placeholder: 'Buscar por nome, login ou posto',
    'aria-label': 'Buscar pessoa',
    autocomplete: 'off',
    onInput: () => aplicarFiltro(),
  });

  const vazio = el('p', {
    className: 'importar-dialog__vazio hidden',
    textContent: 'Nenhuma pessoa encontrada para esta busca.',
  });

  // ---------------------------------------------------------------------------
  // Lista
  // ---------------------------------------------------------------------------
  const lista = el('div', { className: 'importar-dialog__lista', role: 'group', 'aria-label': 'Pessoas disponíveis' });

  for (const pessoa of pessoas) {
    const check = el('input', {
      className: 'form-field__checkbox',
      type: 'checkbox',
      onChange: (e) => {
        pessoa.marcada = e.target.checked;
        linha.classList.toggle('importar-dialog__item--marcada', pessoa.marcada);
        atualizarRodape();
      },
    });

    const secundario = [pessoa.dados.login, pessoa.dados.tipo_posto_grad]
      .filter(Boolean)
      .join(' · ');

    const linha = el('label', { className: 'importar-dialog__item' }, [
      check,
      el('span', { className: 'importar-dialog__pessoa' }, [
        el('span', { className: 'importar-dialog__nome', textContent: nomeExibicao(pessoa.dados) }),
        secundario
          ? el('span', { className: 'importar-dialog__secundario', textContent: secundario })
          : null,
      ]),
    ]);

    linhas.set(pessoa, { linha, check });
    lista.appendChild(linha);
  }

  // ---------------------------------------------------------------------------
  // Barra de selecao
  // ---------------------------------------------------------------------------
  const contador = el('span', { className: 'importar-dialog__contador' });

  const marcarVisiveis = (valor) => {
    for (const pessoa of visiveis()) {
      pessoa.marcada = valor;
      const { linha, check } = linhas.get(pessoa);
      check.checked = valor;
      linha.classList.toggle('importar-dialog__item--marcada', valor);
    }
    atualizarRodape();
  };

  const selecionarTodosBtn = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => marcarVisiveis(true),
  }, [svgIcon(ICONS.checkCircle, 16), 'Selecionar todos']);

  const limparBtn = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => marcarVisiveis(false),
  }, [svgIcon(ICONS.close, 16), 'Limpar seleção']);

  const barra = el('div', { className: 'importar-dialog__barra' }, [
    contador,
    el('div', { className: 'importar-dialog__barra-acoes' }, [selecionarTodosBtn, limparBtn]),
  ]);

  const corpo = el('div', { className: 'importar-dialog' }, [
    el('div', { className: 'form-field' }, [buscaInput]),
    barra,
    lista,
    vazio,
    el('p', {
      className: 'importar-dialog__nota',
      textContent: 'Importar cria a pessoa no SCA sem perfil em módulo nenhum. '
        + 'O acesso é concedido depois, em "Definir perfis por módulo".',
    }),
  ]);

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------
  /** Pessoas que passam pelo filtro de busca no momento. */
  function visiveis() {
    return pessoas.filter(p => !linhas.get(p).linha.classList.contains('hidden'));
  }

  function aplicarFiltro() {
    const termo = normalizar(buscaInput.value);
    let visiveisCount = 0;

    for (const pessoa of pessoas) {
      const casa = !termo || pessoa.busca.includes(termo);
      linhas.get(pessoa).linha.classList.toggle('hidden', !casa);
      if (casa) visiveisCount++;
    }

    vazio.classList.toggle('hidden', visiveisCount > 0);
    lista.classList.toggle('hidden', visiveisCount === 0);
    atualizarRodape();
  }

  function marcadas() {
    return pessoas.filter(p => p.marcada);
  }

  function atualizarRodape() {
    const total = marcadas().length;
    const naTela = visiveis().length;

    contador.textContent = total
      ? `${total} de ${pessoas.length} selecionada(s)`
      : `${naTela} pessoa(s) disponível(is)`;

    // Sem nada visivel nao ha o que marcar, e marcar tudo com filtro ligado
    // pega SO o que esta na tela, que e o que a pessoa enxerga.
    selecionarTodosBtn.disabled = naTela === 0;
    limparBtn.disabled = total === 0;

    importarBtn.disabled = total === 0;
    importarBtn.textContent = total === 0 ? 'Importar' : `Importar ${total}`;
  }

  const modal = openModal({
    title: 'Importar do serviço de autenticação',
    content: corpo,
    width: '620px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Importar',
        variant: 'primary',
        onClick: async ({ close }) => {
          const uuids = marcadas().map(p => p.dados.uuid);
          if (!uuids.length) return;

          importarBtn.disabled = true;
          try {
            await importarUsuarios(uuids);
            showSuccess(`${uuids.length} usuário(s) importado(s) com sucesso`);
            close();
            await onSaved();
          } catch (err) {
            importarBtn.disabled = false;
            showError(err.message || 'Erro ao importar usuários');
          }
        },
      },
    ],
  });

  const importarBtn = modal.element.querySelector('.modal__footer .btn--primary');

  atualizarRodape();
}
