import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { estadoErro } from '@components/estado-erro.js';
import { formatNumber } from '@utils/format.js';
import { showError, showSuccess } from '@utils/toast.js';
import { getCodigosDisponiveis } from '@modules/acervo/services/ponto-controle-service.js';

/**
 * Códigos de ponto ainda livres.
 *
 * A base é o ACERVO INTEIRO, e não a camada da missão aberta no QGIS: aquela
 * conhece só os pontos da própria missão, e daria por livre um código que outra
 * missão já usou. O erro só apareceria na importação, depois da medição feita em
 * campo.
 *
 * A tela separa duas coisas que o CSV misturava:
 *  - os BURACOS, números que ficaram para trás e fecham lacuna;
 *  - os PRÓXIMOS, a sequência depois do maior já usado, que é de onde sai a
 *    numeração de uma missão nova.
 */

const QUANTIDADE = 200;

/** Copia para a área de transferência, que é o que se faz com uma lista dessas. */
async function copiar(codigos) {
  if (!codigos.length) return;
  try {
    await navigator.clipboard.writeText(codigos.join('\n'));
    showSuccess(`${codigos.length} código(s) copiado(s)`);
  } catch {
    showError('O navegador não permitiu copiar');
  }
}

function listaDeCodigos(codigos, vazio) {
  if (!codigos.length) return el('p', { className: 'pc-codigos__vazio', textContent: vazio });
  return el('div', { className: 'pc-codigos__lista' },
    codigos.map(c => el('span', { className: 'pc-codigos__item', textContent: c })));
}

function bloco(titulo, explicacao, codigos, vazio) {
  const cabecalho = el('div', { className: 'pc-codigos__cabecalho' }, [
    el('h4', { textContent: `${titulo} (${formatNumber(codigos.length)})` }),
    codigos.length
      ? el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => copiar(codigos),
      }, [svgIcon(ICONS.description, 16), 'Copiar'])
      : null,
  ].filter(Boolean));

  return el('section', { className: 'pc-codigos__bloco' }, [
    cabecalho,
    el('p', { className: 'pc-codigos__explicacao', textContent: explicacao }),
    listaDeCodigos(codigos, vazio),
  ]);
}

export function abrirCodigosDisponiveis() {
  const ufSelect = el('select', {
    className: 'busca-filtros__select',
    'aria-label': 'UF',
    onChange: () => carregar(),
  });

  const tipoSelect = el('select', {
    className: 'busca-filtros__select',
    'aria-label': 'Tipo de ponto',
    onChange: () => carregar(),
  }, [
    el('option', { value: 'HV', textContent: 'HV (ponto de apoio)' }),
    el('option', { value: 'BASE', textContent: 'BASE' }),
  ]);

  const resumo = el('p', { className: 'pc-codigos__resumo' });
  const corpo = el('div', { className: 'pc-codigos__corpo' });

  const raiz = el('div', { className: 'pc-codigos' }, [
    el('div', { className: 'busca-filtros' }, [ufSelect, tipoSelect]),
    resumo,
    corpo,
  ]);

  // `fechado` existe porque as consultas sao assincronas: sem ele, a resposta
  // que chega depois de a pessoa fechar o dialogo escreveria num DOM solto.
  let fechado = false;

  const modal = openModal({
    title: 'Códigos de ponto disponíveis',
    content: raiz,
    width: '720px',
    onClose: () => { fechado = true; },
    actions: [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }],
  });

  async function carregar() {
    const uf = ufSelect.value;
    if (!uf) return;
    corpo.replaceChildren(el('p', { textContent: 'Consultando...' }));
    try {
      const d = await getCodigosDisponiveis({
        uf, tipo: tipoSelect.value, quantidade: QUANTIDADE,
      });
      if (fechado) return;

      resumo.textContent = d.usados
        ? `${formatNumber(d.usados)} ponto(s) em ${uf}-${d.tipo}, o maior é `
          + `${uf}-${d.tipo}-${d.maior_usado}.`
        : `Nenhum ponto ${uf}-${d.tipo} no acervo: a numeração começa do 1.`;

      // O total de buracos vem do servidor e pode passar do que coube na
      // resposta. Dizer "200" quando são 627 esconderia justamente a informação
      // que decide se vale a pena preencher antes de seguir.
      const sobra = d.total_buracos > d.buracos.length
        ? ` Mostrando os ${formatNumber(d.buracos.length)} menores de `
          + `${formatNumber(d.total_buracos)}.`
        : '';

      corpo.replaceChildren(
        bloco(
          'Buracos na numeração',
          'Números que ficaram para trás, abaixo do maior já usado.' + sobra,
          d.buracos,
          'Não há buraco: a numeração está contínua.'
        ),
        bloco(
          'Próximos da sequência',
          'Depois do maior já usado. É daqui que sai a numeração de uma missão nova.',
          d.proximos,
          'A numeração chegou ao teto de quatro dígitos.'
        )
      );
    } catch (erro) {
      if (fechado) return;
      // Estado de ERRO, e nao a classe do estado vazio. `pc-codigos__vazio` e o
      // desenho de "Nao ha buraco: a numeracao esta continua", e as duas frases
      // pedem acoes opostas: uma manda seguir numerando, a outra manda tentar de
      // novo. Iguais na tela, quem le conclui que a UF nao tem lacuna.
      resumo.textContent = '';
      corpo.replaceChildren(estadoErro(erro, carregar));
    }
  }

  // A lista de UF sai do RESUMO por grupo, e não de uma lista fixa das 27:
  // mostrar UF sem ponto nenhum faria a tela oferecer escolha que não informa
  // nada, e o resumo já diz onde há acervo.
  async function carregarUfs() {
    try {
      const { grupos } = await getCodigosDisponiveis({});
      if (fechado) return;
      const ufs = [...new Set((grupos || []).map(g => g.uf))].sort();
      ufSelect.replaceChildren(
        ...ufs.map(uf => el('option', { value: uf, textContent: uf }))
      );
      if (ufs.length) {
        ufSelect.value = ufs[0];
        await carregar();
      } else {
        resumo.textContent = 'O acervo ainda não tem ponto de controle.';
      }
    } catch (erro) {
      if (fechado) return;
      // Sem a lista de UF o dialogo nao tem o que consultar, e ficava com o
      // combo vazio e o corpo em branco: lia-se como acervo sem ponto de
      // controle, que e a mesma leitura da linha logo acima.
      showError(erro.message || 'Erro ao listar as UFs');
      corpo.replaceChildren(estadoErro(erro, carregarUfs));
    }
  }

  carregarUfs();

  return modal;
}
