import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showError } from '@utils/toast.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { estadoErro } from '@components/estado-erro.js';
import { temPerfil } from '@store/auth-store.js';
import {
  getMapaEfetivo,
  getPeriodosEfetivo,
  getImpedimentos,
  // `getMilitaresEfetivo`, e NUNCA `getUsuarios`: ver o comentário do
  // `Promise.all` do `load()`, onde a troca é explicada.
  getMilitaresEfetivo,
} from '@services/plataforma-service.js';
// SEM `openImpedimentoDialog` aqui: impedimento se cadastra a partir do MILITAR,
// na ficha que a linha do mapa abre. Um botao geral pediria
// a pessoa primeiro, que e a pergunta que a tela ja respondeu.
import { openPeriodoDialog, openMilitarDialog } from './militar-dialog.js';
// A GRADE É COMPARTILHADA com a seção "Meu aproveitamento" de `#/perfil`, que
// desenha UMA linha com este mesmo componente. Ver o cabeçalho de `mapa-grade.js`.
import {
  iso,
  pct,
  montarMapaEfetivo,
  legendaDoMapa,
  resumoPonderado,
  avisoProjecao as criarAvisoProjecao,
  anosComPassagem,
} from './mapa-grade.js';

const primeiroDiaDoAno = (ano) => `${ano}-01-01`;
const ultimoDiaDoAno = (ano) => `${ano}-12-31`;

// O MESMO recorte do servidor, em JavaScript: o registro entra no ano quando
// cruza qualquer dia dele. Datas ISO comparam como texto, entao a conta e a
// comparacao direta.
function cruzaOAno(registro, ano) {
  const inicio = iso(registro.data_inicio);
  const fim = iso(registro.data_fim);
  return inicio <= ultimoDiaDoAno(ano)
    && (!fim || fim >= primeiroDiaDoAno(ano));
}

