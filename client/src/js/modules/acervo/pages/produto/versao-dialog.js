import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createTextareaField,
  createSelectField,
  createDateField,
  createChipInput,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getTiposVersao,
  getSubtiposProduto,
  getLotes,
  getProjetos,
  criarVersoesPlanejadas,
  criarVersoesHistoricas,
  criarProdutoComVersaoPlanejada,
  criarProdutoComVersaoHistorica,
  atualizarVersao,
} from '@modules/acervo/services/acervo-service.js';
// O PIT e de PLATAFORMA, e nao do modulo acervo: a meta pertence ao plano anual
// da divisao, e a versao so aponta para ela.
import { getMetasPit, getExtraPit } from '@services/plataforma-service.js';
import { abrirAssistenteUpload } from './upload-wizard.js';

/**
 * Criar e editar VERSAO de um produto do acervo.
 *
 * Duas coisas mandam no desenho desta tela, e nenhuma das duas e capricho:
 *
 * 1. O FORMULARIO ESPELHA O GATILHO `acervo.validate_version` ANTES DE ENVIAR.
 *    Sem isso a Carta Topografica Militar passa o formulario inteiro e so quebra
 *    no fim, com 500 generico: o gatilho recusa a versao cujo subtipo diverge do
 *    produto, e quem preencheu nao tem como saber que o campo errado era o do
 *    PRODUTO. E a mesma decisao que o plugin ja tomou em
 *    `ferramentas_acervo/gui/campos_acervo.py` (`conferir_identidade`), e pela
 *    mesma razao: perguntar aqui e a diferenca entre uma frase que diz o que
 *    fazer e um erro generico depois do trabalho todo.
 *
 * 2. OS TRES TIPOS SAO OFERECIDOS, e o que muda entre eles e o CAMINHO da
 *    gravacao, nao o formulario. Regular nasce COM o arquivo e por isso sai
 *    daqui para o assistente de carregamento; Planejada e Registro histórico
 *    nascem sem arquivo e gravam direto, cada uma na sua rota
 *    (`/versao_planejada` e `/versao_historica`), que sao irmas e tem o mesmo
 *    corpo. Um nome por coisa, e nao um inteiro escondido: "promessa de
 *    producao" e "folha que existe e o acervo nao tem o arquivo" sao fatos
 *    diferentes, e o RPCMTec conta produto entregue por tipo de versao.
 *
 *    O tipo GRAVADO entra na lista mesmo quando nao e um dos oferecidos (ver
 *    `montarOpcoesTipo`): sem isso, abrir a edicao de uma versao de tipo que a
 *    web nao cria mostraria o campo vazio e salvar o converteria em silencio.
 */

// dominio.tipo_versao. Espelha server/src/utils/domain_constants.js; o client
// nao importa do servidor, entao o valor vive aqui com o nome que ele tem la.
export const TIPO_VERSAO_REGULAR = 1;
export const TIPO_VERSAO_HISTORICA = 2;
export const TIPO_VERSAO_PLANEJADA = 3;

/**
 * Os TRES tipos que a interface web oferece para criar.
 *
 * A ordem e a do fluxo comum: Regular primeiro (a que nasce com o arquivo),
 * depois as duas que nascem sem ele.
 */
export const TIPOS_OFERECIDOS = [
  TIPO_VERSAO_REGULAR,
  TIPO_VERSAO_PLANEJADA,
  TIPO_VERSAO_HISTORICA,
];

// Os dois formatos que o gatilho aceita. Sao copia literal das expressoes de
// `er/acervo.sql`, inclusive o "ª" e a cedilha: escrever "1a Edicao" aqui
// passaria no formulario e quebraria no banco, que e exatamente o que este
// espelho existe para evitar.
const RE_EDICAO = /^[0-9]+ª Edição$/;
const RE_SIGLA = /^[0-9]+-[A-Z]{1,5}$/;

