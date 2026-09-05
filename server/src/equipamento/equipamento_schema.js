'use strict'

const Joi = require('joi')

const models = {}

// DIA DE CALENDARIO, e nao instante. Sao ONZE colunas DATE neste modulo
// (`equipamento.data_entrada_carga`, as tres de `indisponibilidade`, as tres de
// `afastamento`, as duas de `manutencao` e as duas de `transferencia`), e todas
// passam por aqui.
//
// `.iso()` porque sem ele '01/08/2026' vira 8 de janeiro: o Joi cai no parser
// tolerante do JavaScript, que le o primeiro numero como MES. `.raw()` porque
// sem ele o Joi converte a string em Date de meia-noite UTC, e a coluna DATE em
// UTC-3 guarda o DIA ANTERIOR. Com `.raw()` a string 'AAAA-MM-DD' chega inteira
// ao banco e nenhum fuso entra no caminho.
const dataCalendario = () => Joi.date().iso().raw()

// `data_fim >= data_inicio`, que espelha os CHECK `*_fim_apos_inicio` do DDL. A
// mensagem sai em portugues: a do Joi diria 'must be greater than or equal to
// "ref:data_inicio"', que e o que a tela mostraria para quem lanca.
//
// O `.allow(null)` vem DEPOIS do `.min()` de proposito: nulo e o lancamento
// ABERTO (a indisponibilidade que nao terminou), e ele nao se compara com nada.
const dataFim = (rotuloFim, rotuloInicio, campoInicio = 'data_inicio') =>
  dataCalendario()
    .min(Joi.ref(campoInicio))
    .allow(null)
    .messages({
      'date.min': `A ${rotuloFim} deve ser igual ou posterior à ${rotuloInicio}`
    })

// O `id` de rota. `.positive()` porque SERIAL e BIGSERIAL comecam em 1, e um
// `/0` ou um `/-3` sao erro de quem chamou, nao um 404 depois de ir ao banco.
models.idParams = Joi.object().keys({
  id: Joi.number().integer().positive().required()
})

// --- Consultas --------------------------------------------------------------

// Os quatro filtros da lista de bens. Todos opcionais: sem nenhum, sai o acervo
// inteiro (105 bens medidos em 2026-08-08, que cabe numa resposta).
//
// `situacao_id` filtra a situacao DERIVADA de hoje, que nao e coluna de tabela
// nenhuma: ela sai de `equipamento.situacao_em(CURRENT_DATE)`. Ver o controlador.
models.listarQuery = Joi.object().keys({
  situacao_id: Joi.number().integer().positive(),
  secao_detentora_id: Joi.number().integer().positive(),
  tipo_id: Joi.number().integer().positive(),
  ativo: Joi.boolean()
})

// A lista SOLTA de cada historico, que e o que a tela de lancamento abre.
//
// `aberta=true` quer dizer "sem `data_fim`": o afastamento que ainda nao voltou,
// a indisponibilidade que ninguem fechou. Em `transferencia` nao existe
// `data_fim`, e la o filtro le a SITUACAO -- ver `equipamento_ctrl.js`.
models.historicoQuery = Joi.object().keys({
  equipamento_id: Joi.number().integer().positive(),
  aberta: Joi.boolean()
})

// --- Tipo de equipamento ----------------------------------------------------

// O CADASTRO de tipo (`id` SERIAL), e nao um dominio de code fixo: a Divisao
// cadastra tipo novo pela tela. Por isso ele nao entra em
// `utils/domain_constants.js`.
const camposTipo = {
  nome: Joi.string().max(255).required(),
  descricao: Joi.string().allow(null, ''),
  // A vida util DO TIPO, que o bem HERDA quando nao declara a propria. Ver o
  // COALESCE do SELECT em `equipamento_ctrl.js`.
  vida_util_meses: Joi.number().integer().positive().allow(null),
  ativo: Joi.boolean().default(true)
}

models.tipoCriar = Joi.object().keys(camposTipo)

