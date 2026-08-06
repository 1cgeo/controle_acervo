"use strict";

const Joi = require("joi");

const { TIPO_ESCALA } = require("../utils/domain_constants");

const models = {};

// Registros históricos aceitam o formato novo "X-YYYYY" ou o antigo "Xª Edição"
// (espelha o trigger acervo.validate_version)
const VERSAO_HISTORICA_REGEX = /^([0-9]+-[A-Z]{1,5}|[0-9]+ª Edição)$/;

// `data_criacao` e `data_edicao` são DIA DE CALENDÁRIO, e não instante.
//
// Sem o `.raw()`, o Joi converte 'AAAA-MM-DD' num Date de meia-noite UTC, e a
// coluna é TIMESTAMP WITH TIME ZONE: em America/Sao_Paulo (UTC-3) isso vira
// 21:00 do DIA ANTERIOR, e a ficha devolve o dia anterior ao que se digitou.
//
// O custo não é só a data errada na tela. `acervo.versao.data_edicao` é o que
// conta produto entregue no MÊS (`integracaoCtrl.getProdutosFinalizados`, e por
// ele o RPCMTec): a carta editada no dia 1º entra no relatório do mês anterior,
// e ninguém confere um relatório contra a data de cada folha.
//
// Com `.raw()` a validação continua sendo de data (o `.min` segue valendo), mas
// o que sai do Joi é a STRING original, e o Postgres a converte no fuso dele.
//
// O `.iso()` fica JUNTO do `.raw()`, e não é preciosismo: sem ele a string segue
// crua para o Postgres, e '01/08/2026' seria lido como 8 de JANEIRO, porque o
// DateStyle padrão é MDY. É o padrão da casa, o mesmo de `projeto_schema.js` e
// de `mapoteca.pedido`.
const dataCalendario = () => Joi.date().iso().raw();

// `nome`, `mi` e `inom` de `acervo.produto` e `nome` e `orgao_produtor` de
// `acervo.versao` sao VARCHAR(255). Sem o teto aqui, string maior passava pelo
// Joi e estourava no banco: quem chamou recebia 500 (o codigo de "o servidor
// errou") em vez do 400 que diz qual campo esta grande demais. `descricao` fica
// de fora nos dois porque a coluna e TEXT.
const texto255 = () => Joi.string().max(255);

// Espelha o CHECK de acervo.produto: denominador obrigatório apenas para
// escala personalizada (tipo 5), NULL nos demais
const denominadorEscalaEspecial = Joi.alternatives().conditional('tipo_escala_id', {
  is: TIPO_ESCALA.ESCALA_PERSONALIZADA,
  then: Joi.number().integer().strict().required(),
  otherwise: Joi.valid(null).required()
});

models.produtoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: texto255().required(),
  mi: texto255().allow(null, ''),
  inom: texto255().allow(null, ''),
  tipo_escala_id: Joi.number().integer().strict().required(),
  denominador_escala_especial: denominadorEscalaEspecial,
  tipo_produto_id: Joi.number().integer().strict().required(),
  // SEM .default(null): numa atualização, default silencioso apaga a identidade
  // do produto (subtipo 24 = Carta Topográfica Militar). Chave ausente agora
  // significa "não mexe" (o controller preserva o valor gravado); enviar null
  // explicitamente continua sendo a forma de despinar o produto.
  subtipo_produto_id: Joi.number().integer().strict().allow(null),
  descricao: Joi.string().allow('').required(),
  geom: Joi.string().allow(null),
  // TROCA CONJUNTA de produto e versoes. Sem ele, corrigir o subtipo de um
  // produto ja cadastrado era impossivel pela API: mudar o produto batia na
  // guarda das versoes, e mudar a versao batia no gatilho do banco. Nenhum dos
  // dois podia ir primeiro.
  //
  // OPCIONAL e sem `.default(true)`: mudar o subtipo do produto reescreve a
  // identidade de TODA versao dele, e isso nao pode acontecer por descuido de
  // quem so queria corrigir o nome. Quem quer, diz.
  migrar_subtipo_das_versoes: Joi.boolean().default(false)
})

