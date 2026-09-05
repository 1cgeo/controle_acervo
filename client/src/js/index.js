import '@css/style.css';
import { initTheme } from '@utils/theme.js';
import { isAuthenticated } from '@store/auth-store.js';
import { sincronizarSessao, EVENTO_SESSAO_MUDOU } from '@services/api-client.js';
import Router, {
  acessoLoader, adminLoader, authLoader, gerenteLoader, perfilLoader, rotaRaiz,
} from './router.js';
import { createMainLayout } from '@components/layout/main-layout.js';
import { estadoErro } from '@components/estado-erro.js';
import { modulosPortados } from '@modules/registry.js';
import { renderLogin } from '@pages/login.js';
import { renderUnauthorized } from '@pages/unauthorized.js';
import { renderNotFound } from '@pages/not-found.js';
import { renderUsuariosList } from '@pages/usuarios/list.js';
import { renderAcessos } from '@pages/acessos/index.js';
import { renderInstituicao } from '@pages/instituicao/index.js';
import { renderRastreabilidade } from '@pages/rastreabilidade/index.js';
import { renderPerfil } from '@pages/perfil/index.js';
import { renderPitAno } from '@pages/metas/index.js';
import { renderExecucaoPit } from '@pages/execucao-pit/index.js';
import { renderExtraPitList } from '@pages/extra-pit/list.js';
import { renderAproveitamento } from '@pages/aproveitamento/index.js';
import {
  renderCapacitacaoMinistrada,
  renderCapacitacaoRecebida,
} from '@pages/capacitacao/list.js';
import { renderCampo } from '@pages/campo/list.js';
import { renderRpcmtec } from '@pages/rpcmtec/index.js';
import { renderRpcmtecEdicao } from '@pages/rpcmtec/edicao.js';
import { renderConsultarPedido } from '@modules/mapoteca/pages/consultar-pedido.js';

// Inicializa o tema (claro/escuro via data-theme, persistido em sca-theme-mode)
initTheme();

const app = document.getElementById('app');

let mainLayout = null;

function getContentArea() {
  if (!mainLayout) {
    mainLayout = createMainLayout();
    app.innerHTML = '';
    app.appendChild(mainLayout.layout);
  }
  return mainLayout.contentArea;
}

function clearLayout() {
  if (mainLayout) {
    mainLayout.cleanup();
    mainLayout = null;
  }
  app.innerHTML = '';
}

/**
 * Monta uma pagina no container, e a TELA EM BRANCO vira estado de erro.
 *
 * O render de uma pagina que REJEITA na montagem (a primeira chamada sem
 * `catch`, o servidor fora do ar, o 403 de uma rota que a tela nao devia ter
 * pedido) deixava a area de conteudo vazia: o container ja tinha sido esvaziado
 * aqui em cima, a excecao subia ate o `hashchange` e morria no console. Quem
 * abriu a tela via um retangulo branco, sem o motivo e sem o caminho de volta.
 *
 * O "Tentar de novo" passa pelo `router.resolve()`, e nao chama `renderFn`
 * direto: a remontagem tem de devolver a limpeza PARA O ROUTER, senao a pagina
 * que se recupera deixaria para tras o `setInterval` e os ouvintes dela.
 *
 * @param {Function} renderFn
 * @param {HTMLElement} destino
 * @param {Object} ctx
 * @returns {Promise<Function|undefined>} a limpeza da pagina, quando ela monta
 */
async function montar(renderFn, destino, ctx) {
  destino.innerHTML = '';
  try {
    return await renderFn(destino, ctx);
  } catch (err) {
    console.error('Falha ao montar a página:', err);
    destino.replaceChildren(estadoErro(err, () => router.resolve()));
    return undefined;
  }
}

function withLayout(renderFn) {
  return (_container, ctx) => montar(renderFn, getContentArea(), ctx);
}

function standalone(renderFn) {
  return (_container, ctx) => {
    clearLayout();
    return montar(renderFn, app, ctx);
  };
}

const router = new Router(app);

// ---------------------------------------------------------------------------
// Rotas de PLATAFORMA (sem prefixo de modulo)
// ---------------------------------------------------------------------------
router.add('/login', standalone(renderLogin), {
  guard: () => (isAuthenticated() ? rotaRaiz() : true),
});

// Tela unica de usuarios: uma coluna por modulo. Administrador global.
router.add('/usuarios', withLayout(renderUsuariosList), { guard: adminLoader });

