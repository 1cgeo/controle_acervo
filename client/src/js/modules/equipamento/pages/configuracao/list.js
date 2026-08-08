import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import { chip } from '@components/status-chip.js';
import { permissoes } from '@store/auth-store.js';
import { getTipos, deleteTipo } from '@modules/equipamento/services/equipamento-service.js';
import { abrirTipoDialog } from './tipo-dialog.js';

/**
 * A tela CONFIGURAÇÃO do módulo (#/equipamento/configuracao), que hoje abriga o
 * cadastro de TIPOS DE EQUIPAMENTO.
 *
 * É DE GERENTE, tela inteira, desde 2026-08-08: `vida_util_meses` do tipo é
 * herdada por todo bem que não declare a própria, então uma linha alterada aqui
 * muda dezenas de bens de uma vez, sem passar por nenhum deles. Quem esconde o
 * item do menu é o `perfil: 'gerente'` da ROTA, no manifesto, e não uma regra
 * escrita aqui.
 *
 * Nasce semeado com os nove tipos do QDMP (`er/equipamento.sql`), e é o único
 * cadastro do módulo: os outros cinco catálogos (classe de suprimento, seção
 * detentora, situação, situação e tipo de transferência) são DOMÍNIO, de código
 * fixo, e não têm tela.
 *
 * EXCLUIR É DO GERENTE, e cadastrar e alterar são do operador. O corte não é
 * arbitrário: o tipo é referenciado por `equipamento.tipo_id`, então apagar um
 * tipo em uso é o que o banco recusa e o que o gerente responde. Para tirar um
 * tipo de circulação sem apagar nada, desmarque "Ativo" na edição.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderConfiguracao(container, _ctx) {
  let disposed = false;
  const pode = permissoes('equipamento');

  const tabela = createDataTable({
    columns: [
      { key: 'nome', label: 'Nome', sortable: true, render: (r) => r.nome || '-' },
      {
        key: 'vida_util_meses',
        label: 'Vida útil (meses)',
        sortable: true,
        sortValue: (r) => (r.vida_util_meses === null || r.vida_util_meses === undefined
          ? null
          : Number(r.vida_util_meses)),
        // MESES na tela, sempre: é como o dado é guardado, e é o número que se
        // digita no formulário. Quem converte para anos é o documento.
        render: (r) => (r.vida_util_meses === null || r.vida_util_meses === undefined
          ? '-'
          : el('span', { className: 'equip-numero', textContent: formatNumber(r.vida_util_meses) })),
      },
      {
        key: 'ativo',
        label: 'Situação',
        sortable: true,
        sortValue: (r) => (r.ativo === false ? 0 : 1),
        render: (r) => (r.ativo === false ? chip('Inativo', 'default') : chip('Ativo', 'success')),
      },
      {
        key: 'descricao',
        label: 'Descrição',
        className: 'data-table__cell--truncate',
        render: (r) => r.descricao || '-',
      },
    ],
    rows: [],
    loading: true,
    searchable: true,
    pageSize: 25,
    defaultSort: { key: 'nome', dir: 'asc' },
    emptyMessage: 'Nenhum tipo de equipamento cadastrado',
    actions: [
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar tipo',
        onClick: (r) => abrirTipoDialog({ tipo: r, onSaved: carregar }),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir tipo',
        variant: 'danger',
        onClick: (r) => excluir(r),
      }] : []),
    ],
  });

  const areaTabela = el('div', {}, [tabela.element]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Configuração' }),
      el('div', { className: 'page__actions' }, pode.operador ? [
        el('button', {
          className: 'btn btn--primary',
          type: 'button',
          onClick: () => abrirTipoDialog({ onSaved: carregar }),
        }, [svgIcon(ICONS.add, 16), 'Novo tipo']),
      ] : []),
    ]),
    areaTabela,
  ]);
  container.appendChild(page);

  async function excluir(tipo) {
    const ok = await confirmDialog({
      title: 'Excluir tipo de equipamento',
      message: `Excluir o tipo "${tipo.nome}"? Esta ação não pode ser desfeita. `
        + 'Um tipo que já tem bens cadastrados não pode ser excluído: para tirá-lo de circulação, '
        + 'edite o registro e desmarque "Ativo".',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTipo(tipo.id);
      showSuccess('Tipo excluído com sucesso');
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o tipo');
    }
  }

  async function carregar() {
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(tabela.element)) areaTabela.replaceChildren(tabela.element);

    tabela.update({ loading: true });
    try {
      const dados = await getTipos();
      if (disposed) return;
      tabela.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      tabela.update({ loading: false });
      // Zerar as linhas faria a tabela escrever "Nenhum tipo cadastrado": a
      // falha da API leria-se como cadastro vazio, e as duas pedem ações
      // opostas -- uma pede tentar de novo, a outra pede cadastrar.
      areaTabela.replaceChildren(tabela.element);
      mostrarErro(areaTabela, err, carregar);
      showError(err.message || 'Erro ao carregar os tipos de equipamento');
    }
  }

  await carregar();

  return () => {
    disposed = true;
    tabela._cleanup();
  };
}