models.versaoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  uuid_versao: Joi.string().uuid(),
  versao: Joi.string().required(),
  nome: texto255().allow(null).required(),
  tipo_versao_id: Joi.number().integer().strict().required(),
  subtipo_produto_id: Joi.number().integer().strict().required(),
  descricao: Joi.string().allow('').required(),
  metadado: Joi.object().required(),
  lote_id: Joi.number().integer().strict().allow(null).required(),
  // Meta do PIT que esta versão cumpre. É o vínculo que CONTA na grade do PIT
  // quando a meta for automática.
  //
  // SEM `.required()` e SEM default: chave ausente significa "não mexe" (o
  // controller preserva o valor gravado), e enviar null é como se desliga o
  // vínculo. Sem isso, o cliente que não conhece o campo apagaria a meta de toda
  // versão que editasse, que é o que o `preserve_omitted` existe para impedir.
  meta_pit_id: Joi.number().integer().strict().allow(null),
  // Demanda Extra-PIT que esta versão materializa. Mesmas regras do
  // `meta_pit_id`: ausente preserva, null desliga.
  //
  // EXCLUSIVA com `meta_pit_id`, e o banco cobra pelo CHECK
  // `versao_plano_ou_excecao`. Aqui a exclusão não é declarada porque o PUT
  // aceita chave ausente: validar as duas juntas no Joi rejeitaria o corpo que
  // manda só uma e preserva a outra, que é o uso normal. O controller confere
  // depois de resolver o que foi preservado.
  demanda_extra_id: Joi.number().integer().strict().allow(null),
  orgao_produtor: texto255().required(),
  // SEM .default([]): na atualização isso zerava as palavras-chave gravadas de
  // quem apenas omitiu a chave. Ausente = preserva (ver o controller).
  palavras_chave: Joi.array().items(Joi.string()).allow(null),
  data_criacao: dataCalendario().required(),
  // Espelha o CHECK data_edicao >= data_criacao de acervo.versao
  data_edicao: dataCalendario().min(Joi.ref('data_criacao')).required(),
  // O mês em que esta versão PROMETE ficar pronta, e de onde sai o PLANEJADO da
  // grade do PIT.
  //
  // MESMAS REGRAS DO `meta_pit_id`, e pelo mesmo motivo: ausente preserva, null
  // apaga. Os dois andam juntos, e o cliente que conhece um e não o outro
  // apagaria metade do vínculo.
  //
  // SEM `.min(Joi.ref('data_criacao'))`, ao contrário de `data_edicao`. Ela é a
  // PROMESSA, e prometer para antes de a versão ter sido criada é atraso, não
  // erro de digitação: o PIT prometeu abril e o trabalho começou em maio. O
  // banco não tem CHECK aqui pela mesma razão.
  data_prevista: dataCalendario().allow(null)
});

models.produtoIds = Joi.object().keys({
  produto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
})

// Correcao do identificador da versao para o que o BDGEx ja publicou.
//
// Nao e um PUT de versao: o uuid_versao segue IMUTAVEL naquele caminho, e por
// bom motivo (o item do pedido aponta a versao por ele). Aqui a troca e o
// PROPOSITO da rota, ela vem em lote (uma carga refeita move dezenas de folhas
// de uma vez), e cada linha carrega a PROVA de onde o numero novo saiu.
models.versaoUuidCorrecao = Joi.object().keys({
  correcoes: Joi.array()
    .items(
      Joi.object().keys({
        versao_id: Joi.number().integer().strict().required(),
        uuid_versao: Joi.string().uuid().required()
      })
    )
    .unique('versao_id')
    .unique('uuid_versao')
    .required()
    .min(1),
  // De onde saiu o identificador novo. Vai para o metadado da versao, e sem ela
  // a correcao viraria um numero trocado sem historia.
  motivo: Joi.string().required()
});

models.versaoIds = Joi.object().keys({
  versao_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
});

// Mover arquivos de uma versao para outra, sem novo upload fisico.
// Usado para separar registros que bundlam duas edicoes: o arquivo da edicao
// errada vai para a versao (em geral historica) daquela edicao. Tambem usado para
// corrigir arquivo carregado no produto/tipo errado (permitir_entre_produtos=true).
models.moverArquivos = Joi.object().keys({
  arquivo_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  versao_id_destino: Joi.number().integer().strict().required(),
  permitir_entre_produtos: Joi.boolean().default(false),
  permitir_esvaziar_origem: Joi.boolean().default(false)
});

