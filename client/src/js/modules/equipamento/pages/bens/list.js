import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError, showInfo } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import { permissoes } from '@store/auth-store.js';
import {
  getEquipamentos,
  deleteEquipamento,
  getDominio,
  getTipos,
  baixarRelatorioDmt,
} from '@modules/equipamento/services/equipamento-service.js';
import {
  SITUACAO,
  celulaPatrimonio,
  chipSituacao,
  classeDaLinha,
  textoVidaUtil,
} from '@modules/equipamento/situacao.js';
import { abrirBemDialog } from './bem-dialog.js';

/**
 * Lista de BENS (#/equipamento/bens).
 *
 * O FILTRO É DO SERVIDOR, e não da busca da tabela: `situacao_id`,
 * `secao_detentora_id`, `tipo_id` e `ativo` vão como query. A situação, em
 * particular, é DERIVADA por `equipamento.situacao_em(dia)` e não é coluna de
 * `equipamento.equipamento`: filtrar por ela no cliente exigiria trazer os 105
 * bens e refazer a conta aqui, que é onde as duas contas passam a divergir.
 *
 * A BUSCA DA TABELA CONTINUA, e é outra coisa: ela varre o que já está na tela
 * (patrimônio, modelo), e é como se acha um bem pelo número colado nele.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderBensList(container, _ctx) {
  let disposed = false;

  // O NUMERO DA REQUISICAO, que decide quem pinta.
  //
  // `disposed` so protege a SAIDA da pagina. Numa rede lenta, trocar o filtro
  // duas vezes dispara duas cargas, e quem PINTA e a que chegar por ultimo: a
  // resposta antiga pintava por cima da nova, com o seletor mostrando um recorte
  // e a tabela mostrando outro. Aqui so a ULTIMA pedida pinta, no acerto e no
  // erro.
  let requisicao = 0;
  const pode = permissoes('equipamento');

  // O que os diálogos precisam, carregado uma vez pela tela. Fica em variável
  // porque o diálogo é aberto depois, e não junto com a carga.
  let dominio = {};
  let tipos = [];

  const filtros = { situacao_id: null, secao_detentora_id: null, tipo_id: null, ativo: null };

  // Verdadeiro enquanto o filtro de carga na tela for o que a SITUAÇÃO escolheu,
  // e não a pessoa. É o que permite DESFAZER a troca automática ao sair de
  // `Baixado`: sem isso o `ativo = false` fica grudado e a situação seguinte
  // (`Indisponível`, por exemplo) devolve lista vazia pelo mesmo motivo, desta
  // vez SEM aviso nenhum.
  let cargaVeioDaSituacao = false;

  // ---- Filtros -------------------------------------------------------------
  const situacaoFilter = createSelectField({
    label: 'Situação',
    options: [],
    placeholder: 'Todas as situações',
    onChange: (v) => {
      filtros.situacao_id = v;
      // "BAIXADO" E "SOMENTE ATIVOS" NUNCA SE ENCONTRAM, e a tela nasce no
      // segundo. A situação `Baixado` é derivada de `ativo = false` (a função
      // `equipamento.situacao_em`, com a precedência mais alta), então pedir
      // Baixado dentro dos ativos devolve lista vazia SEMPRE, e a tabela
      // escrevia "Nenhum equipamento com esses filtros" como se fosse resposta
      // sobre o acervo. Aqui o filtro de carga acompanha, e o aviso diz que
      // acompanhou: o `<select>` ao lado muda à vista de quem clicou.
      if (Number(v) === SITUACAO.BAIXADO && filtros.ativo === 'true') {
        filtros.ativo = 'false';
        ativoFilter.setValue('false');
        cargaVeioDaSituacao = true;
        showInfo('Baixado é o bem fora de carga: o filtro de carga passou para "Somente baixados".');
      } else if (cargaVeioDaSituacao) {
        // A VOLTA: quem trocou a carga foi a tela, e não a pessoa. Sair de
        // `Baixado` desfaz a troca, senão `situacao_id=4 AND ativo=false` seria
        // o mesmo vazio garantido, num recorte que ninguém escolheu.
        filtros.ativo = 'true';
        ativoFilter.setValue('true');
        cargaVeioDaSituacao = false;
        showInfo('O filtro de carga voltou para "Somente ativos".');
      }
      carregar();
    },
  });

  const secaoFilter = createSelectField({
    label: 'Seção detentora',
    options: [],
    placeholder: 'Todas as seções',
    onChange: (v) => { filtros.secao_detentora_id = v; carregar(); },
  });

  const tipoFilter = createSelectField({
    label: 'Tipo',
    options: [],
    placeholder: 'Todos os tipos',
    onChange: (v) => { filtros.tipo_id = v; carregar(); },
  });

  // "Todos" INCLUI o baixado, e por isso o filtro nasce em "Ativos": a tela do
  // dia a dia é a do que está em carga, e o bem baixado só interessa a quem foi
  // procurá-lo. Trocar para "Todos" é um clique, e o rótulo diz o que muda.
  const ativoFilter = createSelectField({
    label: 'Situação de carga',
    placeholder: 'Todos',
    options: [
      { value: 'true', label: 'Somente ativos' },
      { value: 'false', label: 'Somente baixados' },
    ],
    value: 'true',
    // Dali em diante a carga é escolha da PESSOA, e a tela não a desfaz mais.
    onChange: (v) => { filtros.ativo = v; cargaVeioDaSituacao = false; carregar(); },
  });
  filtros.ativo = 'true';

  // ---- Tabela --------------------------------------------------------------
  const tabela = createDataTable({
    columns: [
      {
        key: 'nr_patrimonio',
        label: 'Patrimônio',
        sortable: true,
        // 15 dígitos conferidos contra a etiqueta colada no equipamento: com
        // largura proporcional os dígitos desalinham de uma linha para a outra,
        // e conferir vira contar com o dedo na tela.
        //
        // A célula MARCA o número por conferir (`patrimonio_pendente`). Sem a
        // marca, o número provisório se lê como qualquer outro, que é o defeito
        // que a coluna existe para impedir.
        render: (r) => celulaPatrimonio(r),
      },
      {
        key: 'tipo',
        label: 'Tipo',
        sortable: true,
        className: 'data-table__cell--truncate',
        render: (r) => r.tipo || '-',
      },
      {
        key: 'modelo',
        label: 'Modelo',
        sortable: true,
        className: 'data-table__cell--truncate',
        render: (r) => r.modelo || '-',
      },
      {
        key: 'secao_detentora',
        label: 'Seção',
        sortable: true,
        render: (r) => r.secao_detentora || '-',
      },
      {
        key: 'situacao',
        label: 'Situação',
        sortable: true,
        // Ordena pela PRECEDÊNCIA do domínio, que é a gravidade, e não pelo
        // nome: por texto, "Baixado" viria antes de "Disponível" e a coluna
        // ordenada não diria nada.
        sortValue: (r) => (r.situacao_id === null || r.situacao_id === undefined
          ? null
          : Number(r.situacao_id)),
        render: (r) => chipSituacao(r.situacao_id, r.situacao),
      },
      {
        key: 'vida_util_meses',
        label: 'Vida útil',
        sortable: true,
        sortValue: (r) => (r.vida_util_meses === null || r.vida_util_meses === undefined
          ? null
          : Number(r.vida_util_meses)),
        render: (r) => textoVidaUtil(r.vida_util_meses, r.vida_util_herdada),
      },
    ],
    rows: [],
    loading: true,
    searchable: true,
    pageSize: 25,
    rowClassName: classeDaLinha,
    emptyMessage: 'Nenhum equipamento com esses filtros',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Abrir a ficha',
        onClick: (r) => { location.hash = `/equipamento/bens/${r.id}`; },
      },
      ...(pode.gerente ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (r) => abrirBemDialog({ bem: r, dominio, tipos, onSaved: carregar }),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (r) => excluir(r),
      }] : []),
    ],
  });

  // A tabela vive num nó próprio para o estado de ERRO poder tomar o lugar dela
  // e devolvê-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [tabela.element]);

  // ---- Cabeçalho -----------------------------------------------------------
  const botaoNovo = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirBemDialog({ dominio, tipos, onSaved: carregar }),
  }, [svgIcon(ICONS.add, 16), 'Novo equipamento']);

  // O relatório DMT é a planilha que a Divisão manda para cima, e sai do mesmo
  // conjunto que esta tela mostra. O download tem o PRÓPRIO tratamento de erro:
  // ele não pode derrubar a lista, que é o que a pessoa veio ver.
  const botaoRelatorio = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: async () => {
      botaoRelatorio.disabled = true;
      try {
        await baixarRelatorioDmt();
      } catch (err) {
        showError(err.message || 'Erro ao gerar o relatório DMT');
      } finally {
        botaoRelatorio.disabled = false;
      }
    },
  }, [svgIcon(ICONS.download, 16), 'Relatório DMT']);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Equipamentos' }),
      el('div', { className: 'page__actions' }, [
        botaoRelatorio,
        ...(pode.gerente ? [botaoNovo] : []),
      ]),
    ]),
    el('div', { className: 'page__filters' }, [
      situacaoFilter.element,
      secaoFilter.element,
      tipoFilter.element,
      ativoFilter.element,
    ]),
    areaTabela,
  ]);
  container.appendChild(page);

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas faria a tabela escrever "Nenhum equipamento com esses
   * filtros": a falha da API leria-se como filtro sem resultado, e as duas
   * pedem ações opostas.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(tabela.element);
    mostrarErro(areaTabela, err, carregar);
  }

  /**
   * Exclusão do bem, que NÃO é dar baixa.
   *
   * Dar baixa é desmarcar "Ativo" na edição: o bem some do que está em carga e
   * o histórico dele continua lá. Excluir apaga a linha, e a confirmação diz
   * isso com todas as letras, porque as duas ações são vizinhas na mesma tabela.
   *
   * A confirmação NOMEIA o bem: numa lista de 105 linhas, "este equipamento"
   * não distingue qual delas some.
   */
  async function excluir(bem) {
    const identificacao = [bem.nr_patrimonio, bem.modelo].filter(Boolean).join(' - ');
    const ok = await confirmDialog({
      title: 'Excluir equipamento',
      message: `Excluir o equipamento "${identificacao}" e todo o histórico dele? `
        + 'Esta ação não pode ser desfeita. Para tirar o bem de carga sem perder o histórico, '
        + 'edite o registro e desmarque "Ativo".',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEquipamento(bem.id);
      showSuccess('Equipamento excluído com sucesso');
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o equipamento');
    }
  }

  // ---- Cargas --------------------------------------------------------------
  // OS DOMÍNIOS E OS TIPOS CARREGAM SEPARADO, cada um com o próprio `catch`.
  // Juntos num `Promise.all`, a falha de um deixaria os DOIS combos vazios, e a
  // mensagem que sobraria seria a de quem falhou. É a armadilha que derrubou
  // #/aproveitamento inteiro em 2026-08-08.
  async function carregarDominios() {
    try {
      dominio = (await getDominio()) || {};
      if (disposed) return;
      situacaoFilter.setOptions((dominio.situacao || []).map(s => ({ value: s.code, label: s.nome })));
      secaoFilter.setOptions((dominio.secao_detentora || []).map(s => ({ value: s.code, label: s.nome })));
    } catch (err) {
      if (disposed) return;
      showError(`${err.message || 'Erro ao carregar os domínios'}. Os filtros de situação e seção ficaram vazios.`);
    }
  }

  async function carregarTipos() {
    try {
      tipos = (await getTipos()) || [];
      if (disposed) return;
      tipoFilter.setOptions(tipos.map(t => ({ value: t.id, label: t.nome })));
    } catch (err) {
      if (disposed) return;
      showError(`${err.message || 'Erro ao carregar os tipos'}. O filtro de tipo ficou vazio.`);
    }
  }

  async function carregar() {
    const minha = ++requisicao;
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(tabela.element)) areaTabela.replaceChildren(tabela.element);

    tabela.update({ loading: true });
    try {
      const dados = await getEquipamentos({
        situacao_id: filtros.situacao_id ?? undefined,
        secao_detentora_id: filtros.secao_detentora_id ?? undefined,
        tipo_id: filtros.tipo_id ?? undefined,
        ativo: filtros.ativo ?? undefined,
      });
      if (disposed || minha !== requisicao) return;
      tabela.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed || minha !== requisicao) return;
      tabela.update({ loading: false });
      falhaNaCarga(err);
      showError(err.message || 'Erro ao carregar os equipamentos');
    }
  }

  await carregarDominios();
  await carregarTipos();
  await carregar();

  return () => {
    disposed = true;
    tabela._cleanup();
  };
}
