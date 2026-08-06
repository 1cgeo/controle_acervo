import { el } from '@utils/dom.js';
import {
  getNaturezaDespesa, createNaturezaDespesa, updateNaturezaDespesa, deleteNaturezaDespesa,
  getPlanoInterno, createPlanoInterno, updatePlanoInterno, deletePlanoInterno,
  getUg, createUg, updateUg, deleteUg,
} from '@modules/orcamento/services/orcamento-service.js';
import { createDominioSection } from './dominio-section.js';

/**
 * Pagina de Configuracao geral (#/configuracao): a gestao dos dominios
 * editaveis do modulo (natureza de despesa, plano interno e UG emitente).
 *
 * SEM "Dados gerais". Ela tinha um formulario de UASG e CODOM, e a tabela que o
 * sustentava foi podada em 2026-08-06: as duas estavam preenchidas, corretas e
 * sem um unico leitor fora desta tela.
 *
 * SEM "Ano de referencia": um ano padrao do modulo faz salvar aqui trocar o
 * contexto de quem esta trabalhando. Cada tela tem o seu filtro de ano e comeca
 * no ano atual.
 *
 * E A ULTIMA DO MENU do modulo, desde 2026-08-06. Ela e a tela que menos se
 * visita, e so o administrador a abre; em cima, ocupava o lugar do trabalho do
 * dia, que e o DFD e o PDR.
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderConfiguracao(container) {
  let disposed = false;

  // SEM "Dados gerais". A tela tinha um formulario de UASG e CODOM, e a tabela
  // que o sustentava foi podada em 2026-08-06: as duas estavam preenchidas,
  // corretas e sem um unico leitor fora desta propria tela. Ver
  // migrations/2026-08-06_poda_configuracao_orcamento.sql.
  //
  // A PAGINA CONTINUA, e nao virou casca: o que ela faz de util e manter os tres
  // dominios do modulo, e isso nao mudou.

  // ---- Secoes de dominios editaveis ----
  // O `genero` acerta o participio das mensagens ("Plano interno excluido", e
  // nao "excluida"). Ele mora aqui, junto do `singular` com que concorda,
  // porque e fato do NOME de cada dominio, e nao do componente que os mostra.
  const naturezaSection = createDominioSection({
    title: 'Naturezas de despesa',
    singular: 'natureza de despesa',
    genero: 'f',
    novoLabel: 'Nova natureza',
    emptyMessage: 'Nenhuma natureza de despesa cadastrada',
    columns: [
      { key: 'code', label: 'Código', sortable: true },
      { key: 'nome', label: 'Nome', sortable: true },
      { key: 'gnd', label: 'GND', sortable: true, render: (row) => (row.gnd ?? '-') },
      { key: 'grupo', label: 'Grupo', render: (row) => row.grupo || '-' },
    ],
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true, maxLength: 6, isKey: true, placeholder: 'Ex.: 339030' },
      { key: 'nome', label: 'Nome', type: 'text', required: true, maxLength: 255 },
      {
        key: 'gnd', label: 'GND', type: 'select', required: true,
        helpText: 'O grupo (custeio/capital) é derivado do GND',
        options: [
          { value: 3, label: '3 - Custeio' },
          { value: 4, label: '4 - Capital' },
        ],
      },
    ],
    list: getNaturezaDespesa,
    create: createNaturezaDespesa,
    update: updateNaturezaDespesa,
    remove: deleteNaturezaDespesa,
  });

  const planoSection = createDominioSection({
    title: 'Planos internos',
    singular: 'plano interno',
    genero: 'm',
    novoLabel: 'Novo plano interno',
    emptyMessage: 'Nenhum plano interno cadastrado',
    columns: [
      { key: 'code', label: 'Código', sortable: true },
      { key: 'nome', label: 'Nome', sortable: true },
      { key: 'alinea', label: 'Alínea', render: (row) => row.alinea || '-' },
    ],
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true, maxLength: 20, isKey: true },
      { key: 'nome', label: 'Nome', type: 'text', required: true, maxLength: 255 },
      { key: 'alinea', label: 'Alínea', type: 'text', required: false, maxLength: 1, placeholder: 'Ex.: A' },
    ],
    list: getPlanoInterno,
    create: createPlanoInterno,
    update: updatePlanoInterno,
    remove: deletePlanoInterno,
  });

  const ugSection = createDominioSection({
    title: 'UG emitentes',
    singular: 'unidade gestora',
    genero: 'f',
    novoLabel: 'Nova UG',
    emptyMessage: 'Nenhuma UG cadastrada',
    columns: [
      { key: 'code', label: 'Código', sortable: true },
      { key: 'nome', label: 'Nome', sortable: true },
    ],
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true, maxLength: 10, isKey: true },
      { key: 'nome', label: 'Nome', type: 'text', required: true, maxLength: 255 },
    ],
    list: getUg,
    create: createUg,
    update: updateUg,
    remove: deleteUg,
  });

  // SEM PAINEL DE HISTORICO NO PE DA PAGINA. Ele existia, pedia a entidade
  // 'configuracao' com id 1, e ficou sem fonte quando a tabela foi podada em
  // 2026-08-06: o painel e de UM registro, e aquele registro sumiu.
  //
  // O rastro dos DOMINIOS nao passava por ali e continua inteiro: cada codigo
  // tem o seu, dentro da propria linha, montado pelo `dominio-section.js` com a
  // entidade 'dominio'. Mudar o nome ou o GND de uma natureza de despesa
  // reclassifica NC e NE ja lancadas, e e a mudanca de maior alcance que esta
  // tela permite.

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Configuração' }),
    ]),
    naturezaSection.element,
    planoSection.element,
    ugSection.element,
  ]);
  container.appendChild(page);

  // Carrega as tabelas dos dominios em paralelo.
  naturezaSection.load();
  planoSection.load();
  ugSection.load();

  return () => {
    disposed = true;
    naturezaSection.cleanup();
    planoSection.cleanup();
    ugSection.cleanup();
  };
}