// Abre espaco de rotulo para uma edicao recem-descoberta que fica ANTES (ou entre)
// as edicoes ja cadastradas de um produto/subtipo. O rotulo ordinal impresso na carta
// (ou o numero de uma serie "N-SIGLA") nao e confiavel: a data_edicao e que prova que
// duas cartas sao edicoes diferentes, o rotulo e so uma etiqueta a acertar depois.
// A familia "EDICAO" desloca "Nª Edição"; qualquer outra string desloca "N-<familia>"
// (ex. familia="DSG" desloca "1-DSG"/"2-DSG"). As duas familias convivem no mesmo
// produto/subtipo sem interferir uma na outra (cada uma tem sua propria contagem).
models.renumeraVersoes = Joi.object().keys({
  produto_id: Joi.number().integer().strict().required(),
  subtipo_produto_id: Joi.number().integer().strict().required(),
  familia: Joi.string().pattern(/^([A-Z]{1,5}|EDICAO)$/).required(),
  // Dia de calendário, como as outras datas de versão: ela vira a `data_edicao`
  // das versões renumeradas, e recuar um dia aqui as moveria de mês no RPCMTec.
  nova_data_edicao: dataCalendario().required()
});

models.versaoRelacionamento = Joi.object().keys({
  versao_relacionamento: Joi.array()
    .items(
      Joi.object().keys({
        versao_id_1: Joi.number().integer().strict().required(),
        versao_id_2: Joi.number().integer().strict().required(),
        tipo_relacionamento_id: Joi.number().integer().strict().required()
      })
    )
    .required()
    .min(1)
});

models.versaoRelacionamentoAtualizacao = Joi.object().keys({
  versao_relacionamento: Joi.array()
    .items(
      Joi.object().keys({
        id: Joi.number().integer().strict().required(),
        versao_id_1: Joi.number().integer().strict().required(),
        versao_id_2: Joi.number().integer().strict().required(),
        tipo_relacionamento_id: Joi.number().integer().strict().required(),
      })
    )
    .required()
    .min(1)
});

models.versaoRelacionamentoIds = Joi.object().keys({
  versao_relacionamento_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
});

// O VINCULO COM O PLANO ANUAL, aceito nas DUAS rotas de criacao sem arquivo.
//
// ELE FALTAVA, e o efeito era silencioso: o formulario de versao ja oferecia os
// tres campos e o `schemaValidation` tolerante os DESCARTAVA. A pessoa escolhia
// a meta, recebia 201, e a versao nascia fora da conta do PIT. O descarte ia
// para o log e para os "avisos" do envelope, que ninguem le num 201.
//
// AS DUAS ROTAS, e nao so a planejada. A tentacao era restringir o registro
// historico ("o passado nao promete mes"), mas isso ESTREITA o que o time ja
// tinha decidido: os casos de `versao-dialog.test.js` fixam que a historica leva
// a meta, e nada impede registrar como historica uma folha do ano corrente que
// cumpre meta. O ANO continua sendo o filtro real: a grade so conta a versao
// quando o ano da data bate com o da meta, entao uma folha de 1978 apontando
// meta de 2026 simplesmente nao entra na conta.
//
// `data_prevista` NAO leva `.default(null)`, e isso nao e descuido. Medido: em
// `Joi.date().iso().raw()` o default nulo NAO aplica, e a chave simplesmente nao
// aparece no valor validado (sem `.raw()` ela apareceria). Um default que nao
// aplica e pior que default nenhum, porque quem le o schema conta com ele. Quem
// resolve a ausencia e o `def: null` do ColumnSet, no controlador.
const vinculoComOPlano = {
  meta_pit_id: Joi.number().integer().strict().allow(null).default(null),
  // EXCLUSIVA com `meta_pit_id`, e o banco cobra pelo CHECK
  // `versao_plano_ou_excecao`. A exclusao nao se declara aqui: a tela ja limpa um
  // ao escolher o outro, e o CHECK e a rede que pega o resto.
  demanda_extra_id: Joi.number().integer().strict().allow(null).default(null),
  data_prevista: dataCalendario().allow(null)
};

const versaoSemArquivo = Joi.object().keys({
  uuid_versao: Joi.string().uuid().allow(null).required(),
  versao: Joi.string().pattern(VERSAO_HISTORICA_REGEX).required(),
  nome: texto255().allow(null).required(),
  produto_id: Joi.number().integer().strict().required(),
  subtipo_produto_id: Joi.number().integer().strict().required(),
  lote_id: Joi.number().integer().strict().allow(null).required(),
  metadado: Joi.object().required(),
  descricao: Joi.string().allow('').required(),
  orgao_produtor: texto255().required(),
  palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
  data_criacao: dataCalendario().required(),
  data_edicao: dataCalendario().min(Joi.ref('data_criacao')).required(),
  ...vinculoComOPlano
});

