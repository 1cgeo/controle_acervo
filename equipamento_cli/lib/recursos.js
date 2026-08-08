'use strict'

const path = require('path')

// Registro dos recursos do modulo equipamento. Cada entrada aponta para as
// CHAVES do modulo de schema da feature no server/, e o CLI le dali o contrato
// (campos, tipos, obrigatorios, filtros). Nada de contrato e copiado para ca: se
// o schema mudar, o CLI muda junto no mesmo commit. Este arquivo so guarda o que
// NAO esta no schema: o caminho da rota, o perfil minimo de cada verbo, a forma
// do CRUD e a escolha de apresentacao.
//
// A forma do CRUD daqui e a REST por id, e nao a da mapoteca:
//   PUT    <base>/:id   com o id na URL, e SUBSTITUINDO a linha inteira;
//   DELETE <base>/:id   um por vez, nunca em lote.
// Um CLI que assumisse a forma da mapoteca (id no corpo, array de ids no delete)
// levaria 404 nos dois.
//
// O require e preguicoso (funcao) para que um schema faltando quebre so o
// comando daquele recurso, e nao o CLI inteiro.

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

/**
 * O modulo de schema VIVO do equipamento, tal como o Express o usa. Tudo que o
 * CLI sabe sobre a forma dos corpos sai daqui, em tempo de execucao.
 */
function carregarSchema () {
  return require(path.join(RAIZ_SERVER, 'equipamento', 'equipamento_schema'))
}

// Todos os recursos saem do mesmo modulo de schema; o que muda por recurso e
// QUAL chave desse modulo vale para criar, atualizar e filtrar a listagem.
function modulo (criar, atualizar, filtro) {
  return () => {
    const models = carregarSchema()
    return {
      criar: models[criar],
      atualizar: models[atualizar],
      listarQuery: filtro ? models[filtro] : null
    }
  }
}