/**
 * A regra do gatilho `acervo.validate_version`, aplicada ANTES do envio.
 *
 * Devolve `{ campo, mensagem }` da PRIMEIRA regra violada, ou null quando esta
 * bom. Uma de cada vez, e na ORDEM DO GATILHO, de proposito: e assim que a frase
 * que a pessoa le e a mesma que o servidor diria. Mostrar as cinco juntas daria
 * uma lista em que quatro linhas podem ser consequencia da primeira.
 *
 * O `campo` existe para o erro pousar no campo certo. Sem ele, "o subtipo tem
 * que ser o do produto" apareceria no rodape, longe do `<select>` que a pessoa
 * precisa mexer.
 *
 * @param {Object} entrada
 * @param {string} entrada.rotulo - o que vai na coluna `versao`
 * @param {number} entrada.tipoVersaoId
 * @param {number} entrada.subtipoVersaoId
 * @param {number|null} entrada.produtoSubtipoId - subtipo do PRODUTO (null = comum)
 * @param {Array<{code:number, nome:string, define_produto:boolean}>} entrada.subtipos
 * @param {Array<string>} entrada.rotulosExistentes - rotulos ja gravados no produto
 * @param {string|null} entrada.dataCriacao - 'YYYY-MM-DD'
 * @param {string|null} entrada.dataEdicao - 'YYYY-MM-DD'
 * @param {boolean} [entrada.rotuloMudou=true] - false quando se edita sem mexer
 *   no rotulo. O gatilho pula o formato nesse caso (`TG_OP = 'UPDATE' AND NEW.versao
 *   IS NOT DISTINCT FROM OLD.versao`), e o espelho tem de pular junto: ha versao
 *   legada gravada antes do gatilho, e travar a edicao dela aqui recusaria uma
 *   gravacao que o servidor aceita.
 * @returns {{campo:string, mensagem:string}|null}
 */
export function conferirVersaoContraTrigger({
  rotulo,
  tipoVersaoId,
  subtipoVersaoId,
  produtoSubtipoId,
  subtipos = [],
  rotulosExistentes = [],
  dataCriacao,
  dataEdicao,
  rotuloMudou = true,
}) {
  const nomeSubtipo = (code) => {
    const achado = subtipos.find(s => Number(s.code) === Number(code));
    return achado ? achado.nome : `subtipo ${code}`;
  };

  // 1 e 2: coerencia produto <-> subtipo. Vem ANTES de tudo, como no gatilho, e
  // valem inclusive quando o rotulo nao mudou.
  if (produtoSubtipoId !== null && produtoSubtipoId !== undefined
      && Number(subtipoVersaoId) !== Number(produtoSubtipoId)) {
    return {
      campo: 'subtipo_produto_id',
      mensagem: `A versão é do subtipo ${nomeSubtipo(subtipoVersaoId)} e o produto é `
        + `do subtipo ${nomeSubtipo(produtoSubtipoId)}. Os dois têm que ser o mesmo.`,
    };
  }

  const escolhido = subtipos.find(s => Number(s.code) === Number(subtipoVersaoId));
  if (escolhido && escolhido.define_produto
      && Number(produtoSubtipoId) !== Number(subtipoVersaoId)) {
    return {
      campo: 'subtipo_produto_id',
      mensagem: `O subtipo "${escolhido.nome}" exige PRODUTO PRÓPRIO: o subtipo do `
        + 'produto precisa ser esse também. Edite o produto antes, ou cadastre a versão '
        + 'num produto desse subtipo.',
    };
  }

  // A data e um CHECK da tabela, e nao do gatilho, mas quebra do mesmo jeito e
  // no mesmo INSERT. Fica antes do formato porque nao depende dele.
  if (dataCriacao && dataEdicao && dataEdicao < dataCriacao) {
    return {
      campo: 'data_edicao',
      mensagem: 'A data de edição não pode ser anterior à data de criação.',
    };
  }

  // Daqui para baixo o gatilho ja retornou quando o rotulo nao mudou.
  if (!rotuloMudou) return null;

  const texto = String(rotulo || '').trim();
  if (!RE_EDICAO.test(texto) && !RE_SIGLA.test(texto)) {
    return {
      campo: 'versao',
      mensagem: 'Formato inválido. Use "1ª Edição" ou "1-DSG" (número, hífen e de uma a '
        + 'cinco letras maiúsculas).',
    };
  }

  // A sequencia so e cobrada da versao REGULAR no formato N-SIGLA. Historica e
  // planejada nao exigem a anterior, porque as duas sao carga parcial por
  // natureza: a folha planejada nao tem edicao anterior nenhuma.
  if (Number(tipoVersaoId) !== TIPO_VERSAO_REGULAR) return null;
  if (!RE_SIGLA.test(texto)) return null;

  const [, numeroTexto, sigla] = /^([0-9]+)-([A-Z]{1,5})$/.exec(texto);
  const numero = Number(numeroTexto);
  if (numero <= 1) return null;

  const anterior = `${numero - 1}-${sigla}`;
  if (!rotulosExistentes.includes(anterior)) {
    return {
      campo: 'versao',
      mensagem: `Não existe a versão anterior "${anterior}" neste produto. A série `
        + 'N-SIGLA é sequencial: cadastre a anterior primeiro, ou use o rótulo que '
        + 'continua a série já gravada.',
    };
  }

  return null;
}

