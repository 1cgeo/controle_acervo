// Manifesto do modulo PRODUCAO. O contrato do manifesto esta em
// modules/registry.js.
//
// O `id` casa com `dominio.modulo.nome_abrev` do servidor (code 7), e e a MESMA
// string que o `verifyPerfil(nivel, 'producao')` de cada rota compara por
// igualdade, que os prefixos '/api/producao', '/api/gerencia_producao',
// '/api/distribuicao', '/api/acompanhamento', '/api/metadados' e '/api/perigo'
// cobram, e que a chave do mapa `perfis` do POST /api/login carrega. Trocar essa
// string derruba a autorizacao sem erro de sintaxe e sem teste vermelho.
//
// ONZE TELAS, UMA POR TELA DO SAP 2.3.5, e essa contagem e decisao do chefe de
// 2026-08-09. Houve uma proposta de juntar as dez de acompanhamento em seis, e
// ela foi recusada: quem trabalha no SAP procura pelo nome que conhece, e
// fundir telas obriga a reaprender onde cada resposta mora.
//
// AS OUTRAS SETE TELAS DO SAP NAO ESTAO AQUI porque ja existem neste sistema, e
// nao se duplicam: Campos e Gerencia de Campos sao as duas abas de '#/campo';
// Capacitacoes sao '#/capacitacao_ministrada' e '#/capacitacao_recebida';
// Extra-PIT e '#/extra_pit'; Efetivo e '#/aproveitamento'; PIT (nao-producao) e
// '#/metas' mais '#/execucao_pit'; e RPCMTec e '#/rpcmtec'.
//
// O PERFIL DESTE MODULO NAO E HIERARQUICO, e essa e a coisa mais importante a
// saber antes de mexer aqui (chefe, 2026-08-09).
//
//   consulta  VE TUDO, e nao modifica nada
//   operador  ve DUAS telas: o Dashboard e a propria atividade
//   gerente   ve tudo e mexe em tudo
//
// O VISUALIZADOR NAO E UM OPERADOR REBAIXADO. Ele e quem acompanha a producao de
// cima -- a chefia, a secao, quem responde por prazo -- e por isso alcanca TODAS
// as telas de leitura. O operador e o contrario: ele EXECUTA, e o que lhe serve e
// a fila dele e o quadro geral. Encher a barra lateral dele com onze telas de
// acompanhamento e ruido sobre quem esta no meio de uma carta.
//
// POR ISSO AS ROTAS DECLARAM `perfis` (LISTA) E NAO `perfil` (MINIMO). O `perfil`
// e hierarquico (`temPerfil` compara `>=`), e com ele o operador veria tudo o que
// a consulta ve, por ser um nivel acima -- que e exatamente o contrario do que
// foi pedido. A lista e lida por `ehDeAlgumPerfil`, e ha precedente igual no
// sistema: o Aproveitamento do efetivo, em `#/aproveitamento`, que tambem exclui
// o operador de proposito.
//
// O SERVIDOR NAO COBRA ESSE RECORTE, e nao e esquecimento: `verifyPerfil(minimo,
// modulo)` so sabe comparar NIVEL, entao a rota de leitura fica em `consulta` e o
// operador, sendo um nivel acima, tambem passa por ela. O recorte de LEITURA e do
// client, como o `CLAUDE.md` diz ("perfil de rota no client e so ergonomia"), e
// nao ha o que proteger: sao as mesmas telas que o visualizador ja abre. O que o
// servidor barra de verdade e a ESCRITA, e essa continua em `verifyPerfil`.
//
// A TELA "MINHA ATIVIDADE" E A UNICA QUE ESCREVE. Ela espelha o que o plugin SAP
// Operador faz no QGIS, e existe para quando o QGIS nao esta a mao. O
// VISUALIZADOR NAO A VE: ele nao tem atividade para executar, e a tela abriria
// vazia com todos os botoes em 403.
//
// A TELA "MICROCONTROLE" E A UNICA DE GERENTE, e o motivo nao e costume: as onze
// rotas de `/api/microcontrole` que ela consome sao todas `gerente` no servidor.
// Mostra-la em `consulta` daria uma tela que responde 403 em cada secao.

import { ICONS } from '@utils/dom.js';

import { renderProducaoDashboard } from './pages/dashboard/index.js';
import { renderAtividade } from './pages/atividade/index.js';
import { renderGrade } from './pages/grade/index.js';
import { renderAtividadeSubfase } from './pages/atividade-subfase/index.js';
import { renderAtividadeUsuario } from './pages/atividade-usuario/index.js';
import { renderLoteAcompanhamento } from './pages/lote/index.js';
import { renderSituacaoSubfase } from './pages/situacao-subfase/index.js';
import { renderPitProducao } from './pages/pit/index.js';
import { renderAtividades } from './pages/atividades/index.js';
import { renderMicrocontrole } from './pages/microcontrole/index.js';
import { renderMapas } from './pages/mapas/index.js';