// .required().min(1) no ARRAY (no objeto-item, min(1) validaria numero de chaves
// e um array vazio passaria, quebrando depois no insert)
models.versoesHistoricas = Joi.array().items(versaoSemArquivo).required().min(1)

// A versao planejada aceita o MESMO corpo da historica: as duas criam versao sem
// arquivo num produto que ja existe, e o formato do rotulo que o gatilho aceita e
// o mesmo (nenhuma das duas e Regular). Quem separa e a ROTA, e nao o corpo.
models.versoesPlanejadas = models.versoesHistoricas;

// A versao DENTRO do produto novo: sem `produto_id`, que ainda nao existe.
const versaoEmProdutoNovo = Joi.object().keys({
  uuid_versao: Joi.string().uuid().allow(null).required(),
  versao: Joi.string().pattern(VERSAO_HISTORICA_REGEX).required(),
  nome: texto255().allow(null).required(),
  subtipo_produto_id: Joi.number().integer().strict().required(),
  lote_id: Joi.number().integer().strict().allow(null).required(),
  metadado: Joi.object().required(),
  descricao: Joi.string().allow('').required(),
  orgao_produtor: texto255().required(),
  palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
  data_criacao: dataCalendario().required(),
  data_edicao: dataCalendario().min(Joi.ref('data_criacao')).required(),
  ...vinculoComOPlano
});

const produtoNovo = versoes => Joi.object().keys({
  nome: texto255().allow(null).required(),
  mi: texto255().allow(null),
  inom: texto255().allow(null),
  tipo_escala_id: Joi.number().integer().strict().required(),
  denominador_escala_especial: denominadorEscalaEspecial,
  tipo_produto_id: Joi.number().integer().strict().required(),
  // Subtipo que define a identidade do produto (ex.: 24 = Carta Topografica
  // Militar). NULL = produto comum, identidade so por (mi, escala, tipo).
  subtipo_produto_id: Joi.number().integer().strict().allow(null).default(null),
  descricao: Joi.string().allow('').required(),
  geom: Joi.string().required(),
  versoes: Joi.array().items(versoes).min(1).required()
});

models.produtosVersoesHistoricas =
  Joi.array().items(produtoNovo(versaoEmProdutoNovo)).required().min(1);

// A versao planejada aceita o MESMO corpo da historica: os dois criam produto
// mais versao sem arquivo. Quem separa e a ROTA, e nao o corpo.
models.produtosVersoesPlanejadas = models.produtosVersoesHistoricas;

models.produtos = Joi.object().keys({
  produtos: Joi.array().items(
    Joi.object().keys({
      nome: texto255().allow(null).required(),
      mi: texto255().allow(null, '').required(),
      inom: texto255().allow(null, '').required(),
      tipo_escala_id: Joi.number().integer().strict().required(),
      denominador_escala_especial: denominadorEscalaEspecial,
      tipo_produto_id: Joi.number().integer().strict().required(),
      subtipo_produto_id: Joi.number().integer().strict().allow(null).default(null),
      descricao: Joi.string().allow(null, '').required(),
      geom: Joi.string().required()
    })
  ).min(1).required()
})

// Folha do SCN por INOM ou por MI, nunca pelos dois.
//
// O `.xor` e nao dois campos opcionais: com os dois preenchidos a rota teria de
// escolher um em silencio, e com nenhum devolveria a folha de ninguem. O erro do
// Joi ('object.xor') diz na resposta que se informa um OU outro.
//
// `tipo_escala_id` so acompanha o MI, e so vale 100k ou 250k. Nao e enfeite: o
// acervo grava o MI sem zero a esquerda, e sem o preenchimento 549 dos 563 MIs
// de 250k colidem com um MI de 100k (a conta esta em `utils/scn.js`). Sem ele o
// MI nu resolve em 100k, que e o caso comum, e a folha de 250k ficaria
// inalcancavel. Junto do INOM ele e RECUSADO (`.with`), em vez de ignorado: o
// INOM ja diz a escala pela profundidade, e aceitar-e-descartar faria o cliente
// acreditar que pediu uma coisa que a rota nem leu.
models.folhaQuery = Joi.object().keys({
  inom: Joi.string().trim(),
  mi: Joi.string().trim(),
  tipo_escala_id: Joi.number()
    .integer()
    .valid(TIPO_ESCALA.ESCALA_100K, TIPO_ESCALA.ESCALA_250K)
})
  .xor('inom', 'mi')
  .with('tipo_escala_id', 'mi');

module.exports = models;