// A INSTITUICAO que opera esta instalacao: nome, sigla e Unidade Gestora.
//
// ADMINISTRADOR GLOBAL, como a de usuarios, e o servidor cobra `verifyAdmin` no
// PUT. A LEITURA da rota e de quem esta logado (o rodape do relatorio precisa do
// nome), mas a TELA e do administrador: quem nao escreve nao tem o que fazer num
// formulario de tres campos.
//
// Ela e o que tirou o "1º CGEO" de dentro do codigo. Ver `docs/decisoes.md`.
router.add('/instituicao', withLayout(renderInstituicao), { guard: adminLoader });

// Dashboard do efetivo: quem esta na Divisao no mes, quanto rendeu e quanto o
// impedimento custou, mais o historico de login (`dgeo.login`) numa aba atras.
//
// CONSULTA NO EFETIVO, pela regua nova: consulta LE as telas do modulo. Era
// `perfilLoader('efetivo', 'gerente')`, e antes disso `adminLoader`. O que
// baixou foi a PORTA DA TELA, e nao o que ela mostra.
//
// A ABA ACESSOS CONTINUA DO ADMINISTRADOR GLOBAL, e ela mesma se esconde de
// quem nao e (`renderAcessos`). O servidor cobra verifyAdmin em todas as rotas
// de /api/acessos, e afrouxar a porta da tela nao afrouxa a aba.
router.add('/acessos', withLayout(renderAcessos), {
  guard: perfilLoader('efetivo', 'consulta'),
});

// Rastreabilidade: o que foi ALTERADO nos modulos, quando e por quem. E a outra
// pergunta de #/acessos, que registra quem ENTROU e nao o que a pessoa fez
// depois de entrar.
//
// `gerenteLoader`, e nao `adminLoader`: a tela e do administrador global (que ve
// os modulos e a plataforma) E do gerente de qualquer modulo (que ve o
// dele). O recorte de verdade vem do servidor, no verifyRastreabilidade, que le
// o perfil do BANCO a cada requisicao -- este guarda so evita abrir uma tela que
// responderia 403.
//
// NAO confundir com #/acervo/auditoria: aquela roda os invariantes do acervo,
// mede a coerencia entre tabelas HOJE e nao diz quem produziu a incoerencia.
router.add('/rastreabilidade', withLayout(renderRastreabilidade), {
  guard: gerenteLoader,
});

// Meu perfil: os proprios dados e a troca da PROPRIA senha. `authLoader`, e nao
// `adminLoader`: e a unica tela de plataforma que serve a todo mundo, e sem ela
// so o administrador troca senha, por reset.
router.add('/perfil', withLayout(renderPerfil), { guard: authLoader });

// O PIT DO ANO: o plano anual da Divisao, que os modulos consomem. Nao e
// tela de modulo, senao quem so tem perfil na mapoteca nao veria a lista. Sem
// `adminLoader`: LER e de quem tem acesso ao sistema, e o backend cobra o
// administrador so na escrita.
//
// `acessoLoader`, e nao `authLoader`: quem ainda nao recebeu perfil nenhum esta
// logado e nao esta no sistema, e o plano de trabalho da Divisao nao e o que ele
// ve enquanto espera a concessao. O servidor cobra o mesmo com `verifyAcesso`.
//
// UMA TELA SO, no lugar de '/metas' e '/revisoes_pit'. As duas se liam juntas e
// ninguem descobria pela interface que alterar o PIT e abrir uma revisao: o
// botao de editar tinha virado um ato da OUTRA tela, e nada dizia isso. Agora o
// exercicio, as revisoes e o consolidado moram na mesma pagina.
router.add('/metas', withLayout(renderPitAno), { guard: acessoLoader });

// A ROTA VELHA DAS REVISOES continua respondendo, e DESVIA. Renomear URL quebra
// link guardado, e '#/revisoes_pit' esta em favorito e em mensagem antiga. O
// guarda devolve o caminho novo, que e como o router ja faz o desvio da raiz.
//
// '/metas' ABSORVEU '/revisoes_pit', e nao o contrario: '#/metas' e o endereco
// que a grade de execucao e a rastreabilidade apontam, e um '#/pit' novo
// obrigaria a mexer nas duas para nada. O nome da rota fica imperfeito, e custa
// menos que dois desvios.
router.add('/revisoes_pit', withLayout(renderPitAno), {
  guard: () => {
    const acesso = acessoLoader();
    return acesso === true ? '/metas' : acesso;
  },
});

