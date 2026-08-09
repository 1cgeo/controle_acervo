import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { showSuccess, showError } from '@utils/toast.js';
import { atualizarUsuario } from '@services/plataforma-service.js';

/**
 * O que cada nivel permite, em uma linha, para o chefe escolher sem adivinhar.
 * Vale igual em todos os modulos: o nivel e a hierarquia, o modulo e o escopo.
 */
const AJUDA_NIVEL = {
  0: 'Sem acesso: a pessoa não entra no módulo, nem para ler.',
  1: 'Consulta: lê os dados do módulo. Não escreve.',
  2: 'Operador: lê e lança o trabalho do dia a dia do módulo.',
  3: 'Gerente: tudo do operador, mais editar o que é estruturante e excluir registros.',
};

/** Rotulo curto do nivel, para o botao do controle segmentado. */
function rotuloNivel(nivel, tiposPerfil) {
  if (!nivel) return 'Sem acesso';
  const achado = (tiposPerfil || []).find(t => t.code === nivel);
  return achado ? achado.nome : `Nível ${nivel}`;
}

/**
 * Controle segmentado de um modulo: os niveis lado a lado, na ordem da
 * hierarquia, em vez de escondidos dentro de um <select>.
 *
 * O <select> obrigava a abrir a lista para descobrir o que existe, e o texto de
 * ajuda so aparecia depois de escolher. Aqui os quatro niveis estao a vista, a
 * distancia entre "Sem acesso" e "Gerente" fica legivel, e conceder e UM clique.
 *
 * @param {Object} opts
 * @param {number} opts.valor - nivel atual (0 a 3)
 * @param {Array<{code:number, nome:string}>} opts.tiposPerfil - catalogo do servidor
 * @param {string} opts.nomeModulo - para o aria-label
 * @param {(nivel:number)=>void} opts.onChange
 * @returns {{element:HTMLElement, getValor:()=>number}}
 */
