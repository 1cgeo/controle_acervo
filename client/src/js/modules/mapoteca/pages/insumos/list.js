import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatBoolean, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { badgeAbaixoMinimo } from '@components/status-chip.js';
import { getTiposMaterial, getEstoqueMaterial, getConsumoMensal } from '@modules/mapoteca/services/mapoteca-service.js';
import { permissoes } from '@store/auth-store.js';
import { TIPO_LOCALIZACAO, saldoPorLocalizacao } from '@modules/mapoteca/movimento-material.js';
import { criarAvisoDeErro } from '../aviso-carga.js';
import { openMaterialDialog } from './material-dialog.js';
import {
  openConsumoDialog,
  openEntradaDialog,
  openTransferenciaDialog,
  openContagemDialog,
} from './movimento-dialogs.js';

/**
 * INSUMOS (#/mapoteca/insumos): a tela unica do material.
 *
 * Ela substituiu TRES telas de 2026-08-08 para tras: Tipos de Material (o
 * cadastro), Estoque (o saldo por localizacao) e Consumo de material (o
 * lancamento). As tres respondiam pedacos da mesma pergunta -- "como esta o
 * papel?" -- e obrigavam a atravessar o menu para juntar a resposta: o saldo
 * numa tela, o minimo em outra, o gasto na terceira.
 *
 * O QUE CADA COLUNA RESPONDE:
 *
 *   Seção         o que da para usar HOJE, sem transferir nada;
 *   Almoxarifado  o que ha na casa mas ainda precisa descer para a Seção;
 *   Consumo no mês o numero que a 7.2 do RPCMTec imprime, lido da MESMA fonte
 *                 (`GET /consumo_mensal`): tela e relatorio nao podem divergir.
 *
 * NAO HA coluna "Estoque total" nem "Localizações": 'Aquisição realizada' e
 * 'Saldo no empenho' sao material comprado e ainda nao entregue, e some-los ao
 * que esta na prateleira esconderia a falta atras de uma compra que ainda esta
 * com o fornecedor. O total continua na ficha, para quem quer saber o que vem
 * vindo.
 *
 * O BADGE compara contra o DISPONIVEL (Seção + Almoxarifado), que e o
 * `abaixo_minimo` que o servidor ja resolve, pela mesma razao.
 *
 * SEM SELECAO MULTIPLA e sem "excluir selecionados". Excluir insumo em lote
 * apagava, num clique, o cadastro que a 7.2 do mes anterior casa por NOME. Quem
 * precisa tirar um insumo de circulacao desmarca "Ativo" no cadastro, e a
 * historia dele continua explicavel.
 *
 * A tela abre para CONSULTA (ler) e o operador LANCA. Quem barra a escrita e o
 * `verifyPerfil('operador', 'mapoteca')` do servidor; os botoes daqui so evitam
 * oferecer o que vai levar 403.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderInsumosList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('mapoteca');
  const mesAtual = new Date().getMonth() + 1;
  const anoAtual = new Date().getFullYear();

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openMaterialDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo insumo']);

  /**
   * As ACOES DA LINHA. A de CONSUMIR vem PRIMEIRO e fica na propria linha, e nao
   * atras de um menu: e o lancamento que a Secao faz todo dia, e o unico que
   * alimenta a 7.2 do RPCMTec. Escondido, ele deixa de ser feito -- foi assim
   * que `consumo_material` ficou com zero linhas em nove dias de producao.
   */
  const acoesDeEscrita = [
    {
      icon: ICONS.dataUsage,
      title: 'Consumir',
      onClick: (row) => openConsumoDialog({
        material: row, saldos: row.saldos, onSaved: load,
      }),
    },
    {
      icon: ICONS.download,
      title: 'Entrada',
      onClick: (row) => openEntradaDialog({ material: row, onSaved: load }),
    },
    {
      icon: ICONS.swapHoriz,
      title: 'Transferir',
      onClick: (row) => openTransferenciaDialog({
        material: row, saldos: row.saldos, onSaved: load,
      }),
    },
    {
      icon: ICONS.checkCircle,
      title: 'Contagem',
      onClick: (row) => openContagemDialog({
        material: row, saldos: row.saldos, onSaved: load,
      }),
    },
    {
      icon: ICONS.edit,
      title: 'Editar cadastro',
      onClick: (row) => openMaterialDialog({ material: row, onSaved: load }),
    },
  ];

  const table = createDataTable({
    columns: [
      {
        key: 'nome',
        label: 'Insumo',
        sortable: true,
        render: (row) => {
          const cell = el('span', {
            style: { display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
          }, [
            el('a', { href: `#/mapoteca/insumos/${row.id}`, textContent: row.nome }),
          ]);
          if (row.abaixo_minimo) cell.appendChild(badgeAbaixoMinimo());
          return cell;
        },
      },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
      {
        key: 'na_secao',
        label: 'Seção',
        sortable: true,
        render: (row) => formatNumber(row.na_secao),
      },
      {
        key: 'no_almoxarifado',
        label: 'Almoxarifado',
        sortable: true,
        render: (row) => formatNumber(row.no_almoxarifado),
      },
      {
        key: 'consumo_no_mes',
        label: 'Consumo no mês',
        sortable: true,
        render: (row) => formatNumber(row.consumo_no_mes),
      },
      {
        key: 'estoque_minimo',
        label: 'Estoque mínimo',
        sortable: true,
        render: (row) => formatNumber(row.estoque_minimo),
      },
      { key: 'ativo', label: 'Ativo', render: (row) => formatBoolean(row.ativo) },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum insumo cadastrado',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Abrir a ficha',
        onClick: (row) => { location.hash = `/mapoteca/insumos/${row.id}`; },
      },
      ...(pode.operador ? acoesDeEscrita : []),
    ],
  });

  const aviso = criarAvisoDeErro(table, load);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Insumos' }),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    el('p', {
      className: 'dashboard__escopo',
      textContent: 'Os saldos são de hoje. O consumo do mês é o mesmo número da '
        + 'tabela 7.2 do RPCMTec.',
    }),
    aviso.element,
  ]);
  container.appendChild(page);

  async function load() {
    table.update({ loading: true });
    try {
      // AS TRES LEITURAS DE UMA VEZ, e nao encadeadas: nenhuma depende do
      // resultado da outra, e em serie a tela levaria o triplo para aparecer.
      //
      // `getTiposMaterial` traz os totais e o `abaixo_minimo`; so a leitura do
      // ESTOQUE abre o saldo por localizacao, que e de onde saem as colunas
      // Seção e Almoxarifado.
      const [materiais, estoque, consumoMensal] = await Promise.all([
        getTiposMaterial(),
        getEstoqueMaterial(),
        getConsumoMensal(anoAtual),
      ]);
      if (disposed) return;

      const saldos = saldoPorLocalizacao(estoque);
      const consumoDoMes = new Map();
      for (const linha of consumoMensal) {
        if (Number(linha.mes) !== mesAtual) continue;
        consumoDoMes.set(Number(linha.tipo_material_id), Number(linha.quantidade));
      }

      const rows = materiais.map(r => {
        const doMaterial = saldos.get(Number(r.id)) || new Map();
        return {
          ...r,
          estoque_total: Number(r.estoque_total),
          estoque_disponivel: Number(r.estoque_disponivel),
          estoque_minimo: r.estoque_minimo === null ? null : Number(r.estoque_minimo),
          na_secao: doMaterial.get(TIPO_LOCALIZACAO.SECAO) || 0,
          no_almoxarifado: doMaterial.get(TIPO_LOCALIZACAO.ALMOXARIFADO) || 0,
          consumo_no_mes: consumoDoMes.get(Number(r.id)) || 0,
          // O saldo por localizacao viaja com a linha: os dialogos de Consumir,
          // Transferir e Contagem precisam dele para dizer de quanto o saldo
          // sai, e uma segunda busca no clique mostraria um numero diferente do
          // que a tabela acabou de mostrar.
          saldos: doMaterial,
        };
      });
      table.update({ rows, loading: false });
      aviso.ok();
    } catch (err) {
      if (disposed) return;
      table.update({ loading: false });
      aviso.falhou(err.message || 'Erro ao carregar os insumos');
      showError(err.message || 'Erro ao carregar os insumos');
    }
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