/**
 * Opcoes do `<select>` de tipo: as de `TIPOS_OFERECIDOS`, MAIS o tipo ja gravado
 * quando ele nao esta entre elas.
 *
 * A entrada extra e o que impede a edicao de uma versao de tipo fora da lista de
 * abrir com o campo vazio e, ao salvar, converte-la em silencio para outro tipo.
 */
function montarOpcoesTipo(tipos, tipoAtual) {
  const nome = (code) => {
    const achado = (tipos || []).find(t => Number(t.code) === Number(code));
    return achado ? achado.nome : `Tipo ${code}`;
  };

  const codigos = [...TIPOS_OFERECIDOS];
  if (tipoAtual && !codigos.includes(Number(tipoAtual))) codigos.push(Number(tipoAtual));

  return codigos.map(code => ({ value: code, label: nome(code) }));
}

/** 'YYYY-MM-DD' a partir do que o servidor devolve (ISO completo ou data). */
const soData = (valor) => (valor ? String(valor).slice(0, 10) : '');

/**
 * Diálogo de criar/editar versão.
 *
 * @param {Object} opcoes
 * @param {{id:number, nome?:string, subtipo_produto_id?:number|null, tipo_produto_id?:number}} opcoes.produto
 * @param {Object|null} [opcoes.versao] - versão da ficha detalhada (edição)
 * @param {Array<Object>} [opcoes.versoesExistentes] - as versões já gravadas no
 *   produto, para a checagem de sequência. Vêm da ficha, que já as carregou:
 *   pedi-las de novo custaria uma requisição para uma informação na mão.
 * @param {Function} [opcoes.onSaved]
 */
