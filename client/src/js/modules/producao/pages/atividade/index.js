import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { showError, showInfo } from '@utils/toast.js';
import { chip } from '@components/status-chip.js';
import { mostrarErro } from '@components/estado-erro.js';
import { verificarAtividade, getTiposProblema, iniciarAtividade } from '@services/producao-service.js';
import {
  abrirFinalizarDialog, abrirProblemaDialog, abrirFinalizacaoIncorretaDialog,
} from './dialogos.js';
import './atividade.css';

/**
 * `dominio.tipo_dado_producao`: quanto o sistema manda no dado que a subfase
 * produz. O código 2 é o único em que ele concede e revoga permissão no banco de
 * produção a cada distribuição.
 */
const DADO_PRODUCAO = {
  1: 'Dado não controlado pelo SAP',
  2: 'Banco de dados PostGIS com controle de permissões',
  3: 'Banco de dados PostGIS',
};

/** O código 1 é o único que se trabalha fora de um banco de produção. */
const DADO_NAO_CONTROLADO = 1;

/** Um par rótulo/valor da ficha. Valor ausente vira travessão, e não some. */
function campo(rotulo, valor) {
  const texto = (valor === null || valor === undefined || valor === '') ? '—' : String(valor);
  return el('div', { className: 'producao-atividade__campo' }, [
    el('dt', { className: 'producao-atividade__rotulo', textContent: rotulo }),
    el('dd', { className: 'producao-atividade__valor', textContent: texto }),
  ]);
}

/** Um bloco de texto livre (observação), que só aparece quando existe. */
function observacao(rotulo, texto) {
  if (!texto) return null;
  return el('div', { className: 'producao-atividade__observacao' }, [
    el('div', { className: 'producao-atividade__rotulo', textContent: rotulo }),
    el('p', { className: 'producao-atividade__texto', textContent: texto }),
  ]);
}

/**
 * Uma seção da ficha: título e conteúdo, ou nada quando a lista está vazia.
 *
 * SEÇÃO VAZIA NÃO ENTRA NA TELA. O pacote de `/verifica` traz quinze listas, e a
 * maioria delas é configuração de QGIS que numa atividade típica vem vazia.
 * Desenhar quinze títulos com "nenhum" embaixo esconderia as três que têm
 * conteúdo.
 */
function secao(titulo, conteudo) {
  if (!conteudo) return null;
  return el('section', { className: 'producao-atividade__secao' }, [
    el('h2', { className: 'producao-atividade__secao-titulo', textContent: titulo }),
    conteudo,
  ]);
}

/** Lista simples de textos, ou null quando não há nenhum. */
function lista(itens, texto) {
  const filtrados = (itens || []).map(texto).filter(Boolean);
  if (!filtrados.length) return null;
  return el('ol', { className: 'producao-atividade__lista' },
    filtrados.map((t) => el('li', { textContent: t })));
}

/**
 * Tabela simples e estática, sem busca nem paginação.
 *
 * Os anexos da atividade (insumos, linhagem, versões da edição) são listas
 * curtas -- meia dúzia de linhas -- e o `data-table` completo, com barra de
 * busca e rodapé de paginação, pesaria mais do que o conteúdo.
 */
function tabelinha(colunas, linhas) {
  if (!linhas || !linhas.length) return null;
  return el('div', { className: 'data-table-scroll' }, [
    el('table', { className: 'data-table producao-atividade__tabela' }, [
      el('thead', {}, [
        el('tr', {}, colunas.map((c) => el('th', { textContent: c.label }))),
      ]),
      el('tbody', {}, linhas.map((linha) => el('tr', {},
        colunas.map((c) => el('td', { textContent: c.valor(linha) }))))),
    ]),
  ]);
}

