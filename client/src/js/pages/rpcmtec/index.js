import { el, svgIcon, ICONS } from '@utils/dom.js';
import { monthName, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import {
  getRpcmtec,
  downloadRpcmtecDocx,
  getAnuario,
  downloadAnuarioOds,
} from '@services/rpcmtec-service.js';

// No Anuario, celula NULA quer dizer "o SCA nao tem essa fonte" e ZERO quer
// dizer "nao houve entrega". Um `?? 0` apagaria a diferenca, que e justamente a
// que as lacunas declaram.
const numOuTraco = (key) => (row) => (row[key] == null ? '-' : formatNumber(row[key]));

// As 8 colunas da Tabela 5.4.9, na ordem do arquivo que sobe para a DSG.
const COLUNAS_ANUARIO = [
  { key: 'rotulo', label: 'Suprimento de cartografia', render: (r) => r.rotulo ?? '-' },
  { key: 'exercito', label: 'Exército', render: numOuTraco('exercito') },
  { key: 'rm', label: 'RM', render: numOuTraco('rm') },
  { key: 'ee_exercito', label: 'EE do Exército', render: numOuTraco('ee_exercito') },
  { key: 'outras_forcas', label: 'Outras Forças', render: numOuTraco('outras_forcas') },
  { key: 'orgao_publico', label: 'Órgão Público', render: numOuTraco('orgao_publico') },
  { key: 'empresa_privada', label: 'Empresa Privada', render: numOuTraco('empresa_privada') },
  { key: 'prof_autonomo', label: 'Prof. Autônomo', render: numOuTraco('prof_autonomo') },
];

/**
 * RPCMTec (#/rpcmtec): o relatorio mensal da Divisao, inteiro, numa tela so.
 *
 * TELA DE PLATAFORMA, como a de usuarios e a de metas do PIT. Ate 2026-08-01 ela
 * eram DUAS, uma dentro da mapoteca (#/mapoteca/rpcmtec, com acervo e mapoteca) e
 * outra dentro do orcamento (#/orcamento/relatorio, com o PDR), cada uma gerando
 * um DOCX proprio com numeracao propria. Quem montava a edicao mensal abria os
 * dois arquivos e colava um no outro, no Word, todo mes.
 *
 * O QUE ELA MOSTRA e exatamente o que vai para o arquivo: as secoes chegam do
 * servidor ja com as celulas em texto, e esta tela so as desenha. Nao ha
 * formatacao aqui de proposito -- com a tela arredondando por conta, ela e o
 * DOCX divergiam e quem conferia via diferenca onde nao havia.
 *
 * O ANO tem seletor PROPRIO, e nao o da navbar: aquele e contexto de MODULO
 * (`@sca-mapoteca-ano`, `@sca-orcamento-ano`) e nao existe fora deles. O mes
 * tambem e daqui, porque o RPCMTec e sempre de um mes especifico.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderRpcmtec(container, _ctx) {
  let disposed = false;
  // Uma tabela por subsecao, indexada pelo numero ('2.2'). Elas sao criadas na
  // PRIMEIRA geracao, e nao aqui: quais subsecoes existem e o servidor que diz.
  const tabelas = new Map();

  const hoje = new Date();
  const anoCorrente = hoje.getFullYear();

  const mesSelect = el('select', {
    className: 'form-field__select',
    id: 'rpcmtec-mes',
    'aria-label': 'Selecionar mês',
    onChange: () => gerar(),
  }, Array.from({ length: 12 }, (_, i) => el('option', {
    value: String(i + 1),
    textContent: monthName(i + 1),
  })));
  mesSelect.value = String(hoje.getMonth() + 1);

  // Do ano corrente para tras. Cinco anos cobrem o que se reabre na pratica; a
  // edicao mais antiga que alguem gera de novo e a do exercicio anterior.
  const anoSelect = el('select', {
    className: 'form-field__select',
    id: 'rpcmtec-ano',
    'aria-label': 'Selecionar ano',
    onChange: () => gerar(),
  }, Array.from({ length: 5 }, (_, i) => el('option', {
    value: String(anoCorrente - i),
    textContent: String(anoCorrente - i),
  })));
  anoSelect.value = String(anoCorrente);

  const baixarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => baixar(),
  }, [svgIcon(ICONS.print, 16), 'Baixar DOCX']);

  // O Anuario sobe para a DSG no MESMO envio mensal que o RPCMTec, e por isso
  // sai da mesma tela e do mesmo mes: e uma tarefa so.
  const anuarioBtn = el('button', {
    className: 'btn',
    type: 'button',
    onClick: () => baixarAnuario(),
  }, [svgIcon(ICONS.print, 16), 'Baixar Anuário (ODS)']);

  const toolbar = el('div', { className: 'rpcm-toolbar' }, [
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('label', { className: 'rpcm-toolbar__label', for: 'rpcmtec-mes', textContent: 'Mês' }),
      mesSelect,
    ]),
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('label', { className: 'rpcm-toolbar__label', for: 'rpcmtec-ano', textContent: 'Ano' }),
      anoSelect,
    ]),
    el('div', { className: 'rpcm-toolbar__spacer' }),
    anuarioBtn,
    baixarBtn,
  ]);

  const anuarioTable = createDataTable({
    columns: COLUNAS_ANUARIO,
    rows: [],
    pageSize: 40,
    emptyMessage: 'Sem entregas no mês',
  });

  // As lacunas que o proprio Anuario declara. Ficam a vista, e nao so no rodape
  // do arquivo: quem confere o numero precisa saber onde ele nao existe.
  const anuarioLacunas = el('ul', { className: 'dashboard-section__nota' });

  const blocoAnuario = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h3', {
        className: 'dashboard-section__title',
        textContent: 'Anuário Estatístico - Tabela 5.4.9 (sobe para a DSG)',
      }),
    ]),
    el('p', {
      className: 'dashboard-section__nota',
      textContent: 'O arquivo sai da planilha-semente da DSG com os valores trocados: estilo, largura de coluna e rodapé são os do original, e nada precisa ser reformatado.',
    }),
    anuarioTable.element,
    anuarioLacunas,
  ]);

  // As subsecoes que o SCA NAO preenche, ditas na tela e nao so no codigo: quem
  // monta a edicao precisa saber o que ainda tem de escrever a mao, e descobrir
  // isso comparando o arquivo gerado com o modelo e trabalho perdido.
  const lacunas = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', {
        className: 'dashboard-section__title',
        textContent: 'O que o SCA não preenche, e continua sendo escrito à mão',
      }),
    ]),
    el('ul', { className: 'dashboard-section__nota' }, [
      el('li', { textContent: '1. Finalidade, 9. Boas práticas, lições aprendidas e oportunidades de melhoria: texto do chefe.' }),
      el('li', { textContent: '2.1. Estado Atual do PIT: as metas não têm quantidade prevista nem previsão de término, e nenhuma versão do acervo aponta para uma meta.' }),
      el('li', { textContent: '2.3. Execução por Lote de Produção: o SCA conta os produtos do lote, mas não tem operador nem percentual concluído.' }),
      el('li', { textContent: '2.5. Atividades de campo e 2.6. Capacitações externas: não há cadastro delas no SCA.' }),
      el('li', { textContent: '5. Desenvolvimento e TI: vem do painel do GitHub e do controle de backup.' }),
      el('li', { textContent: '6. Recursos Humanos: o efetivo vem do Auth Server, sem as atividades de cada um.' }),
      el('li', { textContent: '7.1. Equipamento Técnico Indisponível: não há cadastro de equipamento.' }),
      el('li', { textContent: '8. Divulgação das atividades: não há cadastro de publicação em BI.' }),
      el('li', { textContent: 'Nas 7.2 e 7.3, as colunas "Estoque mês anterior" e "Previsão de falta de estoque" saem "-": o estoque guarda só o saldo de hoje, sem histórico mensal.' }),
    ]),
  ]);

  const secoesArea = el('div');

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header page__header--column' }, [
      el('h1', { className: 'page__title', textContent: 'RPCMTec' }),
      el('p', {
        className: 'page__subtitle',
        textContent: 'Relatório de Prestação de Contas Mensal Técnico. Acervo, mapoteca e orçamento numa geração só, na numeração e no formato do documento da Divisão.',
      }),
      toolbar,
    ]),
    secoesArea,
    el('h2', { className: 'page__section-title', textContent: 'ANUÁRIO ESTATÍSTICO' }),
    blocoAnuario,
    lacunas,
  ]);
  container.appendChild(page);

  /** Desenha a estrutura (uma tabela por subsecao) a partir do que o servidor mandou. */
  function montarEstrutura(secoes) {
    for (const tabela of tabelas.values()) tabela._cleanup();
    tabelas.clear();
    secoesArea.replaceChildren();

    for (const secao of secoes) {
      secoesArea.appendChild(el('h2', {
        className: 'page__section-title',
        textContent: secao.titulo,
      }));

      for (const sub of secao.subsecoes) {
        // As colunas viram c0, c1, ... porque a celula chega POSICIONAL (uma
        // lista por linha), do mesmo jeito que o DOCX a desenha. Dar nome de
        // campo a cada uma exigiria um contrato por subsecao, duplicado entre
        // servidor e tela, e e exatamente esse contrato duplicado que deixava as
        // duas telas antigas divergirem do arquivo.
        const columns = sub.cabecalhos.map((label, i) => ({
          key: `c${i}`,
          label,
          render: (row) => row[`c${i}`] ?? '-',
        }));

        const tabela = createDataTable({
          columns,
          rows: [],
          pageSize: 25,
          emptyMessage: 'Sem dados no período',
        });
        tabelas.set(sub.numero, tabela);

        secoesArea.appendChild(el('div', { className: 'dashboard-section' }, [
          el('div', { className: 'dashboard-section__header' }, [
            el('h3', {
              className: 'dashboard-section__title',
              textContent: `${sub.numero}. ${sub.titulo}`,
            }),
          ]),
          tabela.element,
        ]));
      }
    }
  }

  function preencher(secoes) {
    for (const secao of secoes) {
      for (const sub of secao.subsecoes) {
        const tabela = tabelas.get(sub.numero);
        if (!tabela) continue;
        const rows = sub.linhas.map((celulas) =>
          Object.fromEntries(celulas.map((valor, i) => [`c${i}`, valor])));
        tabela.update({ rows, loading: false });
      }
    }
  }

  function getParams() {
    return {
      ano: parseInt(anoSelect.value, 10),
      mes: parseInt(mesSelect.value, 10),
    };
  }

  async function gerar() {
    for (const tabela of tabelas.values()) tabela.update({ loading: true });
    try {
      const dados = await getRpcmtec(getParams());
      if (disposed) return;
      // A estrutura e remontada a cada geracao porque o servidor pode mudar o
      // conjunto de subsecoes (uma subsecao nova entra sem tocar nesta tela).
      montarEstrutura(dados.secoes);
      preencher(dados.secoes);
    } catch (err) {
      if (disposed) return;
      for (const tabela of tabelas.values()) tabela.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao gerar o RPCMTec');
    }
    await gerarAnuario();
  }

  // Chamada A PARTE da do RPCMTec: e outro relatorio, com outra rota, e uma
  // falha nele nao pode apagar as tabelas do RPCMTec que ja carregaram.
  async function gerarAnuario() {
    anuarioTable.update({ loading: true });
    try {
      const a = await getAnuario(getParams());
      if (disposed) return;
      anuarioTable.update({
        // A linha de TOTAL abre cada bloco: e a ordem do arquivo que a DSG
        // recebe, e conferir linha a linha contra ele e o que se faz com isto.
        rows: [a.total_convencional, ...a.convencional, a.total_digital, ...a.digital],
        loading: false,
      });
      anuarioLacunas.replaceChildren(
        ...(a.lacunas || []).map((l) => el('li', { textContent: l })),
      );
    } catch (err) {
      if (disposed) return;
      anuarioTable.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao gerar o Anuário Estatístico');
    }
  }

  async function baixarAnuario() {
    anuarioBtn.disabled = true;
    try {
      await downloadAnuarioOds(getParams());
    } catch (err) {
      showError(err.message || 'Erro ao baixar o Anuário');
    } finally {
      anuarioBtn.disabled = false;
    }
  }

  async function baixar() {
    baixarBtn.disabled = true;
    try {
      await downloadRpcmtecDocx(getParams());
    } catch (err) {
      showError(err.message || 'Erro ao baixar o DOCX');
    } finally {
      baixarBtn.disabled = false;
    }
  }

  await gerar();

  return () => {
    disposed = true;
    for (const tabela of tabelas.values()) tabela._cleanup();
    tabelas.clear();
    anuarioTable._cleanup();
  };
}