export async function openVersaoDialog({
  produto,
  versao = null,
  versoesExistentes = [],
  // O produto que AINDA NAO EXISTE, vindo do formulario de produto quando a
  // pessoa escolheu "Salvar e criar versao". Preenchido, os dois nascem juntos:
  // pelas rotas `/produtos/produto_versao_*` quando a versao nao tem arquivo, ou
  // pelo assistente quando ela e Regular. Gravar o produto antes deixaria uma
  // casca sem versao toda vez que alguem desistisse aqui.
  produtoPendente = null,
  onSaved = null,
} = {}) {
  const edicao = Boolean(versao);
  const produtoSubtipoId = produto.subtipo_produto_id ?? null;
  const rotuloOriginal = edicao ? String(versao.versao || '') : '';

  // Os domínios não bloqueiam a tela: sem eles os `<select>` ficam vazios e a
  // pessoa vê por quê, o que é melhor do que um diálogo que não abre.
  const [tipos, subtipos, lotes, projetos, metas, extras] = await Promise.all([
    getTiposVersao().catch(() => []),
    getSubtiposProduto().catch(() => []),
    getLotes().catch(() => []),
    getProjetos().catch(() => []),
    // Sem `ano`: a lista traz todos os anos, e o rotulo mostra o ano de cada
    // uma. Filtrar pelo ano corrente esconderia a meta certa de quem esta
    // cadastrando uma carta finalizada em dezembro passado.
    getMetasPit().catch(() => []),
    getExtraPit().catch(() => []),
  ]);

  const nomeProjeto = new Map((projetos || []).map(p => [Number(p.id), p.nome]));

  const versaoField = createTextField({
    label: 'Rótulo da versão',
    required: true,
    value: versao?.versao || '',
    placeholder: '1-DSG ou 1ª Edição',
    helpText: 'Formatos aceitos: "1ª Edição" ou "1-DSG"',
  });

  const nomeField = createTextField({
    label: 'Nome',
    value: versao?.nome || '',
    helpText: 'Opcional: em geral a versão herda o nome do produto',
  });

  const tipoField = createSelectField({
    label: 'Tipo de versão',
    required: true,
    options: montarOpcoesTipo(tipos, versao?.tipo_versao_id),
    value: versao?.tipo_versao_id ?? TIPO_VERSAO_PLANEJADA,
    placeholder: 'Selecione...',
    onChange: () => pintarAvisoTipo(),
  });

  /**
   * Subtipos que fazem sentido para ESTE produto.
   *
   * A lista inteira tem 29 entradas e cobre os treze tipos de produto: oferecer
   * todas convida a gravar "Modelo Digital de Superfície" como subtipo de uma
   * versão de Carta Topográfica. Nada no banco impede -- a coluna só referencia
   * `dominio.subtipo_produto` --, e por isso o servidor persegue esse caso DEPOIS
   * do fato, no invariante `3h` ("subtipo da versao fora do esperado para o
   * tipo_produto", em `acervo/invariantes.js`). Filtrar aqui fecha na origem.
   *
   * O subtipo JÁ GRAVADO entra na lista mesmo quando não pertence ao tipo, pela
   * mesma razão que o tipo de versão faz isso (ver `montarOpcoesTipo`): o `3h` é
   * REVISAR, e não DEFECT, porque há combinação legada tolerada. Sem esta
   * exceção, abrir a edição de uma dessas versões mostraria o campo vazio e
   * salvar trocaria o subtipo em silêncio.
   */
  const subtipoDoTipo = (() => {
    const todos = subtipos || [];
    const tipoProduto = produto?.tipo_produto_id;
    if (tipoProduto === null || tipoProduto === undefined) return todos;

    const doTipo = todos.filter(s => Number(s.tipo_id) === Number(tipoProduto));
    const gravado = versao?.subtipo_produto_id;
    if (gravado !== null && gravado !== undefined
        && !doTipo.some(s => Number(s.code) === Number(gravado))) {
      const achado = todos.find(s => Number(s.code) === Number(gravado));
      if (achado) return [...doTipo, achado];
    }
    // Tipo sem subtipo cadastrado nao pode deixar o campo vazio: ele e NOT NULL.
    return doTipo.length ? doTipo : todos;
  })();

  // O subtipo da versão é NOT NULL no banco. Quando o produto tem subtipo, ele
  // manda: o gatilho recusa qualquer outro, então o campo já nasce com ele.
  const subtipoField = createSelectField({
    label: 'Subtipo de produto',
    required: true,
    options: subtipoDoTipo.map(s => ({ value: s.code, label: s.nome })),
    value: versao?.subtipo_produto_id ?? produtoSubtipoId ?? '',
    helpText: produtoSubtipoId !== null
      ? 'O produto tem subtipo próprio, e a versão tem que usar o mesmo'
      : 'A lista traz os subtipos do tipo deste produto',
  });

  const orgaoField = createTextField({
    label: 'Órgão produtor',
    required: true,
    value: versao?.orgao_produtor || '1º CGEO',
  });

  // Lote com o projeto no rótulo: "Lote 3" sozinho não distingue os lotes de
  // dois projetos diferentes, e é o par que a pessoa conhece.
  const loteField = createSelectField({
    label: 'Lote',
    options: (lotes || []).map(l => ({
      value: l.id,
      label: nomeProjeto.has(Number(l.projeto_id))
        ? `${nomeProjeto.get(Number(l.projeto_id))} · ${l.nome}`
        : l.nome,
    })),
    value: versao?.lote_id ?? '',
    placeholder: 'Sem lote',
    helpText: 'O lote diz de que produção esta versão saiu',
  });

  // --- O que esta versão CUMPRE no plano anual ------------------------------
  //
  // Sem estes dois campos, a única forma de ligar uma versão ao PIT era o plugin
  // do QGIS ou SQL na mão, e a grade do PIT conta por `INNER JOIN pit.meta ON
  // mm.id = v.meta_pit_id`: versão sem meta não conta, e fica pronta fora da
  // conta do plano.
  //
  // Os dois são EXCLUSIVOS, e o banco cobra isso (CHECK
  // `versao_plano_ou_excecao`): a versão cumpre uma meta prometida no PIT, ou
  // materializa uma demanda que entrou fora dele. Marcar um limpa o outro aqui,
  // para o erro não aparecer só no salvar.
  const rotuloMeta = (m) => {
    const partes = [`${m.ano}`, `Meta ${m.numero_meta}`];
    if (m.item) partes.push(`item ${m.item}`);
    const cabeca = partes.join(' · ');
    return m.descricao ? `${cabeca} — ${m.descricao}` : cabeca;
  };

  const metaField = createSelectField({
    label: 'Meta do PIT',
    options: (metas || []).map(m => ({ value: m.id, label: rotuloMeta(m) })),
    value: versao?.meta_pit_id ?? '',
    placeholder: 'Não cumpre meta do PIT',
    helpText: 'A grade do PIT conta esta versão na meta escolhida, pelo ANO da '
      + 'data de edição. Meta de outro ano não entra na conta.',
    onChange: () => {
      if (metaField.getValue() !== null) extraField.setValue(null);
    },
  });

  const extraField = createSelectField({
    label: 'Demanda Extra-PIT',
    options: (extras || []).map(e => ({
      value: e.id,
      label: `${e.ano} · ${e.descricao || `Demanda ${e.id}`}`,
    })),
    value: versao?.demanda_extra_id ?? '',
    placeholder: 'Não é Extra-PIT',
    helpText: 'Para a produção que entrou fora do plano anual. Exclui a meta do PIT.',
    onChange: () => {
      if (extraField.getValue() !== null) metaField.setValue(null);
    },
  });

  const palavrasField = createChipInput({
    label: 'Palavras-chave',
    values: versao?.palavras_chave || [],
    helpText: 'Enter ou vírgula confirma cada etiqueta',
  });

  // AS DUAS DATAS PRECISAM DIZER O QUE SAO. Elas chegavam ao
  // operador sem uma palavra, e confundi-las e o erro classico do acervo: a de
  // EDICAO e a que o `pit_execucao_ctrl` usa para decidir o mes e o ano da
  // producao, entao trocar uma pela outra move a carta de mes na grade do PIT
  // sem erro nenhum na tela. Seis outros campos deste mesmo formulario ja
  // tinham helpText, e justo estas duas nao.
  //
  // A TERCEIRA DATA NAO ESTA AQUI de proposito: `data_cadastramento` e o
  // carimbo de quando a versao entrou no sistema, e quem a grava e o banco
  // (DEFAULT CURRENT_TIMESTAMP). Nao ha o que o operador digite nela.
  const criacaoField = createDateField({
    label: 'Data de criação',
    required: true,
    value: soData(versao?.versao_data_criacao ?? versao?.data_criacao),
    helpText: 'A data do DADO, e não do arquivo. Use a data da fonte ou do '
      + 'levantamento que originou esta versão.',
  });

  const edicaoField = createDateField({
    label: 'Data de edição',
    required: true,
    value: soData(versao?.versao_data_edicao ?? versao?.data_edicao),
    helpText: 'A data em que a versão ficou PRONTA. Ela decide o mês e o ano '
      + 'que contam no PIT e nos relatórios.',
  });

  // A TERCEIRA DATA, e a única que fala do FUTURO. As duas acima são o que
  // aconteceu; esta é o que se prometeu, e é dela que sai o PLANEJADO da grade
  // do PIT.
  //
  // Ela NÃO é sobrescrita quando a versão fica pronta, e é isso que impede o
  // plano de ser reescrito pelo fato. Antes o planejado saía da data prometida
  // pelo LOTE, e nos 19 lotes que a tinham ela era igual à data de fim: a meta
  // 1.3 prometia 48 folhas em agosto e a grade mostrava 49 em junho.
  const previstaField = createDateField({
    label: 'Data prevista',
    value: soData(versao?.data_prevista),
    helpText: 'O mês em que esta folha PROMETE ficar pronta. É daqui que sai o '
      + 'planejado do PIT, e ela não muda quando a versão fica pronta.',
  });

  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: versao?.versao_descricao ?? versao?.descricao ?? '',
  });

  // Metadado é JSONB e o servidor exige um OBJETO. O campo é texto porque não há
  // esquema fixo para ele: cada carga guarda o que a origem trouxe. Vazio vira
  // `{}`, que é o que quase toda versão cadastrada pela web tem.
  const metadadoAtual = versao?.versao_metadado ?? versao?.metadado ?? null;
  const metadadoField = createTextareaField({
    label: 'Metadado (JSON)',
    rows: 3,
    value: metadadoAtual && Object.keys(metadadoAtual).length
      ? JSON.stringify(metadadoAtual, null, 2)
      : '',
    helpText: 'Deixe vazio para {}',
  });

  /**
   * O aviso do tipo escolhido.
   *
   * Ele diz duas coisas que a lista sozinha não diz: por que Regular não salva
   * por aqui, e por que "Registro histórico" não está na lista. As duas ausências
   * pareceriam defeito da tela.
   */
  const aviso = el('div', { className: 'versao-form__aviso' });

  // Declarada aqui, e preenchida so depois do `openModal`: `pintarAvisoTipo`
  // roda ANTES de o modal existir (para o aviso ja nascer certo), e um `const`
  // declarado la embaixo daria erro de zona morta temporal ao ser lido daqui.
  let janela = null;

  /**
   * O botao de confirmar muda de nome quando o tipo e REGULAR.
   *
   * "Salvar" mentiria: a Regular ainda nao entra no acervo aqui, porque falta o
   * arquivo. O rotulo tem de dizer para onde o clique leva, senao a pessoa
   * acredita ter terminado e fecha o assistente que abriu em seguida.
   */
  function pintarRotuloDoBotao(tipo) {
    if (!janela) return;
    const botoes = janela.element.querySelectorAll('.modal__footer .btn');
    const confirmar = botoes[botoes.length - 1];
    if (!confirmar) return;
    confirmar.textContent = (!edicao && tipo === TIPO_VERSAO_REGULAR)
      ? 'Continuar para os arquivos'
      : 'Salvar';
  }

  /**
   * O que cada tipo significa, em uma frase.
   *
   * Os tres nascem do MESMO formulario e so o caminho da gravacao muda, entao a
   * frase e o unico lugar em que a diferenca aparece antes do clique. Sem ela, a
   * escolha vira um numero: "Planejada" e "Registro histórico" preenchem os
   * mesmos campos e gravam sem arquivo, e nada na tela diria qual usar.
   */
  const EXPLICACAO = {
    [TIPO_VERSAO_REGULAR]:
      'Regular é a versão que nasce COM o arquivo. Preencha os campos abaixo e o '
      + 'botão leva ao carregamento, onde os arquivos sobem para o volume. A versão '
      + 'só entra no acervo depois que todos subirem.',
    [TIPO_VERSAO_PLANEJADA]:
      'Planejada é a folha que ainda vai ser produzida: nasce sem arquivo, e o '
      + 'arquivo entra nesta mesma versão quando a produção terminar.',
    [TIPO_VERSAO_HISTORICA]:
      'Registro histórico é a folha que existe no mundo e o acervo registra sem ter '
      + 'o arquivo: edição antiga, carta de outro órgão. Ela não é promessa de '
      + 'produção, e o RPCMTec não a conta como produto entregue.',
  };

  function pintarAvisoTipo() {
    const tipo = Number(tipoField.getValue());
    pintarRotuloDoBotao(tipo);

    aviso.className = 'versao-form__aviso';
    aviso.replaceChildren(
      el('p', {
        textContent: EXPLICACAO[tipo]
          || 'Esta versão já existe com este tipo, e editá-la não o altera.',
      }),
      // A carga em LOTE continua fora daqui: esta tela cadastra uma versao de
      // cada vez, e o acervo legado entra por dezenas de folhas por vez.
      el('p', {
        className: 'versao-form__aviso-nota',
        textContent: 'Para cadastrar muitas versões de uma vez, o caminho continua '
          + 'sendo o plugin do QGIS ou o CLI: esta tela grava uma por vez.',
      })
    );
  }

  pintarAvisoTipo();

  const content = el('div', { className: 'form-grid' }, [
    versaoField.element,
    tipoField.element,
    el('div', { className: 'form-grid__full' }, [aviso]),
    nomeField.element,
    subtipoField.element,
    orgaoField.element,
    loteField.element,
    metaField.element,
    extraField.element,
    criacaoField.element,
    edicaoField.element,
    // A data prometida fica LOGO DEPOIS das duas do fato, e não ao lado da meta:
    // as três são datas da mesma folha, e a comparação entre o prometido e o
    // acontecido é o que a pessoa precisa ver de uma vez.
    previstaField.element,
    el('div', { className: 'form-grid__full' }, [palavrasField.element]),
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    el('div', { className: 'form-grid__full' }, [metadadoField.element]),
  ]);

  const campos = {
    versao: versaoField,
    tipo_versao_id: tipoField,
    subtipo_produto_id: subtipoField,
    orgao_produtor: orgaoField,
    data_criacao: criacaoField,
    data_edicao: edicaoField,
    metadado: metadadoField,
  };

  let salvando = false;

  janela = openModal({
    title: edicao ? 'Editar versão' : `Nova versão de ${produto.nome || 'produto'}`,
    content,
    width: '720px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (salvando) return;

          Object.values(campos).forEach(c => c.setError(null));

          const rotulo = versaoField.getValue();
          const tipoVersaoId = Number(tipoField.getValue());
          const subtipoVersaoId = subtipoField.getValue();
          const orgao = orgaoField.getValue();
          const dataCriacao = criacaoField.getValue();
          const dataEdicao = edicaoField.getValue();

          // Obrigatórios primeiro, e todos de uma vez: são independentes entre
          // si, e apontar um por vez faria a pessoa salvar cinco vezes.
          let valido = true;
          if (!rotulo) {
            versaoField.setError('Informe o rótulo da versão');
            valido = false;
          }
          if (!tipoVersaoId) {
            tipoField.setError('Escolha o tipo de versão');
            valido = false;
          }
          if (subtipoVersaoId === null || subtipoVersaoId === '') {
            subtipoField.setError('Escolha o subtipo de produto');
            valido = false;
          }
          if (!orgao) {
            orgaoField.setError('Informe o órgão produtor');
            valido = false;
          }
          if (!dataCriacao) {
            criacaoField.setError('Informe a data de criação');
            valido = false;
          }
          if (!dataEdicao) {
            edicaoField.setError('Informe a data de edição');
            valido = false;
          }

          let metadado = {};
          const metadadoTexto = metadadoField.getValue();
          if (metadadoTexto) {
            try {
              const lido = JSON.parse(metadadoTexto);
              if (!lido || typeof lido !== 'object' || Array.isArray(lido)) {
                throw new Error('não é objeto');
              }
              metadado = lido;
            } catch {
              metadadoField.setError('O metadado tem que ser um objeto JSON, como {"origem": "DSG"}');
              valido = false;
            }
          }

          if (!valido) return;

          const falha = conferirVersaoContraTrigger({
            rotulo,
            tipoVersaoId,
            subtipoVersaoId: Number(subtipoVersaoId),
            produtoSubtipoId,
            subtipos,
            rotulosExistentes: (versoesExistentes || [])
              .filter(v => !edicao || Number(v.versao_id ?? v.id) !== Number(versao.id ?? versao.versao_id))
              .map(v => String(v.versao)),
            dataCriacao,
            dataEdicao,
            rotuloMudou: !edicao || rotulo !== rotuloOriginal,
          });

          if (falha) {
            const campo = campos[falha.campo];
            if (campo) campo.setError(falha.mensagem);
            else showError(falha.mensagem);
            return;
          }

          // O que os DOIS corpos têm em comum. O que difere fica em cada ramo,
          // porque as duas rotas têm chaves diferentes e o servidor DESCARTA a
          // chave que não conhece: mandar `produto_id` no PUT ou
          // `tipo_versao_id` no POST viraria um aviso e um campo não gravado.
          const corpo = {
            versao: rotulo,
            nome: nomeField.getValue() || null,
            subtipo_produto_id: Number(subtipoVersaoId),
            descricao: descricaoField.getValue(),
            metadado,
            lote_id: loteField.getValue() === null ? null : Number(loteField.getValue()),
            // Os dois seguem SEMPRE, inclusive como null: no PUT o servidor
            // preserva a chave OMITIDA (`preserveOmitted`), então omiti-los
            // impediria desligar a versão de uma meta escolhida por engano.
            // Mandar null explícito é o que desliga, e é o contrato da rota.
            meta_pit_id: metaField.getValue() === null ? null : Number(metaField.getValue()),
            demanda_extra_id: extraField.getValue() === null
              ? null
              : Number(extraField.getValue()),
            orgao_produtor: orgao,
            palavras_chave: palavrasField.getValue(),
            data_criacao: dataCriacao,
            data_edicao: dataEdicao,
            // Mesma regra dos dois vínculos acima: segue SEMPRE, inclusive como
            // null, senão não haveria como apagar uma promessa digitada errada.
            data_prevista: previstaField.getValue() || null,
          };

          // Versão REGULAR não se grava aqui: ela nasce com o arquivo, e o
          // servidor não tem rota que a crie sem ele (`produto_ctrl.js:874-882`).
          // O formulário já validou tudo, então o corpo segue pronto para o
          // assistente, que só cuida dos arquivos e do envio. Digitar a versão
          // de novo lá seria uma segunda cópia do espelho do gatilho.
          if (!edicao && tipoVersaoId === TIPO_VERSAO_REGULAR) {
            close();
            abrirAssistenteUpload({
              // Com produto pendente os dois nascem juntos, na rota que os cria
              // numa transacao so; sem ele, a versao entra num produto que ja
              // existe. A tela do assistente e a MESMA nos dois.
              ...(produtoPendente
                ? { modo: 'produto', produto: produtoPendente }
                : { modo: 'versao', produtoId: Number(produto.id) }),
              produtoNome: produto.nome,
              versao: {
                uuid_versao: null,
                tipo_versao_id: TIPO_VERSAO_REGULAR,
                ...corpo,
              },
              onConcluido: onSaved,
            });
            return;
          }

          salvando = true;
          try {
            if (edicao) {
              await atualizarVersao({
                id: Number(versao.versao_id ?? versao.id),
                tipo_versao_id: tipoVersaoId,
                ...corpo,
              });
              showSuccess('Versão atualizada com sucesso');
            } else {
              // Planejada e Registro histórico gravam pelo MESMO corpo, em rotas
              // irmãs. A rota é escolhida pelo tipo, e não um `tipo_versao_id`
              // dentro do corpo: as duas rotas o FIXAM no servidor, e mandá-lo
              // aqui seria um campo que o servidor descarta -- e que, descartado
              // em silêncio, faria esta tela acreditar ter gravado o que mandou.
              //
              // Corpo em ARRAY: as rotas aceitam lote, e mandar um item é o caso
              // de uma tela que cadastra uma versão de cada vez.
              const historica = tipoVersaoId === TIPO_VERSAO_HISTORICA;

              // O CORPO É O MESMO NAS DUAS ROTAS, inclusive o vínculo com o
              // plano anual (meta, Extra-PIT e data prevista). Quem separa é a
              // rota, e não o corpo.
              const versaoNova = { uuid_versao: null, ...corpo };

              if (produtoPendente) {
                // Produto e versao numa transacao so. O corpo destas rotas e o
                // produto com as `versoes` dentro, e nao os dois lado a lado.
                const criarJunto = historica
                  ? criarProdutoComVersaoHistorica
                  : criarProdutoComVersaoPlanejada;
                await criarJunto([{ ...produtoPendente, versoes: [versaoNova] }]);
                showSuccess(historica
                  ? 'Produto e versão de registro histórico criados com sucesso'
                  : 'Produto e versão planejada criados com sucesso');
              } else {
                const criar = historica ? criarVersoesHistoricas : criarVersoesPlanejadas;
                await criar([{ ...versaoNova, produto_id: Number(produto.id) }]);
                showSuccess(historica
                  ? 'Versão de registro histórico criada com sucesso'
                  : 'Versão planejada criada com sucesso');
              }
            }
            close();
            if (onSaved) onSaved();
          } catch (erro) {
            // O servidor recusa o que a tela não tem como saber (o rótulo que
            // outra pessoa gravou há um segundo, por exemplo). A mensagem dele
            // sobe como está: ela já diz o que aconteceu.
            showError(erro.message || 'Erro ao salvar a versão');
          } finally {
            salvando = false;
          }
        },
      },
    ],
  });

  // O aviso rodou antes de a janela existir, entao o rotulo do botao acerta agora.
  pintarRotuloDoBotao(Number(tipoField.getValue()));
}