/**
 * MINHA ATIVIDADE (#/producao/atividade): a única tela do módulo que escreve.
 *
 * ELA ESPELHA O PLUGIN SAP OPERADOR, e existe para quando o QGIS não está à
 * mão. Por isso ela mostra o pacote INTEIRO que `/verifica` devolve -- projeto,
 * lote, prazo, insumos, requisitos de finalização e a linhagem da área -- e não
 * só o nome da atividade, que era o único campo que o cliente React do SAP
 * 2.3.5 desenhava.
 *
 * AS DUAS CARGAS SÃO SEPARADAS, com o próprio `catch` cada uma. `/verifica` é o
 * conteúdo da tela; `/tipo_problema` é o catálogo do formulário de apontamento,
 * e só ele. Num `Promise.all`, a falha do catálogo apagaria a atividade da tela
 * -- exatamente o que derrubou `#/aproveitamento` em 2026-08-08. Aqui o pior que
 * acontece é o diálogo de problema nascer sem opções, e ele diz isso.
 *
 * O PERFIL DA ROTA É `operador`, e AS OITO ROTAS DE `/api/distribuicao` COBRAM
 * `operador` TAMBÉM -- inclusive `/verifica` e `/tipo_problema`, que só leem.
 * Quem tem apenas `consulta` em `producao` não chega a esta tela pelo menu, e se
 * chegar pela URL toma 403 do servidor, que é quem barra de verdade.
 *
 * O AVISO DO DADO CONTROLADO NÃO ESCONDE OS BOTÕES, e nisso divergimos do SAP.
 * Lá, atividade com `tipo_dado_producao_id !== 1` mostrava "Use o QGIS para
 * acessar atividade!" e sumia com as ações. Só que "reportar problema" é
 * justamente o que a pessoa precisa quando o QGIS não abre, e finalizar uma
 * atividade cujo trabalho já foi feito não deixa de ser legítimo por causa de
 * onde o dado mora. O aviso fica; a porta, não se tranca.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderAtividade(container, _ctx) {
  let disposed = false;
  let tiposProblema = [];

  const corpo = el('div', { className: 'producao-atividade__corpo' });

  const botaoAtualizar = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => carregar(),
  }, [svgIcon(ICONS.schedule, 16), 'Atualizar']);

  const botaoIncorreta = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => abrirFinalizacaoIncorretaDialog({ onReportado: () => carregar() }),
  }, [svgIcon(ICONS.warning, 16), 'Finalizei sem querer']);

  const page = el('div', { className: 'page producao-atividade' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Minha atividade' }),
      el('div', { className: 'page__actions' }, [botaoIncorreta, botaoAtualizar]),
    ]),
    corpo,
  ]);
  container.appendChild(page);

  // --- Ações ----------------------------------------------------------------

  async function iniciar(botao) {
    botao.disabled = true;
    try {
      await iniciarAtividade();
      if (disposed) return;
      showInfo('Atividade iniciada');
    } catch (err) {
      if (disposed) return;
      // OS DOIS 400 DE `/inicia` SÃO RECADO, e não tela quebrada: "sem
      // atividades disponíveis para iniciar" (que o servidor manda com
      // `success: true`, contrato do SAP) e "o usuário já possui atividade em
      // andamento". O envelope não sobrevive ao `throw` do api-client, e
      // distingui-los aqui exigiria casar o TEXTO da mensagem -- que muda no dia
      // em que alguém melhorar a frase. Os dois saem como AVISO, com a frase do
      // servidor, e a tela recarrega logo abaixo: no segundo caso é isso mesmo
      // que conserta a tela.
      if (err.status === 400) showInfo(err.message || 'Sem atividades disponíveis para iniciar');
      else showError(err.message || 'Não foi possível iniciar a atividade');
    } finally {
      if (!disposed) botao.disabled = false;
    }
    if (!disposed) await carregar();
  }

  // --- Pintura --------------------------------------------------------------

  /** A tela de quem está sem atividade aberta. */
  function pintarSemAtividade() {
    const botao = el('button', {
      className: 'btn btn--primary',
      type: 'button',
      onClick: () => iniciar(botao),
    }, [svgIcon(ICONS.add, 16), 'Iniciar próxima atividade']);

    corpo.replaceChildren(el('div', { className: 'producao-atividade__vazio' }, [
      el('span', { className: 'producao-atividade__vazio-icone' }, [svgIcon(ICONS.assignment, 40)]),
      el('h2', {
        className: 'producao-atividade__vazio-titulo',
        textContent: 'Você não tem atividade em execução',
      }),
      el('p', {
        className: 'producao-atividade__vazio-texto',
        textContent: 'Quem escolhe a próxima é a fila do servidor, pela prioridade do lote, do '
          + 'bloco e da sua habilitação. Pode não haver nenhuma disponível agora.',
      }),
      botao,
    ]));
  }

  /** A ficha da atividade em execução. */
  function pintarAtividade(pacote) {
    const a = pacote.atividade || {};
    const controlado = Number(a.dado_producao && a.dado_producao.tipo_dado_producao_id);

    const acoes = el('div', { className: 'producao-atividade__acoes' }, [
      el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => abrirProblemaDialog({
          atividade: a,
          tipos: tiposProblema,
          onReportado: () => carregar(),
        }),
      }, [svgIcon(ICONS.warning, 16), 'Reportar problema']),
      el('button', {
        className: 'btn btn--primary',
        type: 'button',
        onClick: () => abrirFinalizarDialog({ atividade: a, onFinalizado: () => carregar() }),
      }, [svgIcon(ICONS.checkCircle, 16), 'Finalizar atividade']),
    ]);

    const avisoQgis = (controlado && controlado !== DADO_NAO_CONTROLADO)
      ? el('p', { className: 'producao-atividade__aviso', role: 'note' }, [
        svgIcon(ICONS.info, 18),
        el('span', {
          textContent: `O dado desta atividade é ${DADO_PRODUCAO[controlado]}. O trabalho se faz `
            + 'no QGIS, pelo plugin SAP Operador; esta tela serve para acompanhar, apontar problema '
            + 'e fechar a atividade.',
        }),
      ])
      : null;

    const ficha = el('div', { className: 'producao-atividade__ficha' }, [
      el('div', { className: 'producao-atividade__cabecalho' }, [
        el('h2', { className: 'producao-atividade__nome', textContent: a.nome || 'Atividade' }),
        el('div', { className: 'producao-atividade__chips' }, [
          chip(a.projeto || 'Sem projeto', 'primary'),
          chip(a.lote || 'Sem lote', 'info'),
          a.bloco ? chip(a.bloco, 'default') : null,
        ].filter(Boolean)),
      ]),
      avisoQgis,
      el('dl', { className: 'producao-atividade__campos' }, [
        campo('Projeto', a.projeto),
        campo('Lote', a.lote),
        campo('Bloco', a.bloco),
        campo('Subtipo de produto', a.subtipo_produto),
        campo('Unidade de trabalho', a.unidade_trabalho_id ? `#${a.unidade_trabalho_id}` : null),
        campo('Dificuldade', a.dificuldade === null || a.dificuldade === undefined
          ? null : formatNumber(a.dificuldade)),
        campo('Tempo estimado', a.tempo_estimado_minutos
          ? `${formatNumber(a.tempo_estimado_minutos)} min`
          : null),
        campo('EPSG de edição', a.epsg),
        campo('Dado de produção', DADO_PRODUCAO[controlado] || null),
      ]),
      observacao('Observação da atividade', a.observacao_atividade),
      observacao('Observação da unidade de trabalho', a.observacao_unidade_trabalho),
      secao('Requisitos de finalização', lista(a.requisitos, (r) => r.descricao)),
      secao('Insumos', tabelinha([
        { label: 'Insumo', valor: (i) => i.nome || '-' },
        { label: 'Caminho', valor: (i) => i.caminho || '-' },
        { label: 'EPSG', valor: (i) => (i.epsg === null || i.epsg === undefined ? '-' : String(i.epsg)) },
      ], a.insumos)),
      secao('Linhagem desta área', tabelinha([
        { label: 'Fase', valor: (l) => l.fase || '-' },
        { label: 'Subfase', valor: (l) => l.subfase || '-' },
        { label: 'Etapa', valor: (l) => l.etapa || '-' },
        { label: 'Situação', valor: (l) => l.situacao || '-' },
        // O NOME DE QUEM EXECUTOU SÓ VEM EM DOIS CASOS, e quem decide é o
        // `perfil_linhagem` do servidor: exibição 3 (sempre) ou exibição 2
        // (somente revisores) quando quem pede é revisor. Fora deles a coluna
        // simplesmente não existe na resposta, e a célula fica vazia.
        {
          label: 'Executou',
          valor: (l) => [l.posto_grad, l.nome_guerra].filter(Boolean).join(' ') || '-',
        },
        { label: 'Início', valor: (l) => l.data_inicio || '-' },
        { label: 'Fim', valor: (l) => l.data_fim || '-' },
      ], a.linhagem)),
      // O METADADO DE EDIÇÃO É SÓ LEITURA AQUI, e a limitação é declarada.
      // `/verifica` só o traz na fase de EDIÇÃO, e editá-lo exige o catálogo de
      // tipo de palavra-chave, que mora nas rotas de metadado -- outro assunto,
      // outra guarda. Quem redige o topônimo o faz pelo plugin, que é onde o
      // `POST /distribuicao/metadados_edicao` é chamado.
      secao('Metadado de edição', tabelinha([
        { label: 'Produto', valor: (v) => v.mi || v.inom || '-' },
        { label: 'Nome', valor: (v) => v.nome_produto || '-' },
        { label: 'Versão', valor: (v) => v.versao || '-' },
        {
          label: 'Palavras-chave',
          valor: (v) => (v.palavras_chave || []).map((p) => p.nome).join(', ') || '-',
        },
      ], a.metadado_edicao)),
      acoes,
    ].filter(Boolean));

    corpo.replaceChildren(ficha);
  }

  // --- Carga ----------------------------------------------------------------

  /**
   * O catálogo do formulário de apontamento, SOZINHO.
   *
   * A falha aqui não pode apagar a atividade da tela: sem ele, o diálogo de
   * problema nasce sem opções e diz isso, e todo o resto continua funcionando.
   */
  async function carregarTipos() {
    try {
      const dados = await getTiposProblema();
      if (!disposed) tiposProblema = Array.isArray(dados) ? dados : [];
    } catch {
      tiposProblema = [];
    }
  }

  function pintarCarregando() {
    corpo.replaceChildren(el('div', { className: 'producao-atividade__carregando' }, [
      el('div', { className: 'spinner' }),
    ]));
  }

  async function carregar() {
    pintarCarregando();
    let pacote;
    try {
      pacote = await verificarAtividade();
    } catch (err) {
      if (disposed) return;
      // O ESTADO DE ERRO TOMA O CORPO, e o "Tentar de novo" dele devolve o que
      // estava antes e rechama esta função. Como `carregar` sempre repinta o
      // corpo do zero, não há retrato velho para conflitar.
      mostrarErro(corpo, err, carregar);
      return;
    }
    if (disposed) return;

    // `null` É A RESPOSTA CERTA de quem acabou de fechar a anterior, e não uma
    // falha: o servidor manda 200 com `dados` nulo. Tratá-la como erro faria a
    // tela pedir "tentar de novo" para quem só precisa de um botão de iniciar.
    if (!pacote || !pacote.atividade) pintarSemAtividade();
    else pintarAtividade(pacote);
  }

  // As duas viajam juntas, e cada uma já resolve o próprio erro por dentro:
  // nenhuma delas rejeita, então este `all` nunca derruba a outra.
  await Promise.all([carregar(), carregarTipos()]);

  return () => {
    disposed = true;
  };
}