const RECURSOS = {
  bem: {
    nome: 'bem do parque (o equipamento em si)',
    caminho: '/equipamento',
    schema: modulo('equipamentoCriar', 'equipamentoAtualizar', 'listarQuery'),
    // Colunas padrao da listagem compacta. `classe_id`, `tipo_id`,
    // `secao_detentora_id` e `situacao_id` ficam de fora porque a resposta ja
    // traz o NOME resolvido de cada um; os codigos so aparecem com --campos ou
    // --json, que e quem vai encadear.
    //
    // `vida_util_herdada` entra: sem ela, um 120 na coluna de vida util nao diz
    // se o bem declarou a propria ou se pegou a do tipo, e o formulario de
    // edicao mostraria o campo preenchido onde o banco tem nulo.
    colunas: [
      'id', 'nr_patrimonio', 'tipo', 'modelo', 'nr_serie', 'data_entrada_carga',
      'vida_util_meses', 'vida_util_herdada', 'secao_detentora', 'situacao', 'ativo'
    ],
    // A nota de cada rota vem depois de ' :: ' e e alinhada na impressao; o
    // marcador <filtros> vira uma linha propria, com os filtros lidos do Joi.
    rotas: [
      'GET    <base><filtros> :: perfil consulta',
      'GET    <base>/:id :: perfil consulta; traz os QUATRO históricos junto',
      'POST   <base> :: perfil GERENTE',
      'PUT    <base>/:id :: perfil GERENTE; SUBSTITUI a linha inteira',
      'DELETE <base>/:id :: perfil GERENTE'
    ],
    verbos: [
      'equipamento listar [--situacao_id N] [--secao_detentora_id N] [--tipo_id N] [--ativo false]',
      'equipamento ver --id N | --patrimonio 104820700014462',
      'equipamento cadastrar --data \'{...}\'          (gerente)',
      'equipamento alterar --id N --modelo "..."      (gerente; le, mescla e reenvia)',
      'equipamento baixar --id N                      (gerente; grava ativo = false)',
      'equipamento apagar --id N --confirmar N         (gerente)'
    ]
  },

  tipo: {
    nome: 'tipo de equipamento (a tela "Configuração"; cadastro, não domínio)',
    caminho: '/equipamento/tipo',
    schema: modulo('tipoCriar', 'tipoAtualizar'),
    colunas: ['id', 'nome', 'descricao', 'vida_util_meses', 'ativo'],
    // NAO ha GET por id: a lista inteira cabe numa resposta (9 tipos semeados) e
    // o servidor nunca expos a rota. Anunciar um GET /tipo/:id aqui renderia
    // 404 depois da rede.
    semObter: true,
    // ESCREVER E DE GERENTE desde 2026-08-08, e LER continua em consulta. O
    // catalogo carrega a `vida_util_meses` que todo bem sem valor proprio HERDA,
    // entao uma linha alterada aqui muda dezenas de bens de uma vez; mas a
    // leitura fica no piso porque a listagem de bens usa o catalogo para
    // resolver o filtro por tipo.
    rotas: [
      'GET    <base> :: perfil consulta',
      '(sem GET por id: a lista inteira vem de uma vez)',
      'POST   <base> :: perfil GERENTE',
      'PUT    <base>/:id :: perfil GERENTE; SUBSTITUI a linha inteira',
      'DELETE <base>/:id :: perfil GERENTE'
    ],
    verbos: [
      'equipamento tipo listar',
      'equipamento tipo cadastrar --nome "..." [--vida_util_meses 120]   (gerente)',
      'equipamento tipo alterar --id N --ativo false                     (gerente)',
      'equipamento tipo apagar --id N --confirmar N                      (gerente)'
    ]
  },

  indisponibilidade: {
    nome: 'indisponibilidade (o bem PARADO na Divisão)',
    caminho: '/equipamento/indisponibilidade',
    schema: modulo(
      'indisponibilidadeCriar', 'indisponibilidadeAtualizar', 'historicoQuery'
    ),
    historico: true,
    // O que "aberta" quer dizer neste recurso, e o campo que o `fechar` grava.
    // Nos tres primeiros historicos e a data_fim; na transferencia nao ha uma, e
    // e por isso que isto e DADO aqui e nao uma suposicao do comando.
    campoFim: 'data_fim',
    colunas: [
      'id', 'equipamento_id', 'nr_patrimonio', 'modelo', 'data_inicio', 'data_fim',
      'motivo', 'previsao_retorno'
    ],
    perfilEscrita: 'operador'
  },

  afastamento: {
    nome: 'afastamento (o bem cedido a outra OM)',
    caminho: '/equipamento/afastamento',
    schema: modulo('afastamentoCriar', 'afastamentoAtualizar', 'historicoQuery'),
    historico: true,
    campoFim: 'data_fim',
    colunas: [
      'id', 'equipamento_id', 'nr_patrimonio', 'modelo', 'om', 'motivo',
      'data_inicio', 'previsao_termino', 'data_fim'
    ],
    perfilEscrita: 'operador'
  },

  manutencao: {
    nome: 'manutenção (o conserto, com o que ele custou)',
    caminho: '/equipamento/manutencao',
    schema: modulo('manutencaoCriar', 'manutencaoAtualizar', 'historicoQuery'),
    historico: true,
    campoFim: 'data_fim',
    colunas: [
      'id', 'equipamento_id', 'nr_patrimonio', 'indisponibilidade_id',
      'data_inicio', 'data_fim', 'descricao', 'valor', 'valor_orcado',
      'valor_pdr', 'certame'
    ],
    perfilEscrita: 'operador'
  },

  transferencia: {
    nome: 'transferência e descarga (movimentação de patrimônio)',
    caminho: '/equipamento/transferencia',
    schema: modulo('transferenciaCriar', 'transferenciaAtualizar', 'historicoQuery'),
    historico: true,
    // SEM campoFim, e a ausencia e a regra: transferencia nao tem data_fim
    // porque ela nao dura, ela se resolve. O `fechar` nao existe aqui, e o
    // comando diz o que fazer no lugar em vez de inventar um.
    campoFim: null,
    colunas: [
      'id', 'equipamento_id', 'nr_patrimonio', 'tipo', 'situacao', 'om',
      'documento_solicitacao', 'data_solicitacao', 'data_transferencia',
      'transferido_siafi', 'apropriado_siafi', 'publicacao_autorizacao'
    ],
    perfilEscrita: 'gerente'
  }
}