function criarSeletorNivel({ valor, tiposPerfil, nomeModulo, onChange }) {
  let atual = valor;

  // 0 nao vem do catalogo: "sem linha em usuario_perfil" nao e um tipo_perfil,
  // e a ausencia de acesso. Por isso entra na mao, sempre primeiro.
  const niveis = [
    { code: 0, nome: 'Sem acesso' },
    ...(tiposPerfil || []).slice().sort((a, b) => a.code - b.code),
  ];

  const botoes = new Map();

  const grupo = el('div', {
    className: 'seletor-nivel',
    role: 'radiogroup',
    'aria-label': `Nível em ${nomeModulo}`,
  });

  function selecionar(nivel, focar = false) {
    atual = nivel;
    for (const [code, btn] of botoes) {
      const ativo = code === nivel;
      btn.classList.toggle('seletor-nivel__item--ativo', ativo);
      btn.setAttribute('aria-checked', String(ativo));
      // Roving tabindex: o grupo inteiro e UMA parada de tabulacao, e as setas
      // andam entre os niveis, que e o comportamento esperado de um radiogroup.
      btn.tabIndex = ativo ? 0 : -1;
    }
    if (focar) botoes.get(nivel).focus();
    onChange(nivel);
  }

  for (const nivel of niveis) {
    const ativo = nivel.code === atual;
    const btn = el('button', {
      className: `seletor-nivel__item seletor-nivel__item--n${nivel.code}${ativo ? ' seletor-nivel__item--ativo' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': String(ativo),
      tabIndex: ativo ? 0 : -1,
      textContent: nivel.code === 0 ? 'Sem acesso' : nivel.nome,
      title: AJUDA_NIVEL[nivel.code] || '',
      onClick: () => selecionar(nivel.code),
      onKeyDown: (e) => {
        const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!passo) return;
        e.preventDefault();
        const i = niveis.findIndex(n => n.code === atual);
        const proximo = niveis[(i + passo + niveis.length) % niveis.length];
        selecionar(proximo.code, true);
      },
    });
    botoes.set(nivel.code, btn);
    grupo.appendChild(btn);
  }

  return { element: grupo, getValor: () => atual };
}

/**
 * Uma linha por modulo: nome, o que a pessoa tem hoje, o seletor de nivel e a
 * ajuda do nivel escolhido. A linha se marca sozinha quando muda, para o
 * revisor ver de longe o que esta prestes a salvar.
 */
function criarLinhaModulo({ modulo, atual, tiposPerfil, onChange }) {
  const marca = el('span', { className: 'perfil-linha__marca', textContent: 'alterado' });
  const ajuda = el('p', { className: 'perfil-linha__ajuda', textContent: AJUDA_NIVEL[atual] });

  const seletor = criarSeletorNivel({
    valor: atual,
    tiposPerfil,
    nomeModulo: modulo.nome,
    onChange: (nivel) => {
      ajuda.textContent = AJUDA_NIVEL[nivel] || AJUDA_NIVEL[0];
      const mudou = nivel !== atual;
      linha.classList.toggle('perfil-linha--alterada', mudou);
      marca.textContent = mudou
        ? `${rotuloNivel(atual, tiposPerfil)} para ${rotuloNivel(nivel, tiposPerfil)}`
        : 'alterado';
      onChange();
    },
  });

  const linha = el('div', { className: 'perfil-linha' }, [
    el('div', { className: 'perfil-linha__cabecalho' }, [
      el('span', { className: 'perfil-linha__modulo', textContent: modulo.nome }),
      marca,
    ]),
    seletor.element,
    ajuda,
  ]);

  return {
    element: linha,
    modulo: modulo.nome_abrev,
    inicial: atual,
    getValor: seletor.getValor,
  };
}

/**
 * Modal de perfis por modulo de uma pessoa.
 *
 * E a tela que de fato libera o sistema, entao ela mostra o estado ANTES e o
 * DEPOIS: o botao de salvar diz quantas mudancas vao junto e fica desativado
 * quando nao ha nenhuma. Antes o Salvar sem mudanca simplesmente fechava o
 * modal, o que era indistinguivel de ter salvado.
 *
 * @param {Object} opts
 * @param {Object} opts.usuario - linha da tabela de usuarios
 * @param {Array<{code:number, nome:string, nome_abrev:string}>} opts.modulos
 * @param {Array<{code:number, nome:string}>} opts.tiposPerfil
 * @param {string} opts.nomeExibicao
 * @param {Function} opts.onSaved - recarrega a lista
 */
export function abrirPerfisDialog({ usuario, modulos, tiposPerfil, nomeExibicao, onSaved }) {
  const atuais = usuario.perfis || {};

  const linhas = modulos.map(m => criarLinhaModulo({
    modulo: m,
    atual: atuais[m.nome_abrev] || 0,
    tiposPerfil,
    onChange: () => atualizarRodape(),
  }));

  // Identidade de quem esta sendo alterado. O titulo do modal ja traz o nome,
  // mas login e posto sao o que evita conceder acesso para o homonimo errado.
  const identidade = [usuario.login, usuario.tipo_posto_grad].filter(Boolean).join(' · ');

  const corpo = el('div', { className: 'perfis-dialog' }, [
    identidade
      ? el('p', { className: 'perfis-dialog__identidade', textContent: identidade })
      : null,

    usuario.administrador
      ? el('div', { className: 'perfis-dialog__aviso' }, [
        svgIcon(ICONS.lock, 18),
        el('span', {
          textContent: 'Esta pessoa é administradora global: passa em qualquer módulo e nível, '
            + 'independente do que for escolhido aqui.',
        }),
      ])
      : null,

    el('div', { className: 'perfis-dialog__lista' }, linhas.map(l => l.element)),
  ]);

  const modal = openModal({
    title: `Perfis de ${nomeExibicao}`,
    content: corpo,
    width: '620px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          const perfis = alteracoes();
          if (!Object.keys(perfis).length) return;

          salvarBtn.disabled = true;
          try {
            await atualizarUsuario(usuario.uuid, {
              administrador: usuario.administrador,
              ativo: usuario.ativo,
              perfis,
            });
            showSuccess('Perfis atualizados com sucesso');
            close();
            await onSaved();
          } catch (err) {
            salvarBtn.disabled = false;
            showError(err.message || 'Erro ao atualizar os perfis');
          }
        },
      },
    ],
  });

  const salvarBtn = modal.element.querySelector('.modal__footer .btn--primary');

  /** So o que MUDOU: modulo omitido fica como esta no servidor. */
  function alteracoes() {
    const perfis = {};
    for (const linha of linhas) {
      const escolhido = linha.getValor();
      if (escolhido === linha.inicial) continue;
      // 0 vira null de proposito: e assim que se REVOGA o acesso.
      perfis[linha.modulo] = escolhido === 0 ? null : escolhido;
    }
    return perfis;
  }

  function atualizarRodape() {
    const total = Object.keys(alteracoes()).length;
    salvarBtn.disabled = total === 0;
    salvarBtn.textContent = total === 0
      ? 'Salvar'
      : `Salvar ${total} ${total > 1 ? 'alterações' : 'alteração'}`;
  }

  atualizarRodape();
}