// NA CRIACAO O DEFAULT E LEGITIMO; NA ATUALIZACAO ELE E PERDA SILENCIOSA.
//
// O PUT reescreve a linha INTEIRA, e ali default nao e ausencia: ele GRAVA. Um
// corpo com so os campos obrigatorios e sem `ativo` faria o Joi por `true`, o
// UPDATE gravar, e o bem BAIXADO voltar ao parque com 200 e sem aviso nenhum. O
// mesmo vale para `patrimonio_pendente`, cujo `false` apagaria a marca que o
// Relatorio DMT le para escrever "Patrimonio por conferir", e para os dois
// SIAFI da transferencia, que poriam de novo em transito contabil um bem ja
// apropriado.
//
// A saida e a mesma de `mapoteca_schema.js`: o schema de ATUALIZACAO redeclara
// sem default o campo que tem um, e o controller preserva a COLUNA quando a
// chave nao vem (`COALESCE($<campo>, campo)`). Redeclarar aqui e mudar o
// COALESCE la andam JUNTOS: sem o COALESCE, o campo ausente viraria NULL contra
// uma coluna NOT NULL.
//
// As DUAS pontas de hoje mandam os campos sempre (a tela e o `equipamento_cli`,
// que ainda avisa sobre ausentes com default), entao isto nao conserta bug
// visto: fecha o vao para a proxima ponta (carga, integracao, curl).
models.tipoAtualizar = Joi.object().keys({
  ...camposTipo,
  ativo: Joi.boolean()
})

// --- O bem ------------------------------------------------------------------

const camposEquipamento = {
  // `.trim()` porque 17 das 105 celulas de patrimonio da planilha da Secao sao
  // texto, e algumas terminam em '\n'. O numero e a UNIQUE da tabela: espaco
  // sobrando faria dois cadastros do mesmo bem conviverem.
  nr_patrimonio: Joi.string().trim().max(30).required(),
  // "O NUMERO ACIMA NAO FOI CONFERIDO". Ele existe porque a fonte erra: no
  // Relatorio DMT de 2026-08-03 duas linhas declaram o mesmo patrimonio, e sao
  // dois bens diferentes. O bem entra com numero provisorio e marcado, e a marca
  // cai quando alguem conferir a etiqueta e gravar o numero certo.
  //
  // `default(false)` e nao `required()`: o caso normal e o numero conferido, e
  // cliente antigo que nao mande o campo continua cadastrando bem valido.
  patrimonio_pendente: Joi.boolean().default(false),
  classe_id: Joi.number().integer().required(),
  tipo_id: Joi.number().integer().required(),
  modelo: Joi.string().max(255).required(),
  nr_serie: Joi.string().max(255).allow(null, ''),
  data_entrada_carga: dataCalendario().allow(null),
  // NULO NAO E ZERO: nulo quer dizer "vale a do tipo". Ver `vida_util_herdada`
  // na resposta da lista.
  vida_util_meses: Joi.number().integer().positive().allow(null),
  secao_detentora_id: Joi.number().integer().required(),
  // FALSO E O BEM BAIXADO, e a situacao derivada o mostra como 'Baixado' (o
  // degrau 50, o mais alto). Nao ha exclusao logica separada disto.
  ativo: Joi.boolean().default(true),
  observacao: Joi.string().allow(null, '')
}

models.equipamentoCriar = Joi.object().keys(camposEquipamento)

// Sem os defaults de `patrimonio_pendente` e `ativo`: ver a nota do
// `tipoAtualizar` acima.
models.equipamentoAtualizar = Joi.object().keys({
  ...camposEquipamento,
  patrimonio_pendente: Joi.boolean(),
  ativo: Joi.boolean()
})

// --- Os quatro historicos ---------------------------------------------------

// `equipamento_id` E OBRIGATORIO NA CRIACAO e OPCIONAL na atualizacao, nos
// quatro. Na atualizacao ele nao e obrigatorio porque o formulario da FICHA do
// bem edita um lancamento sem reafirmar de quem ele e; quando vem, ele vale (um
// lancamento digitado no bem errado se conserta sem apagar e recriar), e quando
// falta, o UPDATE preserva o dono por COALESCE. Ver `equipamento_ctrl.js`.
const donoObrigatorio = Joi.number().integer().positive().required()
const donoOpcional = Joi.number().integer().positive()

