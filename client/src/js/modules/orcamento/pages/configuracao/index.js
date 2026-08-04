import { el } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createTextField, createNumberField } from '@components/form-fields/form-fields.js';
import { criarHistorico } from '@components/historico/historico.js';
import { formatDateTime } from '@utils/format.js';
import {
  getConfig, updateConfig,
  getNaturezaDespesa, createNaturezaDespesa, updateNaturezaDespesa, deleteNaturezaDespesa,
  getPlanoInterno, createPlanoInterno, updatePlanoInterno, deletePlanoInterno,
  getUg, createUg, updateUg, deleteUg,
} from '@modules/orcamento/services/orcamento-service.js';
import { setAno } from '@modules/orcamento/store/year-store.js';
import { createDominioSection } from './dominio-section.js';

/**
 * Pagina de Configuracao geral (#/configuracao): UASG, CODOM e o ano de
 * referencia padrao das telas, mais a gestao dos dominios editaveis (natureza
 * de despesa, plano interno e UG emitente).
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderConfiguracao(container) {
  let disposed = false;

  // ---- Dados gerais (UASG, CODOM, ano de referencia) ----
  const uasg = createTextField({ label: 'UASG', maxLength: 10, helpText: 'Unidade Administrativa de Serviços Gerais (ex.: 160382)' });
  const codom = createTextField({ label: 'CODOM', maxLength: 10 });
  const anoRef = createNumberField({ label: 'Ano de referência', min: 2000, max: 2100, helpText: 'Ano padrão ao abrir o sistema' });

  const saveBtn = el('button', { className: 'btn btn--primary', type: 'submit', textContent: 'Salvar' });

  // Quem alterou por ultimo. A rota ja devolvia a data e o UUID, e a pagina
  // descartava os dois: numa tela que qualquer perfil `consulta` abre, e que
  // muda o ano de referencia de todo o modulo, "quem mexeu nisto" e a pergunta
  // seguinte. Fica vazio enquanto a linha nunca foi salva.
  const alteradoEm = el('p', { className: 'page__subtitle', hidden: true });

  function pintarAlteracao(cfg) {
    if (!cfg || !cfg.data_modificacao) {
      alteradoEm.hidden = true;
      return;
    }
    const autor = cfg.usuario_modificacao || 'autor não identificado';
    alteradoEm.textContent = `Alterado em ${formatDateTime(cfg.data_modificacao)} por ${autor}`;
    alteradoEm.hidden = false;
  }

  const form = el('form', { className: 'form-grid', style: { maxWidth: '480px' } }, [
    uasg.element,
    codom.element,
    anoRef.element,
    el('div', { className: 'page__actions' }, [saveBtn]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    try {
      const body = {
        uasg: uasg.getValue() || null,
        codom: codom.getValue() || null,
        ano_referencia: anoRef.getValue(),
      };
      const dados = await updateConfig(body);
      showSuccess('Configuração salva com sucesso');
      if (dados && dados.ano_referencia) setAno(dados.ano_referencia);
      // O PUT devolve so os tres campos de negocio, sem o carimbo de
      // escrituracao. A releitura traz a data e o autor recem-gravados, e o
      // historico ganha a linha da alteracao que acabou de acontecer.
      recarregarCarimbo();
      historico.recarregar();
    } catch (err) {
      showError(err.message || 'Erro ao salvar configuração');
    } finally {
      saveBtn.disabled = false;
    }
  });

  async function recarregarCarimbo() {
    try {
      const cfg = await getConfig();
      if (disposed) return;
      pintarAlteracao(cfg);
    } catch (err) {
      // Falhar aqui nao desfaz o que ja foi salvo: o carimbo e acessorio.
    }
  }

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

  // O rastro da tela de MAIOR ALCANCE do modulo. Mudar o ano de referencia
  // troca o contexto de todas as telas, e mudar o nome ou o GND de uma ND
  // reclassifica NC e NE ja lancadas. O servidor registra as duas escritas
  // desde 2026-08-02, e ate aqui nenhuma tela mostrava o registro.
  const historico = criarHistorico({
    modulo: 'orcamento',
    entidade: 'configuracao',
    id: 1,
    titulo: 'Histórico da configuração',
    subtitulo: 'Quem mudou a UASG, o CODOM ou o ano de referência',
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Configuração' }),
    ]),
    form,
    alteradoEm,
    el('hr', { className: 'config-divider' }),
    naturezaSection.element,
    planoSection.element,
    ugSection.element,
    el('hr', { className: 'config-divider' }),
    historico.element,
  ]);
  container.appendChild(page);

  try {
    const cfg = await getConfig();
    if (disposed) return;
    uasg.setValue(cfg.uasg || '');
    codom.setValue(cfg.codom || '');
    anoRef.setValue(cfg.ano_referencia);
    pintarAlteracao(cfg);
  } catch (err) {
    if (!disposed) showError(err.message || 'Erro ao carregar configuração');
  }

  // Carrega as tabelas dos dominios em paralelo.
  naturezaSection.load();
  planoSection.load();
  ugSection.load();

  return () => {
    disposed = true;
    naturezaSection.cleanup();
    planoSection.cleanup();
    ugSection.cleanup();
    historico.cleanup();
  };
}
