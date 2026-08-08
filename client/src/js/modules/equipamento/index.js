// Manifesto do modulo EQUIPAMENTO. O contrato do manifesto esta em
// modules/registry.js.
//
// O `id` casa com `dominio.modulo.nome_abrev` do servidor, e e a MESMA string
// que o `verifyPerfil(nivel, 'equipamento')` de cada rota compara por igualdade,
// que o prefixo '/api/equipamento' usa e que a chave do mapa `perfis` do POST
// /api/login carrega. Trocar essa string derruba a autorizacao sem erro de
// sintaxe e sem teste vermelho.
//
// O NOME QUE A PESSOA LE NAO SAI DAQUI: a sidebar o tira do catalogo do
// servidor (`auth-store.nomeModulo`), lendo `dominio.modulo.nome`.
//
// O MENU NAO REPETE A RESTRICAO DA ROTA: a sidebar deriva a visibilidade de cada
// item da rota que ele aponta (`registry.podeAbrirRota`). As quatro telas sao de
// `consulta`, que e o piso do modulo, entao quem entra ve as quatro; o que muda
// por perfil sao os BOTOES de lancamento, e quem barra escrita e o servidor.
//
// PERFIL DE ROTA NO CLIENT E SO ERGONOMIA. O recorte real e este, e ele vive nas
// rotas do servidor:
//   consulta  le as quatro telas
//   operador  lanca indisponibilidade, manutencao e afastamento, e cadastra tipo
//   gerente   cadastra, altera e da baixa no BEM, e lanca transferencia e descarga

import { ICONS } from '@utils/dom.js';

import './equipamento.css';

import { renderEquipamentoDashboard } from './pages/dashboard/index.js';
import { renderBensList } from './pages/bens/list.js';
import { renderBemDetails } from './pages/bens/details.js';
import { renderTiposList } from './pages/tipos/list.js';

export default {
  id: 'equipamento',
  icon: ICONS.storage,

  // A HOME NAO PODE SER STRING VAZIA, e o painel mora em '#/equipamento', sem
  // sufixo nenhum. `registry.rotaInicial` faz `mod.home || '/dashboard'`, e o
  // vazio, sendo falso, cairia numa rota '/equipamento/dashboard' que nao
  // existe: o cabecalho do modulo na sidebar levaria a 404.
  //
  // '/' resolve para o MESMO lugar: o router parte o caminho e descarta segmento
  // vazio ('/equipamento/' vira ['equipamento']), entao ele casa com a rota de
  // caminho '' registrada abaixo. Os itens do menu apontam '#/equipamento' puro.
  home: '/',

  // MENU PLANO, sem grupo aninhado: grupo colapsavel dentro de uma seção que ja
  // abre e fecha cobra um segundo clique e esconde tela de quem nao sabe que ela
  // existe. Os dois que existiram no sistema foram podados em 2026-08-08, e um
  // teste da sidebar faz cumprir que nenhum manifesto declare `children`.
  //
  // SAO TRES ITENS, e nao quatro: a quarta rota do modulo e a FICHA DO BEM
  // ('/bens/:id'), que so existe com um id na mao. Item de menu apontando para
  // um caminho com parametro levaria a /404 -- e por isso `registry.rotaInicial`
  // tambem filtra rota com ':' antes de escolher porta de entrada. Chega-se a
  // ficha pela lista, e o item "Equipamentos" fica marcado enquanto ela esta
  // aberta, porque a chave do item ativo sai do segundo segmento da rota.
  menu: [
    { id: 'painel', label: 'Painel', icon: ICONS.dashboard, path: '' },
    { id: 'bens', label: 'Equipamentos', icon: ICONS.layers, path: '/bens' },
    { id: 'tipos', label: 'Tipos', icon: ICONS.category, path: '/tipos' },
  ],

  rotas: [
    // Caminho VAZIO: a tela e '#/equipamento', a raiz do modulo.
    { path: '', render: renderEquipamentoDashboard, perfil: 'consulta' },
    // A LISTA VEM ANTES DA FICHA, na ordem de declaracao. O router casa na ordem
    // em que as rotas foram registradas, e as duas tem contagens de segmento
    // diferentes ('/equipamento/bens' e '/equipamento/bens/:id'), entao aqui a
    // ordem nao decide nada -- mas e a mesma disciplina que o Express cobra do
    // lado do servidor, onde '/tipo' cairia em '/:id' se viesse depois.
    { path: '/bens', render: renderBensList, perfil: 'consulta' },
    // A FICHA E DE CONSULTA. Ela reune o bem e os quatro historicos, e nenhum
    // deles aparece em outra tela: cobrar operador aqui esconderia de quem so
    // consulta a unica visao completa do equipamento.
    { path: '/bens/:id', render: renderBemDetails, perfil: 'consulta' },
    // O CADASTRO DE TIPO abre para consulta e ESCREVE para operador. A tela e
    // uma lista de nove linhas que todo mundo do modulo precisa ler para
    // entender a vida util herdada de cada bem; os botoes e que sao do operador.
    { path: '/tipos', render: renderTiposList, perfil: 'consulta' },
  ],
};