const camposIndisponibilidade = {
  data_inicio: dataCalendario().required(),
  data_fim: dataFim('data de fim', 'data de início'),
  motivo: Joi.string().required(),
  // O que o gestor PROMETE, e nao o que aconteceu. Ela e a coluna 18 da planilha
  // da Secao quando nao ha descarga solicitada -- ver o relatorio DMT.
  previsao_retorno: dataCalendario().allow(null)
}

models.indisponibilidadeCriar = Joi.object().keys({
  equipamento_id: donoObrigatorio,
  ...camposIndisponibilidade
})
models.indisponibilidadeAtualizar = Joi.object().keys({
  equipamento_id: donoOpcional,
  ...camposIndisponibilidade
})

const camposAfastamento = {
  // A OM que esta com o bem. Texto livre, e nao FK: as OMs que aparecem na
  // planilha da Secao ('3º BPE') nao sao cadastro deste sistema.
  om: Joi.string().max(255).required(),
  motivo: Joi.string().required(),
  data_inicio: dataCalendario().required(),
  previsao_termino: dataCalendario().allow(null),
  data_fim: dataFim('data de fim', 'data de início')
}

models.afastamentoCriar = Joi.object().keys({
  equipamento_id: donoObrigatorio,
  ...camposAfastamento
})
models.afastamentoAtualizar = Joi.object().keys({
  equipamento_id: donoOpcional,
  ...camposAfastamento
})

const camposManutencao = {
  // A indisponibilidade que esta manutencao explica. OPCIONAL: ha conserto que
  // nao tira o bem de operacao (revisao preventiva), e ha bem parado sem que
  // ninguem tenha aberto manutencao ainda.
  indisponibilidade_id: Joi.number().integer().positive().allow(null),
  data_inicio: dataCalendario().required(),
  data_fim: dataFim('data de fim', 'data de início'),
  descricao: Joi.string().allow(null, ''),
  // AS TRES COLUNAS DE DINHEIRO sao as colunas 15, 16 e 17 da planilha da Secao,
  // e as tres sao VALOR, inclusive `valor_pdr`: a unica linha real preenchida
  // traz 'Previsto em PDR R$600,00'. `positive()` espelha o CHECK do DDL, que
  // recusa zero e negativo: manutencao de graca nao se lanca com valor 0, se
  // lanca sem valor.
  valor: Joi.number().positive().precision(2).allow(null),
  valor_orcado: Joi.number().positive().precision(2).allow(null),
  valor_pdr: Joi.number().positive().precision(2).allow(null),
  // O certame por onde a compra do conserto anda ('Contrata+Brasil'). Texto
  // livre: a licitacao do orcamento e outra coisa, com outro ciclo.
  certame: Joi.string().max(255).allow(null, '')
}

models.manutencaoCriar = Joi.object().keys({
  equipamento_id: donoObrigatorio,
  ...camposManutencao
})
models.manutencaoAtualizar = Joi.object().keys({
  equipamento_id: donoOpcional,
  ...camposManutencao
})

const camposTransferencia = {
  tipo_id: Joi.number().integer().required(),
  situacao_id: Joi.number().integer().required(),
  om: Joi.string().max(255).allow(null, ''),
  documento_solicitacao: Joi.string().max(255).allow(null, ''),
  data_solicitacao: dataCalendario().allow(null),
  data_transferencia: dataCalendario().allow(null),
  // OS DOIS SIAFI SAO NOT NULL no banco, com default FALSE: a pergunta que eles
  // respondem ('ja foi transferido no SIAFI?') nao tem terceiro estado.
  transferido_siafi: Joi.boolean().default(false),
  apropriado_siafi: Joi.boolean().default(false),
  publicacao_autorizacao: Joi.string().max(255).allow(null, ''),
  descricao: Joi.string().allow(null, '')
}

models.transferenciaCriar = Joi.object().keys({
  equipamento_id: donoObrigatorio,
  ...camposTransferencia
})
// Sem os defaults dos dois SIAFI: ver a nota do `tipoAtualizar` acima.
models.transferenciaAtualizar = Joi.object().keys({
  equipamento_id: donoOpcional,
  ...camposTransferencia,
  transferido_siafi: Joi.boolean(),
  apropriado_siafi: Joi.boolean()
})

module.exports = models