// Execucao do PIT: a grade do ano, com o planejado e o realizado de cada mes.
//
// CONSULTA NO PIT, e nao mais `gerenteLoader`: a execucao do plano anual e a
// tela de LEITURA da area do PIT, e pela regua nova quem tem consulta no modulo
// le as telas do modulo. Ler a grade nao move nada; LANCAR a celula e do
// operador (`verifyPerfil('operador', 'pit')` em POST e DELETE
// /metas/execucao), e quem barra e o servidor.
router.add('/execucao_pit', withLayout(renderExecucaoPit), {
  guard: perfilLoader('pit', 'consulta'),
});

// Extra-PIT: a excecao AUTORIZADA ao plano anual (subsecao 3.3).
//
// `acessoLoader`, o MESMO de '/metas' e pela mesma razao. As duas NAO desceram
// para `perfilLoader('pit', ...)` quando o resto da regua mudou, e e
// deliberado: cadastrar NC, item de PDR ou pedido de impressao obriga a escolher
// a meta que financia ou cumpre, entao quem trabalha na mapoteca ou no orcamento
// precisa ler o plano do ano sem ter perfil no PIT.
router.add('/extra_pit', withLayout(renderExtraPitList), { guard: acessoLoader });

// Aproveitamento do efetivo (6.1): o cadastro de quem esteve na Divisao e do que
// impediu cada um.
//
// LISTA DE PERFIS, e a lista NAO E HIERARQUICA: passam consulta e gerente, e o
// OPERADOR fica de fora. E de proposito, e e a mesma forma que a mapoteca ja usa
// (`ehDeAlgumPerfil`, em store/auth-store.js).
//
// O operador ficou com o PROPRIO aproveitamento, em '#/perfil', e nao com o da
// Divisao inteira; quem lanca pelos outros e o gerente, e quem so le e a
// consulta. Com o minimo hierarquico o operador veria esta tela por ser um nivel
// ACIMA de consulta, que e o contrario do que foi pedido: era
// `perfilLoader('efetivo', 'operador')` desde a 1.33.0, e `adminLoader` antes.
//
// O menu decide pelo MESMO campo, entao nao ha item de sidebar que abra uma tela
// recusada aqui. O recorte de verdade e do servidor, em /api/efetivo/periodos e
// /impedimentos.
router.add('/aproveitamento', withLayout(renderAproveitamento), {
  guard: perfilLoader('efetivo', ['consulta', 'gerente']),
});

// A capacitacao e DUAS telas, em dois lugares do menu, e agora tambem DUAS
// ROTAS no servidor, com guardas diferentes. A MINISTRADA e servico que a
// Divisao presta, e fica no PIT; a RECEBIDA e gente nossa em curso, e fica
// em Efetivo. A tabela do banco continua UMA: o que muda entre as duas sao tres
// colunas.
//
// A GUARDA DAQUI ESPELHA A DO SERVIDOR, e nao e ela que decide: quem barra e o
// `verifyPerfil`, lendo o perfil do BANCO a cada requisicao. Isto so evita abrir
// uma tela que responderia 403.
//
// CONSULTA nas duas, e nao mais operador: abrir a lista de capacitacao e LER, e
// pela regua nova quem tem consulta no modulo le as telas dele. O operador
// continua sendo o unico que LANCA, e isso e recorte de botao e de rota de
// escrita, nao da porta da tela.
router.add('/capacitacao_ministrada', withLayout(renderCapacitacaoMinistrada), {
  guard: perfilLoader('pit', 'consulta'),
});
router.add('/capacitacao_recebida', withLayout(renderCapacitacaoRecebida), {
  guard: perfilLoader('efetivo', 'consulta'),
});

// ATIVIDADES DE CAMPO: o que a Divisao faz FORA dela, e a fonte da subsecao 2.5
// do RPCMTec. Rota de PLATAFORMA, sem prefixo de modulo, como '/metas' e
// '/extra_pit': campo NAO tem linha em `dominio.modulo`, e a autorizacao dele
// cobra `pit`, o modulo que ja existia.
//
// CONSULTA no PIT, e nao `acessoLoader` como '/metas' e '/extra_pit'.
// Aqueles dois sao lidos por quem trabalha na mapoteca e no orcamento, porque
// cadastrar NC ou pedido obriga a escolher a meta que financia; campo nao
// atravessa modulo nenhum, e ler onde a Divisao esteve e tela da area do PIT.
//
// DUAS ROTAS PARA A MESMA TELA. A segunda existe porque a rastreabilidade linka
// a FICHA de um campo (#/campo/12), e o mapa de entidades do client declara
// `plataforma:campo` como ficha. Sem ela o link cairia em /404. A tela e a
// mesma, e o `:id` so manda abrir o detalhe por cima da lista ja carregada.
router.add('/campo', withLayout(renderCampo), {
  guard: perfilLoader('pit', 'consulta'),
});
router.add('/campo/:id', withLayout(renderCampo), {
  guard: perfilLoader('pit', 'consulta'),
});

