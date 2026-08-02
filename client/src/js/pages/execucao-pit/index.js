import { el } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import {
  getExecucaoMes,
  getResumoPit,
  getAnosMetaPit,
  salvarExecucaoPit,
  codigoMetaPit,
} from '@services/plataforma-service.js';
import { isAdmin } from '@store/auth-store.js';

/**
 * Execução do PIT (#/execucao_pit): o lançamento mensal que alimenta a subseção
 * 2.1 do RPCMTec.
 *
 * É uma GRADE DE PREENCHIMENTO, e não uma lista do que existe. Ela mostra TODA
 * meta-folha do ano, com ou sem lançamento naquele mês: uma tela que só
 * mostrasse o já lançado não diria o que falta, que é justamente a pergunta de
 * quem abre isto no fim do mês.
 *
 * TUDO É MANUAL, inclusive as metas de produção (chefe, 2026-08-02). Enquanto o
 * SAP não for absorvido não há de onde calcular, e a tela DIZ isso: sem a frase,
 * a coluna zerada da meta 1 se leria como "não produzimos nada", e não como
 * "ninguém lançou".
 *
 * SÓ A FOLHA aparece. A meta que se subdivide tem uma linha de cabeçalho e uma
 * por item, e quem entrega é o item; o servidor recusa lançamento no cabeçalho,
 * e oferecê-lo aqui seria oferecer o 400.
 *
 * O CAMPO SALVA NO `change` (sair do campo ou apertar Enter), e a tela NÃO se
 * recarrega ao salvar: recarregar redesenharia os 37 campos e tiraria o foco de
 * quem está descendo a grade com Tab. O acumulado é corrigido pelo DELTA na
 * própria linha, que é a mesma conta que o servidor fez.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderExecucaoPit(container, _ctx) {
  let disposed = false;
  const podeEscrever = isAdmin();

  const hoje = new Date();
  let anoSelecionado = hoje.getFullYear();
  let mesSelecionado = hoje.getMonth() + 1;

  // Os dados da tela, por meta. Guardados aqui (e não só na tabela) porque o
  // salvamento corrige a linha sem redesenhar a tabela inteira.
  let linhas = [];

  const anoFilter = createSelectField({
    label: 'Ano',
    options: [],
    placeholder: 'Ano',
    value: anoSelecionado,
    onChange: (valor) => {
      if (valor === null) return;
      anoSelecionado = Number(valor);
      load();
    },
  });

  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const mesFilter = createSelectField({
    label: 'Mês',
    options: MESES.map((nome, i) => ({ value: i + 1, label: nome })),
    placeholder: 'Mês',
    value: mesSelecionado,
    onChange: (valor) => {
      if (valor === null) return;
      mesSelecionado = Number(valor);
      load();
    },
  });

  /** Campo de quantidade de UMA linha. Salva ao sair do campo. */
  function campoQuantidade(row) {
    if (!podeEscrever) {
      return row.quantidade == null ? '-' : String(row.quantidade);
    }

    const input = el('input', {
      className: 'form-field__input',
      type: 'number',
      min: '0',
      step: '1',
      style: { width: '90px', textAlign: 'right' },
      'aria-label': `Realizado em ${MESES[mesSelecionado - 1]} na meta ${codigoMetaPit(row)}`,
      value: row.quantidade == null ? '' : String(row.quantidade),
    });

    input.addEventListener('change', () => salvar(row, input));

    return input;
  }

  const table = createDataTable({
    columns: [
      { key: 'codigo', label: 'Meta', sortable: true, render: (row) => codigoMetaPit(row) },
      { key: 'descricao', label: 'Produto ou serviço', render: (row) => row.descricao || '-' },
      {
        key: 'quantidade_prevista',
        label: 'Previsto',
        sortable: true,
        render: (row) => (row.quantidade_prevista == null
          ? '-'
          : `${row.quantidade_prevista}${row.unidade ? ` ${row.unidade}` : ''}`),
      },
      { key: 'quantidade', label: 'Realizado no mês', render: campoQuantidade },
      {
        key: 'realizado',
        label: 'Acumulado no ano',
        sortable: true,
        render: (row) => String(row.realizado ?? 0),
      },
      {
        key: 'percentual',
        label: '% do previsto',
        // O percentual é DERIVADO, então a ordenação precisa do valor e não do
        // texto: '100%' e '9%' comparados como texto põem o 100 antes do 9.
        sortValue: (row) => percentual(row) ?? -1,
        render: (row) => {
          const p = percentual(row);
          return p === null ? '-' : `${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
        },
      },
    ],
    rows: [],
    searchable: true,
    // Sem paginação: são algumas dezenas de metas e a grade se preenche de cima
    // a baixo. Paginar obrigaria a trocar de página no meio do preenchimento.
    paginated: false,
    loading: true,
    emptyMessage: 'Nenhuma meta cadastrada neste ano',
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Execução do PIT' }),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [anoFilter.element, mesFilter.element]),
    table.element,
  ]);
  container.appendChild(page);

  function percentual(row) {
    const previsto = Number(row.quantidade_prevista);
    if (!previsto || previsto <= 0) return null;
    return (100 * Number(row.realizado || 0)) / previsto;
  }

  async function salvar(row, input) {
    const bruto = input.value.trim();
    // Campo esvaziado NÃO apaga o lançamento: apagar é ato próprio, e um Tab
    // apressado sobre um campo preenchido não deveria destruir o número.
    // Devolvemos o valor de antes, que é o que o servidor tem.
    if (bruto === '') {
      input.value = row.quantidade == null ? '' : String(row.quantidade);
      return;
    }

    const quantidade = Number(bruto);
    if (!Number.isInteger(quantidade) || quantidade < 0) {
      showError('A quantidade tem de ser um número inteiro, zero ou mais');
      input.value = row.quantidade == null ? '' : String(row.quantidade);
      return;
    }
    if (quantidade === row.quantidade) return;

    const anterior = row.quantidade || 0;
    try {
      await salvarExecucaoPit({
        meta_id: row.meta_id,
        mes: mesSelecionado,
        quantidade,
      });
      if (disposed) return;

      // A mesma conta que o servidor fez. Refazer a consulta redesenharia a
      // tabela e tiraria o foco de quem está descendo a grade com Tab.
      row.quantidade = quantidade;
      row.realizado = Number(row.realizado || 0) - anterior + quantidade;
      atualizarLinha(row, input);
      showSuccess('Execução lançada');
    } catch (err) {
      if (disposed) return;
      input.value = row.quantidade == null ? '' : String(row.quantidade);
      showError(err.message || 'Erro ao lançar a execução');
    }
  }

  // Redesenha SÓ as duas células derivadas da linha alterada. A tabela não é
  // reconstruída, então o campo em foco continua onde estava.
  //
  // A linha é achada A PARTIR DO CAMPO (`closest('tr')`), e não por um seletor
  // com o id: o `data-table` não marca a linha com atributo nenhum, e inventar
  // um casamento por índice quebraria na primeira ordenação de coluna.
  function atualizarLinha(row, input) {
    const tr = input.closest('tr');
    if (!tr) return;
    const celulas = tr.querySelectorAll('td');
    // As duas últimas colunas são Acumulado e %, nesta ordem.
    if (celulas.length < 2) return;
    const p = percentual(row);
    celulas[celulas.length - 2].textContent = String(row.realizado ?? 0);
    celulas[celulas.length - 1].textContent = p === null
      ? '-'
      : `${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  }

  async function loadAnos() {
    let anos = [];
    try {
      anos = await getAnosMetaPit();
    } catch (err) {
      anos = [];
    }
    if (disposed) return;
    const corrente = new Date().getFullYear();
    const todos = [...new Set([corrente, ...(anos || []).map(Number)])].sort((a, b) => b - a);
    anoFilter.setOptions(todos.map(a => ({ value: a, label: String(a) })));
    anoFilter.setValue(anoSelecionado);
  }

  async function load() {
    table.update({ loading: true });
    try {
      // DUAS consultas, e não uma: a grade do mês traz o lançamento daquele mês
      // (e diz se ele existe), e o resumo traz o acumulado até ele. Somar no
      // cliente daria um acumulado que ignora os meses que a grade não carregou.
      const [doMes, resumo] = await Promise.all([
        getExecucaoMes(anoSelecionado, mesSelecionado),
        getResumoPit(anoSelecionado, mesSelecionado),
      ]);
      if (disposed) return;

      const acumuladoPorMeta = new Map(
        (resumo || []).map(r => [String(r.meta_id), Number(r.realizado || 0)])
      );

      linhas = (doMes || []).map(m => ({
        ...m,
        // `id` para o data-table casar a linha, e `meta_id` continua sendo a
        // chave de negócio.
        id: m.meta_id,
        quantidade: m.quantidade == null ? null : Number(m.quantidade),
        realizado: acumuladoPorMeta.get(String(m.meta_id)) || 0,
      }));

      table.update({ rows: linhas, loading: false });
    } catch (err) {
      if (disposed) return;
      linhas = [];
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar a execução do PIT');
    }
  }

  await loadAnos();
  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