export default {
  id: 'producao',
  icon: ICONS.layers,

  // A HOME NAO PODE SER STRING VAZIA: `registry.rotaInicial` faz
  // `mod.home || '/dashboard'`, e o vazio, sendo falso, cairia numa rota que nao
  // existe. '/' resolve para a rota de caminho '' registrada abaixo.
  home: '/',

  // MENU PLANO, sem grupo aninhado, como os outros modulos. A ORDEM E A DO
  // TRABALHO, e nao a alfabetica: o painel abre, a propria atividade e o que o
  // operador usa todo dia, e o acompanhamento vem depois, do mais grosso (grade)
  // ao mais fino (situacao por subfase).
  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '' },
    { id: 'atividade', label: 'Minha atividade', icon: ICONS.assignment, path: '/atividade' },
    { id: 'grade', label: 'Grade', icon: ICONS.category, path: '/grade' },
    { id: 'lote', label: 'Acompanhamento do lote', icon: ICONS.layers, path: '/lote' },
    { id: 'atividade-subfase', label: 'Atividade por subfase', icon: ICONS.dataUsage, path: '/atividade_subfase' },
    { id: 'atividade-usuario', label: 'Atividades por usuário', icon: ICONS.people, path: '/atividade_usuario' },
    { id: 'situacao-subfase', label: 'Situação da subfase', icon: ICONS.description, path: '/situacao_subfase' },
    { id: 'atividades', label: 'Atividades', icon: ICONS.assignment, path: '/atividades' },
    { id: 'pit', label: 'PIT da produção', icon: ICONS.dataUsage, path: '/pit' },
    { id: 'mapas', label: 'Mapas', icon: ICONS.layers, path: '/mapas' },
    { id: 'microcontrole', label: 'Microcontrole', icon: ICONS.dataUsage, path: '/microcontrole' },
  ],

  // TODA ROTA DECLARA `perfis`, E NENHUMA DECLARA `perfil`. O motivo esta no
  // cabecalho: aqui o operador ve MENOS que a consulta, e minimo hierarquico nao
  // sabe dizer isso. Se alguem trocar uma lista por um minimo, o operador passa a
  // ver a tela de novo, sem erro nenhum -- e ha teste cobrando que nao aconteca.
  rotas: [
    // O DASHBOARD E A UNICA QUE OS TRES VEEM. E o quadro geral da producao, e ele
    // serve tanto a quem acompanha quanto a quem esta executando.
    {
      path: '',
      render: renderProducaoDashboard,
      perfis: ['consulta', 'operador', 'gerente']
    },
    // A UNICA QUE ESCREVE, e a unica que a CONSULTA nao ve: nao ha atividade
    // propria de quem so acompanha, e a tela abriria vazia com os botoes em 403.
    {
      path: '/atividade',
      render: renderAtividade,
      perfis: ['operador', 'gerente']
    },
    // AS NOVE DE ACOMPANHAMENTO: consulta e gerente, e o OPERADOR fica de fora.
    // Nao e rebaixamento dele, e recorte de ruido: quem esta no meio de uma carta
    // nao precisa de nove telas de acompanhamento na barra lateral.
    { path: '/grade', render: renderGrade, perfis: ['consulta', 'gerente'] },
    { path: '/lote', render: renderLoteAcompanhamento, perfis: ['consulta', 'gerente'] },
    { path: '/atividade_subfase', render: renderAtividadeSubfase, perfis: ['consulta', 'gerente'] },
    { path: '/atividade_usuario', render: renderAtividadeUsuario, perfis: ['consulta', 'gerente'] },
    { path: '/situacao_subfase', render: renderSituacaoSubfase, perfis: ['consulta', 'gerente'] },
    { path: '/atividades', render: renderAtividades, perfis: ['consulta', 'gerente'] },
    { path: '/pit', render: renderPitProducao, perfis: ['consulta', 'gerente'] },
    { path: '/mapas', render: renderMapas, perfis: ['consulta', 'gerente'] },
    // O MICROCONTROLE ENTROU NA CONSULTA em 2026-08-09, e ele era de gerente ate
    // ali. A regra nova do chefe -- "o visualizador ve TUDO" -- nao abre excecao,
    // e as SEIS rotas de LEITURA de `/api/microcontrole` baixaram de `gerente`
    // para `consulta` no servidor para acompanhar. Sao seis e nao onze: as duas
    // de gravacao de telemetria continuam em `operador` (quem grava e o plugin) e
    // as tres que mexem no perfil de monitoramento continuam em `gerente`.
    //
    // O QUE ISSO ALARGA, e vale o senhor saber: a telemetria mede rendimento de
    // pessoa COM NOME (feicoes por hora, cobertura de tela). Quem tem consulta em
    // `producao` passa a ver isso de toda a Divisao. Se a intencao era o
    // visualizador ver o TRABALHO e nao as PESSOAS, esta e a linha a reverter, e
    // reverte-la e trocar `consulta` por `gerente` aqui e nas seis guardas de
    // `microcontrole_route.js`.
    { path: '/microcontrole', render: renderMicrocontrole, perfis: ['consulta', 'gerente'] },
  ],
};