// RPCMTec: o relatorio mensal da Divisao, inteiro, numa tela so. Rota de
// PLATAFORMA porque a mesma edicao fala de acervo, mapoteca e orcamento, e o
// chefe assina uma so.
//
// `gerenteLoader`, e nao mais `adminLoader`: QUALQUER GERENTE LE O RELATORIO
// INTEIRO. Isto REVERTE a decisao de admin-only, que existia porque o RPCMTec
// traz valor de credito, de empenho e de liquidacao e liberar por perfil de um
// modulo entregaria o orcamento a quem so cataloga carta. O chefe pediu o
// contrario: gerente responde pela area inteira, e ve tudo dela.
//
// A ESCRITA CONTINUA RECORTADA, e quem a barra e o servidor. A guarda daqui so
// evita abrir uma tela que responderia 403.
router.add('/rpcmtec', withLayout(renderRpcmtec), { guard: gerenteLoader });
// A EDICAO de um mes. Rota propria, e nao estado dentro da lista, porque
// consultar o RPCMTec de um mes passado e a operacao mais comum da tela e
// precisa de endereco: quem manda "veja o de marco" manda um link.
router.add('/rpcmtec/:id', withLayout(renderRpcmtecEdicao), { guard: gerenteLoader });

// Consulta PUBLICA de pedido da mapoteca pelo localizador (RN04). Sem sessao e
// sem guarda: quem pediu acompanha o pedido pelo codigo XXXX-XXXX-XXXX, sem
// conta no SCA. Por isso e rota de plataforma, nao de modulo. A pagina mora no
// modulo mapoteca porque so ela usa o service da mapoteca.
// Sem localizador a tela abre so com o campo de busca.
router.add('/consultar-pedido', standalone(renderConsultarPedido));
router.add('/consultar-pedido/:localizador', standalone(renderConsultarPedido));

// ---------------------------------------------------------------------------
// Rotas dos MODULOS, registradas a partir do manifesto de cada um.
// '/dfd' do modulo 'orcamento' vira '#/orcamento/dfd'. Um modulo esqueleto
// (rotas: []) nao registra nada, entao suas URLs caem no 404 ate ser portado.
// ---------------------------------------------------------------------------
for (const modulo of modulosPortados()) {
  for (const rota of modulo.rotas) {
    // `perfis` (lista) antes de `perfil` (minimo): e o mesmo campo, na mesma
    // ordem, que registry.podeAbrirRota le para decidir o MENU.
    const guard = rota.admin
      ? adminLoader
      : perfilLoader(modulo.id, rota.perfis || rota.perfil || 'consulta');
    router.add(`/${modulo.id}${rota.path}`, withLayout(rota.render), { guard });
  }
}

// ---------------------------------------------------------------------------
// Paginas de erro: com layout quando ha sessao, soltas quando nao ha.
// ---------------------------------------------------------------------------
function errorPage(renderFn) {
  return (_container, ctx) => {
    if (isAuthenticated()) {
      return montar(renderFn, getContentArea(), ctx);
    }
    clearLayout();
    return montar(renderFn, app, ctx);
  };
}

router.add('/unauthorized', errorPage(renderUnauthorized));
router.add('/404', errorPage(renderNotFound));

router.start();

// Perfil mudou no servidor enquanto a pessoa estava logada. A sidebar e os
// botoes sao montados uma vez, entao trocar o localStorage nao basta: recarrega
// para a tela inteira voltar a bater com o que o servidor aceita. Acontece so
// quando algo MUDOU de fato, e o proximo boot ja encontra tudo igual.
window.addEventListener(EVENTO_SESSAO_MUDOU, () => location.reload());

// Reconfere a foto do login. Roda DEPOIS do start para nao atrasar a primeira
// tela: no caso comum nada mudou e ninguem percebe.
sincronizarSessao();