// Como cada historico se chama DENTRO da ficha do bem (GET /:id). O plural e
// irregular em portugues (manutencao -> manutencoes), entao ele e declarado e
// nao derivado: derivar acertaria tres dos quatro e a ficha calaria o quarto.
const CHAVE_NA_FICHA = {
  indisponibilidade: 'indisponibilidades',
  afastamento: 'afastamentos',
  manutencao: 'manutencoes',
  transferencia: 'transferencias'
}

// Os historicos compartilham a MESMA forma de rota e os mesmos verbos; declarar
// as quatro linhas quatro vezes so criaria quatro lugares para uma delas
// divergir sem ninguem notar.
for (const [chave, recurso] of Object.entries(RECURSOS)) {
  if (!recurso.historico) continue
  recurso.chaveFicha = CHAVE_NA_FICHA[chave]
  const perfil = recurso.perfilEscrita.toUpperCase()
  recurso.semObter = true
  recurso.rotas = [
    'GET    <base><filtros> :: perfil consulta',
    '(sem GET por id: a leitura de um lançamento sai da lista, ou da ficha do bem)',
    `POST   <base> :: perfil ${perfil}`,
    `PUT    <base>/:id :: perfil ${perfil}; SUBSTITUI a linha inteira`,
    `DELETE <base>/:id :: perfil ${perfil}`
  ]
  recurso.verbos = recurso.campoFim
    ? [
        `equipamento ${chave} listar [--equipamento_id N] [--aberta]`,
        `equipamento ${chave} abrir --equipamento_id N --data_inicio AAAA-MM-DD ...`,
        `equipamento ${chave} fechar --id N --${recurso.campoFim} AAAA-MM-DD`,
        `equipamento ${chave} editar --id N --<campo> <valor>`,
        `equipamento ${chave} apagar --id N --confirmar N`
      ]
    : [
        `equipamento ${chave} listar [--equipamento_id N] [--aberta]`,
        `equipamento ${chave} lancar --equipamento_id N --tipo_id N --situacao_id N ...`,
        `equipamento ${chave} editar --id N --situacao_id N`,
        `equipamento ${chave} apagar --id N --confirmar N`
      ]
}

// As cinco listas de dominio, que vem juntas numa resposta so de GET /dominio.
// Os nomes sao as CHAVES do objeto que o controlador devolve: e por eles que o
// `equipamento dominio <lista>` recorta o que ja veio, sem gastar outra chamada.
const DOMINIOS = [
  'classe_suprimento',
  'secao_detentora',
  'situacao',
  'situacao_transferencia',
  'tipo_transferencia'
]

// Rotas que nao sao recurso de CRUD: o painel e o relatorio. Ficam aqui, e nao
// escritas dentro dos comandos, para que exista UM lugar que saiba o caminho de
// cada coisa neste modulo.
const CAMINHOS = {
  dominio: '/equipamento/dominio',
  dashboard: '/equipamento/dashboard',
  relatorioDmt: '/equipamento/relatorio/dmt_ods'
}

function obter (chave) {
  const recurso = RECURSOS[chave]
  if (!recurso) {
    throw new Error(
      `Recurso desconhecido: "${chave}". Disponíveis: ${Object.keys(RECURSOS).join(', ')}.`
    )
  }
  return recurso
}

function listarChaves () {
  return Object.keys(RECURSOS)
}

/** As chaves dos quatro historicos, na ordem em que a ficha do bem os mostra. */
function historicos () {
  return Object.keys(RECURSOS).filter(c => RECURSOS[c].historico)
}

module.exports = {
  carregarSchema,
  RECURSOS,
  DOMINIOS,
  CAMINHOS,
  CHAVE_NA_FICHA,
  obter,
  listarChaves,
  historicos
}