/**
 * Aproveitamento do efetivo (#/aproveitamento).
 *
 * O QUE ELA RESPONDE: quanto do efetivo esteve disponível para a finalidade da
 * Divisão, e por que o resto não esteve. Retrato mensal com texto livre de
 * atividades não soma, não compara entre meses e não sabe dizer o que aconteceu
 * num dia: por isso o modelo é INTERVALO.
 *
 * O MAPA É A TELA, e o cadastro é o que se abre a partir dele. A pergunta que se
 * faz aqui é visual ("quem está vermelho?"), e a resposta seguinte é sempre a
 * mesma pessoa: clicar na linha abre a ficha dela, com as passagens e os
 * impedimentos que explicam a cor.
 *
 * CÉLULA SEM COR é "não estava na Divisão", e é diferente de célula vermelha,
 * que é "estava e não rendeu". Com as duas em cinza, a chegada em março se leria
 * como quatro meses de licença.
 *
 * DUAS TABELAS RESPONDEM "ESTÁ NA DGEO", e elas discordam. `dgeo.usuario.ativo`
 * decide quem aparece no seletor de militar; `dgeo.efetivo_periodo` decide quem
 * entra no mapa, e militar desativado no cadastro pode contar como presente com
 * passagem aberta. A tela AVISA da divergência no
 * rodapé e nunca a corrige: `data_fim` nula é desenho, e quem fecha passagem é o
 * chefe.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderAproveitamento(container, ctx) {
  let disposed = false;
  const anoCorrente = new Date().getFullYear();
  let anoSelecionado = anoCorrente;

  // LANÇAR passagem e impedimento DOS OUTROS é do GERENTE do Efetivo, e a porta
  // desta tela é a LISTA `['consulta', 'gerente']` (em index.js): quem tem
  // CONSULTA lê o mapa e não escreve nada. O servidor cobra
  // `verifyPerfil('gerente', 'efetivo')` no POST, no PUT e no DELETE de
  // `/efetivo/periodos` e `/efetivo/impedimentos` -- sem este recorte, "Nova
  // passagem" e os ícones da ficha respondiam 403 depois do formulário
  // preenchido. Isto é ERGONOMIA: quem barra é o servidor.
  //
  // `temPerfil`, e não `ehDeAlgumPerfil`: aqui a régua É hierárquica, porque é a
  // do servidor, e o administrador global passa pelos dois.
  const podeLancar = temPerfil('gerente', 'efetivo');

  // Guardados para a ficha do militar: ela mostra as passagens e os impedimentos
  // daquela pessoa sem pedir de novo ao servidor.
  let periodos = [];
  let impedimentos = [];
  let usuarios = [];
  // O cadastro CRU, com os desativados. O `usuarios` acima é a lista de escolha
  // e só tem os ativos; a conciliação precisa dos dois lados.
  let cadastro = [];
  // Todas as passagens, sem recorte de ano: é delas que sai a lista de anos.
  let todosPeriodos = [];

  const query = ctx && ctx.query ? ctx.query : new URLSearchParams();
  // Militar apontado pela rota (`?usuario_uuid=`). O destaque acompanha a troca
  // de ano; a ficha abre UMA vez, na primeira carga que o encontrar.
  const uuidDestacado = query.get('usuario_uuid') || null;
  let fichaDoLinkAberta = false;

  const anoFilter = createSelectField({
    label: 'Ano',
    options: [{ value: anoSelecionado, label: String(anoSelecionado) }],
    placeholder: 'Ano',
    value: anoSelecionado,
    onChange: (valor) => {
      if (valor === null) return;
      anoSelecionado = Number(valor);
      load();
    },
  });

  const novaPassagemBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openPeriodoDialog({ usuarios, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova passagem']);

  const mapa = el('div', { className: 'mapa-efetivo' });
  const legenda = legendaDoMapa();
  const resumoDivisao = el('p', { className: 'efetivo-resumo', style: { margin: '0 0 8px' } });
  const avisoProjecao = el('div', { style: { margin: '0 0 12px' } });
  const rodape = el('div', { style: { marginTop: '16px' } });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Aproveitamento do efetivo' }),
      el('div', { className: 'page__actions' }, podeLancar ? [novaPassagemBtn] : []),
    ]),
    el('div', { className: 'page__filters' }, [anoFilter.element]),
    avisoProjecao,
    resumoDivisao,
    mapa,
    legenda,
    rodape,
  ]);
  container.appendChild(page);

  /**
   * O mapa da DIVISÃO: uma linha por militar, pelo mesmo componente com que
   * `#/perfil` desenha uma linha só.
   *
   * O que é DAQUI e não do componente: a linha abre a ficha do militar, e o
   * texto do vazio fala da Divisão.
   */
  function montarMapa({ semanas, anual }) {
    mapa.innerHTML = '';
    mapa.appendChild(montarMapaEfetivo({
      ano: anoSelecionado,
      semanas,
      anual,
      impedimentos,
      onLinhaClick: abrirFicha,
      destaqueUuid: uuidDestacado,
      vazio: 'Nenhum militar com passagem pela DGEO neste ano.',
    }));
  }

  const periodosDo = (uuid) => periodos.filter(p => p.usuario_uuid === uuid);
  const impedimentosDo = (uuid) => impedimentos.filter(i => i.usuario_uuid === uuid);

  function abrirFicha(militar) {
    openMilitarDialog({
      militar,
      ano: anoSelecionado,
      // A ficha continua ABRINDO para quem só tem consulta: o mapa responde
      // "quanto" e ela responde "por quê". O que sai são os botões de escrita.
      podeEscrever: podeLancar,
      periodos: periodosDo(militar.usuario_uuid),
      impedimentos: impedimentosDo(militar.usuario_uuid),
      // Recarrega o mapa por baixo E devolve as listas novas: sem elas a ficha
      // aberta continuaria mostrando o que acabou de ser corrigido.
      onSaved: async () => {
        await load();
        return {
          periodos: periodosDo(militar.usuario_uuid),
          impedimentos: impedimentosDo(militar.usuario_uuid),
        };
      },
    });
  }

  /**
   * O aproveitamento da DIVISÃO, com as DUAS médias à vista.
   *
   * A CONTA é de `resumoPonderado`, compartilhada com `#/perfil`; a FRASE é
   * daqui, porque só esta tela fala em Divisão e conta militares. Um número de
   * média sem dizer qual média é convida a comparar com o do ano passado, que
   * era a outra.
   */
  function montarResumo(anual) {
    resumoDivisao.innerHTML = '';
    if (!anual.length) return;

    const { ponderada, simples, militares } = resumoPonderado(anual);
    const quantos = militares === 1 ? '1 militar' : `${militares} militares`;

    resumoDivisao.append(
      `Aproveitamento da Divisão em ${anoSelecionado}, ponderado por dias na DGEO: `,
      el('strong', { textContent: pct(ponderada) }),
      `. Média simples dos percentuais: ${pct(simples)}. Sobre ${quantos}.`
    );
  }

  /** O aviso de ano futuro, que é projeção e não medida. Ver `mapa-grade.js`. */
  function montarAvisoProjecao() {
    avisoProjecao.innerHTML = '';
    const aviso = criarAvisoProjecao(anoSelecionado, anoCorrente);
    if (aviso) avisoProjecao.appendChild(aviso);
  }

  /**
   * O rodapé de DIVERGÊNCIA entre o cadastro e as passagens.
   *
   * Só avisa. Fechar passagem e desativar cadastro são atos do chefe, e a tela
   * que os fizesse sozinha apagaria a pergunta em vez de respondê-la.
   */
  function montarDivergencias() {
    rodape.innerHTML = '';

    // `periodos` já vem recortado pelo ano da tela.
    const doAno = periodos;

    // PASSAGEM ABERTA COM CADASTRO INATIVO NÃO É DIVERGÊNCIA.
    // `dgeo.usuario.ativo` é flag de LOGIN, e a maioria do efetivo não usa o
    // SCA: contando isso, o aviso lista quase a Divisão inteira e esconde a
    // linha que importa.
    //
    // Sobra a divergência que aponta trabalho de verdade: ativo no cadastro e
    // SEM passagem no ano. Quem chegou e não foi lançado fica fora do mapa, e o
    // número da Divisão cai por ausência. Ela também pega o inverso, que é risco
    // de acesso: quem saiu, teve a passagem encerrada e continua podendo entrar.
    const comPassagem = new Set(doAno.map(p => p.usuario_uuid));
    const ativoSemPassagem = cadastro
      .filter(u => u.ativo && !comPassagem.has(u.uuid))
      .map(u => `${u.tipo_posto_grad || ''} ${u.nome_guerra || ''}`.trim());

    if (!ativoSemPassagem.length) return;

    const bloco = (classe, titulo, nomes, oQueFazer) => el('p', {
      className: `efetivo-divergencia ${classe}`,
      style: { margin: '0 0 8px', color: 'var(--text-secondary)' },
    }, [
      el('strong', { textContent: `${titulo}: ` }),
      `${nomes.join(', ')}. ${oQueFazer}`,
    ]);

    const partes = [];
    if (ativoSemPassagem.length) {
      partes.push(bloco(
        'efetivo-divergencia--ativo-sem-passagem',
        `Acessa o SAP e sem passagem em ${anoSelecionado}`,
        ativoSemPassagem,
        'Estes ficam fora do mapa. Cadastre a passagem, ou desative o acesso de'
        + ' quem já saiu.'
      ));
    }

    rodape.appendChild(el('div', { className: 'efetivo-divergencias' }, [
      // A JANELA VAI NO TÍTULO. O dashboard do efetivo tem um bloco com o mesmo
      // nome e outro recorte (o MÊS), e os dois dão números diferentes: em
      // 07/08/2026 eram 2 aqui e 3 lá, os dois certos. Sem a janela escrita, quem
      // vê as duas telas na mesma sessão não tem como saber qual vale.
      el('h2', {
        style: { fontSize: '0.9375rem', margin: '0 0 8px' },
        textContent: `Divergências entre o cadastro e as passagens em ${anoSelecionado}`,
      }),
      ...partes,
      el('p', {
        style: { margin: '0', fontSize: '0.8125rem', color: 'var(--text-secondary)' },
        textContent: 'A tela apenas aponta. Quem corrige é o chefe.',
      }),
    ]));
  }

  /** Tudo o que fala do ano some antes de o ano novo chegar. */
  function limparTela() {
    mapa.innerHTML = '';
    resumoDivisao.innerHTML = '';
    avisoProjecao.innerHTML = '';
    rodape.innerHTML = '';
  }

  async function load() {
    // A ROLAGEM MORRE NO REMONTE. A tela reconstrói o mapa à mão, o documento
    // encolhe e o navegador prende a rolagem no topo: sem guardar a posicao,
    // trocar o ano joga a pessoa de volta ao começo da página.
    const rolagem = typeof window !== 'undefined' ? (window.scrollY || 0) : 0;

    // CARREGANDO, e não o mapa velho. Sem isso o mapa do ano anterior fica na
    // tela durante a espera, com a cara de ser o do ano novo.
    limparTela();
    mapa.appendChild(el('p', {
      className: 'mapa-efetivo__carregando',
      style: { padding: '24px', color: 'var(--text-secondary)' },
      textContent: 'Carregando o mapa do ano.',
    }));

    try {
      const [mapaDados, listaPeriodos, listaImpedimentos, listaUsuarios] = await Promise.all([
        getMapaEfetivo(anoSelecionado),
        // SEM recorte de ano: a mesma resposta serve à ficha (filtrada aqui) e
        // à lista de anos do seletor. Duas chamadas trariam a mesma tabela.
        getPeriodosEfetivo(),
        getImpedimentos(anoSelecionado),
        // A lista de quem PODE receber uma passagem é o cadastro inteiro, e não
        // quem já tem passagem: cadastrar a primeira de alguém é o caso comum.
        //
        // ESTA CHAMADA ERA `getUsuarios()`, e é por isso que a tela morria.
        // `GET /api/usuarios` é `verifyAdmin`, e ela sai no MESMO `Promise.all`
        // das três rotas de `/efetivo`: o gerente do efetivo tomava 403 só nela e
        // o `Promise.all` derrubava a tela INTEIRA com "necessita ser um
        // administrador", com as outras três respondendo 200.
        //
        // A TELA NÃO PODE VOLTAR A PEDIR `/usuarios`, e não é só pelo 403: aquela
        // rota devolve `login`, a flag de administrador e o perfil de cada
        // pessoa em cada módulo. Para montar um seletor de nomes e nomear três
        // divergências, ela pagava com o cadastro que diz quem manda no sistema.
        // `GET /efetivo/militares` devolve as seis colunas que esta tela desenha,
        // sob `consulta` no módulo Efetivo, que é o que a tela já exige.
        cadastro.length ? Promise.resolve(cadastro) : getMilitaresEfetivo(),
      ]);
      if (disposed) return;

      todosPeriodos = listaPeriodos || [];
      periodos = todosPeriodos.filter(p => cruzaOAno(p, anoSelecionado));
      impedimentos = listaImpedimentos || [];
      cadastro = listaUsuarios || [];
      // `GET /efetivo/militares` chama a abreviatura do posto de
      // `tipo_posto_grad` (o nome da coluna do cadastro), e o resto desta tela a
      // chama de `posto_abrev` (o nome que as consultas do efetivo lhe dão). A
      // tradução mora aqui, e não nos dois diálogos: dois lugares lendo dois
      // nomes da mesma coisa é onde a lista de escolha nasceria sem posto.
      usuarios = cadastro
        .filter(u => u.ativo)
        .map(u => ({
          uuid: u.uuid,
          nome_guerra: u.nome_guerra,
          posto_abrev: u.tipo_posto_grad,
          tipo_posto_grad_id: u.tipo_posto_grad_id,
        }))
        .sort((a, b) => (b.tipo_posto_grad_id - a.tipo_posto_grad_id)
          || a.nome_guerra.localeCompare(b.nome_guerra));

      anoFilter.setOptions(
        anosComPassagem(todosPeriodos, { anoCorrente, anoSelecionado })
          .map(a => ({ value: a, label: String(a) }))
      );
      anoFilter.setValue(anoSelecionado);

      montarAvisoProjecao();
      montarResumo(mapaDados.anual || []);
      montarMapa({ semanas: mapaDados.semanas || [], anual: mapaDados.anual || [] });
      montarDivergencias();

      // A restauração vem DEPOIS do desenho: antes dele o documento ainda está
      // curto, e o navegador cortaria a posição pedida.
      if (rolagem > 0 && typeof window.scrollTo === 'function') {
        window.scrollTo(0, rolagem);
      }

      abrirFichaDoLink(mapaDados.anual || []);
    } catch (err) {
      if (disposed) return;
      // NADA DO ANO VELHO SOBREVIVE AO ERRO. O resumo que ficava escrito dizia
      // um percentual e um número de militares de um ano que não é o da tela.
      //
      // NO LUGAR DELE FICA O ERRO, e não a área em branco. O toast some em seis
      // segundos, e a partir daí a tela vazia se lia como "ninguém teve passagem
      // neste ano", que é a afirmação oposta. O aviso fica, e traz o caminho de
      // volta.
      limparTela();
      mapa.appendChild(estadoErro(err, load));
      showError(err.message || 'Erro ao carregar o aproveitamento do efetivo');
    }
  }

  /** `?usuario_uuid=` na rota abre a ficha daquele militar, uma vez só. */
  function abrirFichaDoLink(anual) {
    if (!uuidDestacado || fichaDoLinkAberta) return;
    const alvo = anual.find(m => m.usuario_uuid === uuidDestacado);
    if (!alvo) return;
    fichaDoLinkAberta = true;
    abrirFicha(alvo);
  }

  await load();

  return () => {
    disposed = true;
  };
}
