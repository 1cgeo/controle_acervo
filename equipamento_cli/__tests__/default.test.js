'use strict'

// A ARMADILHA DO `.default(...)`, que ja custou caro, e onde ela mora HOJE.
//
// Em 2026-08-08 descobrimos que `acervo_cli editar produto` estava INTEIRAMENTE
// quebrado por causa de um `.default(false)`: o campo com default some da saida
// de quem trata default como AUSENCIA, e num PUT que SUBSTITUI a linha ele volta
// ao default e reverte o que estava gravado. O valor errado entra calado, porque
// ninguem o digitou.
//
// Sao CINCO campos assim neste modulo, e os cinco respondem perguntas de sim ou
// nao que nao tem terceiro estado:
//   equipamento.ativo                default true   (falso = bem BAIXADO)
//   equipamento.patrimonio_pendente  default false  (verdadeiro = numero por conferir)
//   tipo.ativo                       default true
//   transferencia.transferido_siafi  default false
//   transferencia.apropriado_siafi   default false
//
// EM 2026-09-05 OS CINCO SAIRAM DO SCHEMA DE ATUALIZACAO (achado S3-05) e ficaram
// so no de CRIACAO, e o controlador passou a preservar a COLUNA quando a chave
// falta (`ativo = COALESCE($<ativo>, ativo)` no bem e no tipo, e a opcao
// `preservarSeAusente` do historico nos dois SIAFI). O default no PUT era o
// defeito em pessoa: dai o censo abaixo cobrar ZERO em toda atualizacao, e cobrar
// os cinco onde eles ainda existem. Zero ali NAO e falta de cobertura, e sim o
// contrato; um `.default()` que reaparecer num schema de atualizacao traz o
// defeito de volta, e o caso o acusa.
//
// O QUE ESTES CASOS GUARDAM, E O QUE ELES NAO GUARDAM. Eles substituem a rede,
// entao provam o ciclo do CLI: dado um registro lido que TRAZ o campo, o PUT o
// reenvia inteiro em vez de mandar uma linha pela metade. Falsificado desligando
// o reaproveitamento em `corpo.recortar`, e ai varios casos ficam vermelhos.
//
// Eles NAO provam que a rota devolve a coluna, porque a resposta aqui e escrita
// a mao. Que `SELECT_EQUIPAMENTO` (equipamento_ctrl.js) traz `patrimonio_pendente`
// foi conferido por leitura do fonte, e nao por este arquivo.
//
// O que protege e o ciclo LER-MESCLAR-REENVIAR dos comandos de alteracao. Estes
// casos rodam esse ciclo de ponta a ponta, com a rede substituida.

const { test } = require('node:test')
const assert = require('node:assert')

const http = require('../lib/http')
const esquema = require('../lib/schema')
const corpoLib = require('../lib/corpo')
const { obter, carregarSchema } = require('../lib/recursos')
const comandoBem = require('../comandos/bem')
const comandoHistorico = require('../comandos/historico')

const models = carregarSchema()
const CFG = { server: 'http://servidor-de-teste', token: 'tk' }

/**
 * Substitui a rede por um mapa 'METODO /caminho' -> resposta, e devolve o
 * registro de tudo o que foi chamado. Nenhum byte sai da maquina.
 */
async function comRede (respostas, fn) {
  const original = http.autenticada
  const chamadas = []
  http.autenticada = async (cfg, metodo, caminho, opcoes = {}) => {
    chamadas.push({ metodo, caminho, corpo: opcoes.corpo })
    const chave = `${metodo} ${caminho}`
    if (!(chave in respostas)) {
      throw new Error(`chamada inesperada: ${chave}`)
    }
    return respostas[chave]
  }
  try {
    return await fn(chamadas)
  } finally {
    http.autenticada = original
  }
}

const executar = (cmd, posicionais, flags = {}) =>
  cmd.executar({ _: posicionais, flags }, CFG)

/** O corpo do primeiro PUT que saiu. */
const corpoDoPut = (chamadas) => chamadas.find(c => c.metodo === 'PUT').corpo

// ---------------------------------------------------------------------------
// O que o schema declara
// ---------------------------------------------------------------------------

test('os CINCO defaults do modulo vivem na CRIACAO, e o CLI os enxerga', () => {
  assert.deepStrictEqual(
    esquema.camposComDefault(models.equipamentoCriar),
    [{ nome: 'patrimonio_pendente', valor: false }, { nome: 'ativo', valor: true }]
  )
  assert.deepStrictEqual(
    esquema.camposComDefault(models.transferenciaCriar),
    [{ nome: 'transferido_siafi', valor: false }, { nome: 'apropriado_siafi', valor: false }]
  )
  assert.deepStrictEqual(
    esquema.camposComDefault(models.tipoCriar),
    [{ nome: 'ativo', valor: true }]
  )
})

test('e a ATUALIZACAO nao tem nenhum: o numero certo aqui e ZERO', () => {
  // Zero nao e falta de cobertura, e sim o contrato novo. Em 2026-09-05 os tres
  // schemas de ATUALIZACAO redeclararam SEM default os cinco campos, e o
  // controlador passou a preservar a COLUNA: `ativo = COALESCE($<ativo>, ativo)`
  // no bem e no tipo, e o `preservarSeAusente` do historico nos dois SIAFI. O
  // default no PUT era o defeito em pessoa, porque ele GRAVA: um PUT sem a chave
  // revertia o bem baixado, apagava a marca de patrimonio por conferir e dizia
  // ao SIAFI que a transferencia nao tinha sido feita.
  //
  // Este caso e o alarme do caminho de volta: um `.default()` que reaparecer num
  // schema de atualizacao traz o defeito junto, e sem barulho nenhum.
  for (const nome of [
    'equipamentoAtualizar', 'tipoAtualizar', 'transferenciaAtualizar',
    'indisponibilidadeAtualizar', 'manutencaoAtualizar', 'afastamentoAtualizar'
  ]) {
    assert.deepStrictEqual(
      esquema.camposComDefault(models[nome]), [],
      nome + ' voltou a ter default: o PUT o gravaria por cima do que esta la'
    )
  }
})

const CORPO_MINIMO = {
  nr_patrimonio: '104820700014462',
  classe_id: 6,
  tipo_id: 1,
  modelo: 'TOPCON CTS-3007',
  secao_detentora_id: 1
}

test('DEFAULT E VALOR, e nao ausencia: na CRIACAO o Joi o grava em quem o omite', () => {
  // A prova crua do modo de falha, e ela continua valendo onde o default mora:
  // um corpo de CRIACAO sem `ativo` sai da validacao COM `ativo: true`. Num POST
  // isso e o desejado, porque bem novo nasce em carga; num PUT era o defeito, e
  // e por isso que o default saiu de la.
  const r = esquema.validarCorpo(models.equipamentoCriar, CORPO_MINIMO)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.valor.ativo, true, 'o default nao foi aplicado; o teste perdeu o sentido')
  // E o CLI ACUSA quem foi preenchido sem ninguem digitar.
  assert.deepStrictEqual(r.preenchidos, ['patrimonio_pendente=false', 'ativo=true'])
})

test('a variancia: o MESMO corpo no PUT nao ganha campo nenhum de graca', () => {
  // Sem default, `ativo` e `patrimonio_pendente` simplesmente NAO viajam, e o
  // servidor preserva a coluna. Ate 2026-09-05 este mesmo corpo chegava ao banco
  // com `ativo: true` e reativava um bem baixado que ninguem mandou reativar.
  const r = esquema.validarCorpo(models.equipamentoAtualizar, CORPO_MINIMO)
  assert.strictEqual(r.ok, true)
  assert.ok(!('ativo' in r.valor), 'o PUT voltou a carregar `ativo` sem ninguem digitar')
  assert.ok(!('patrimonio_pendente' in r.valor))
  assert.deepStrictEqual(r.preenchidos, [])
})

const LEITURA_SEM_OS_BOOLEANOS = {
  nr_patrimonio: '104820700014462', classe_id: 6, tipo_id: 1,
  modelo: 'TOPCON', secao_detentora_id: 1
}

test('a maquinaria segue inteira: campo ausente COM default vira aviso, nunca silencio', () => {
  // O caso do acervo_cli: a rota de leitura nao devolvia a coluna, e o ciclo
  // reenviava o default. `recortar` nomeia o campo e o valor que seria gravado.
  // A funcao aqui e a MESMA que os tres comandos de alteracao chamam; o schema
  // de CRIACAO entra por ser o unico deste modulo que ainda tem default, e e
  // assim que a maquinaria continua coberta depois de 2026-09-05.
  const { base, ausentesComDefault } = corpoLib.recortar(
    models.equipamentoCriar, LEITURA_SEM_OS_BOOLEANOS
  )
  assert.ok(!('ativo' in base))
  assert.ok(!('patrimonio_pendente' in base))
  assert.deepStrictEqual(ausentesComDefault, ['patrimonio_pendente=false', 'ativo=true'])
})

test('no PUT nao ha o que avisar: a chave ausente PRESERVA o gravado', () => {
  // O contrato novo. A leitura que nao traz a coluna nao produz aviso nenhum,
  // porque o campo nao viaja e o servidor o preserva por COALESCE. Avisar aqui
  // seria assustar com um risco que deixou de existir, e aviso que nao descreve
  // nada e o que faz os outros pararem de ser lidos.
  const { base, ausentesComDefault } = corpoLib.recortar(
    models.equipamentoAtualizar, LEITURA_SEM_OS_BOOLEANOS
  )
  assert.ok(!('ativo' in base))
  assert.ok(!('patrimonio_pendente' in base))
  assert.deepStrictEqual(ausentesComDefault, [])
})

// ---------------------------------------------------------------------------
// `ativo`: o bem baixado que nao pode reviver sozinho
// ---------------------------------------------------------------------------

const BEM_BAIXADO = {
  id: 12,
  nr_patrimonio: '104821500017429',
  classe_id: 6, classe: 'VI',
  tipo_id: 4, tipo: 'Conjunto de Rastreamento Satelital GNSS',
  modelo: 'Spectra SP 60',
  nr_serie: 'SP60-001',
  data_entrada_carga: '2023-10-17T03:00:00.000Z',
  vida_util_meses: 96, vida_util_herdada: false,
  secao_detentora_id: 1, secao_detentora: 'Cia Lev',
  ativo: false,
  situacao_id: 5, situacao: 'Baixado',
  observacao: 'Fora de uso'
}

test('alterar o modelo de um bem BAIXADO nao o reativa', () => {
  // O PUT sem `ativo` gravaria `true` (o default) e o bem voltaria para a carga,
  // com a situacao derivada saindo de 'Baixado'. Nada na tela acusaria.
  return comRede({
    'GET /equipamento/12': { dados: BEM_BAIXADO },
    'PUT /equipamento/12': { message: 'Equipamento atualizado.' }
  }, async (chamadas) => {
    await executar(comandoBem, ['alterar'], { id: '12', modelo: 'Spectra SP 60 (rev)' })

    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(corpo.ativo, false, 'o bem baixado foi reativado pelo default')
    assert.strictEqual(corpo.modelo, 'Spectra SP 60 (rev)')
    // E o resto da linha sobreviveu: um PUT parcial apagaria nr_serie e
    // observacao junto.
    assert.strictEqual(corpo.nr_serie, 'SP60-001')
    assert.strictEqual(corpo.observacao, 'Fora de uso')
    // A data volta recortada em dia de calendario: o servidor a devolve como
    // timestamp ISO e o schema a regrava crua numa coluna DATE.
    assert.strictEqual(corpo.data_entrada_carga, '2023-10-17')
  })
})

test('reativar um bem e um ato EXPLICITO: --ativo true', () => {
  return comRede({
    'GET /equipamento/12': { dados: BEM_BAIXADO },
    'PUT /equipamento/12': { message: 'ok' }
  }, async (chamadas) => {
    const r = await executar(comandoBem, ['alterar'], { id: '12', ativo: 'true' })
    assert.strictEqual(corpoDoPut(chamadas).ativo, true)
    // E o antes/depois aparece, porque e a mudanca que se quer ver antes de gravar.
    // O "antes" sai do registro lido (booleano, logo 'não'); o "depois" e o texto
    // que veio da linha de comando, ainda nao convertido pelo Joi.
    assert.ok(/^ {2}ativo: não -> /m.test(r.texto), r.texto)
  })
})

test('`baixar` grava ativo = false e preserva o resto da linha', () => {
  const emCarga = { ...BEM_BAIXADO, ativo: true, situacao_id: 1, situacao: 'Disponível' }
  return comRede({
    'GET /equipamento/12': { dados: emCarga },
    'PUT /equipamento/12': { message: 'ok' }
  }, async (chamadas) => {
    await executar(comandoBem, ['baixar'], { id: '12' })
    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(corpo.ativo, false)
    assert.strictEqual(corpo.nr_serie, 'SP60-001')
    // E nada de `situacao_id` no corpo: ela e DERIVADA de `ativo`.
    assert.ok(!('situacao_id' in corpo))
  })
})

// ---------------------------------------------------------------------------
// `patrimonio_pendente`: o aviso que nao pode se apagar sozinho
// ---------------------------------------------------------------------------
//
// A coluna existe porque o Relatorio DMT de 2026-08-03 declarava o MESMO numero
// de patrimonio em duas linhas, de bens diferentes. O bem entra com numero
// provisorio e o sistema carrega o aviso ate alguem conferir a etiqueta.
//
// O default `false` e o mesmo modo de falha do `ativo`, e ao contrario: aqui o
// PUT sem o campo APAGARIA o aviso. O bem passaria a se declarar conferido sem
// que ninguem tivesse olhado a etiqueta, e a secao "Patrimonio por conferir" do
// painel esvaziaria sozinha.
const BEM_PENDENTE = {
  id: 55,
  nr_patrimonio: 'PROVISORIO-55',
  patrimonio_pendente: true,
  classe_id: 6, classe: 'VI',
  tipo_id: 4, tipo: 'Conjunto de Rastreamento Satelital GNSS',
  modelo: 'RUIDE RTK QUASAR R93I',
  nr_serie: 'R93I-001',
  data_entrada_carga: '2023-10-17T03:00:00.000Z',
  vida_util_meses: 120, vida_util_herdada: true,
  secao_detentora_id: 1, secao_detentora: 'Cia Lev',
  ativo: true,
  situacao_id: 1, situacao: 'Disponível',
  observacao: null
}

test('alterar o modelo NAO apaga a marca de patrimonio por conferir', () => {
  return comRede({
    'GET /equipamento/55': { dados: BEM_PENDENTE },
    'PUT /equipamento/55': { message: 'ok' }
  }, async (chamadas) => {
    await executar(comandoBem, ['alterar'], { id: '55', modelo: 'RUIDE RTK QUASAR R93I (rev)' })

    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(
      corpo.patrimonio_pendente, true,
      'o aviso de patrimonio por conferir foi apagado pelo default'
    )
    assert.strictEqual(corpo.modelo, 'RUIDE RTK QUASAR R93I (rev)')
    // E o bem continua ativo: os dois defaults do mesmo schema nao se atrapalham.
    assert.strictEqual(corpo.ativo, true)
  })
})

test('conferir a etiqueta e ato EXPLICITO: --patrimonio_pendente false', () => {
  return comRede({
    'GET /equipamento/55': { dados: BEM_PENDENTE },
    'PUT /equipamento/55': { message: 'ok' }
  }, async (chamadas) => {
    await executar(comandoBem, ['alterar'], {
      id: '55', nr_patrimonio: '104821500017430', patrimonio_pendente: 'false'
    })

    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(corpo.patrimonio_pendente, false)
    assert.strictEqual(corpo.nr_patrimonio, '104821500017430')
  })
})

test('`baixar` um bem ja baixado nao gasta um PUT', () => {
  return comRede({
    'GET /equipamento/12': { dados: BEM_BAIXADO }
  }, async (chamadas) => {
    const r = await executar(comandoBem, ['baixar'], { id: '12' })
    assert.ok(r.texto.includes('já está baixado'))
    assert.ok(!chamadas.some(c => c.metodo === 'PUT'))
  })
})

// ---------------------------------------------------------------------------
// Os dois SIAFI: a pergunta de sim ou nao que nao tem terceiro estado
// ---------------------------------------------------------------------------

const TRANSFERENCIA = {
  id: 8,
  equipamento_id: 5,
  nr_patrimonio: '104820700014462',
  modelo: 'TOPCON CTS-3007',
  tipo_id: 2, tipo: 'Cessão',
  situacao_id: 2, situacao: 'Autorizada',
  om: '3º BPE',
  documento_solicitacao: 'DIEx 123-S/3',
  data_solicitacao: '2026-06-01T03:00:00.000Z',
  data_transferencia: null,
  transferido_siafi: true,
  apropriado_siafi: true,
  publicacao_autorizacao: 'BI 12/2026',
  descricao: null
}

test('editar a SITUACAO de uma transferencia nao zera os dois SIAFI', () => {
  // Este e o caso que o `.default(false)` estraga: mandar so a situacao faria os
  // dois voltarem a `false`, e o SIAFI passaria a dizer que a transferencia nao
  // foi feita, num registro em que ela foi.
  return comRede({
    'GET /equipamento/transferencia': { dados: [TRANSFERENCIA] },
    'PUT /equipamento/transferencia/8': { message: 'ok' }
  }, async (chamadas) => {
    await executar(comandoHistorico, ['transferencia', 'editar'], { id: '8', situacao_id: '3' })

    const corpo = corpoDoPut(chamadas)
    // O Joi CONVERTE o texto da linha de comando no tipo declarado: a rota cobra
    // `Joi.number().integer()`, e um '3' em aspas levaria 400 no strict.
    assert.strictEqual(corpo.situacao_id, 3)
    assert.strictEqual(corpo.transferido_siafi, true, 'transferido_siafi voltou ao default')
    assert.strictEqual(corpo.apropriado_siafi, true, 'apropriado_siafi voltou ao default')
    // E o resto da linha inteira, que um PUT parcial apagaria.
    assert.strictEqual(corpo.om, '3º BPE')
    assert.strictEqual(corpo.documento_solicitacao, 'DIEx 123-S/3')
    assert.strictEqual(corpo.publicacao_autorizacao, 'BI 12/2026')
    assert.strictEqual(corpo.data_solicitacao, '2026-06-01')
  })
})

test('marcar UM dos SIAFI nao arrasta o outro', () => {
  const semSiafi = { ...TRANSFERENCIA, transferido_siafi: false, apropriado_siafi: false }
  return comRede({
    'GET /equipamento/transferencia': { dados: [semSiafi] },
    'PUT /equipamento/transferencia/8': { message: 'ok' }
  }, async (chamadas) => {
    // `--transferido_siafi` SOZINHA vale `true`: o parser a devolve como boolean
    // e quem traduz e o TIPO declarado no Joi, nao uma lista de booleanas do CLI.
    await executar(comandoHistorico, ['transferencia', 'editar'], { id: '8', transferido_siafi: true })

    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(corpo.transferido_siafi, true)
    assert.strictEqual(corpo.apropriado_siafi, false)
  })
})

test('os campos que nao mudam NAO viram linha de mudanca', () => {
  return comRede({
    'GET /equipamento/transferencia': { dados: [TRANSFERENCIA] },
    'PUT /equipamento/transferencia/8': { message: 'ok' }
  }, async () => {
    const r = await executar(comandoHistorico, ['transferencia', 'editar'], { id: '8', om: '1º BPE' })
    const mudancas = r.texto.split('\n').filter(l => l.startsWith('  '))
    assert.deepStrictEqual(mudancas, ['  om: 3º BPE -> 1º BPE'])
  })
})

test('corpo identico ao gravado nao gasta um PUT', () => {
  return comRede({
    'GET /equipamento/transferencia': { dados: [TRANSFERENCIA] }
  }, async (chamadas) => {
    const r = await executar(comandoHistorico, ['transferencia', 'editar'], { id: '8', om: '3º BPE' })
    assert.ok(r.texto.includes('igual ao gravado'))
    assert.ok(!chamadas.some(c => c.metodo === 'PUT'))
  })
})

test('a leitura sem os SIAFI nao avisa mais nada, e o PUT vai sem eles', () => {
  // Ate 2026-09-05 este caso cobrava um aviso, porque o default do PUT gravaria
  // `false` nos dois e o SIAFI passaria a dizer que a transferencia nao foi
  // feita. Agora o schema de atualizacao nao tem default: as duas chaves nao
  // viajam, o `preservarSeAusente` do controlador monta o COALESCE e o que
  // estava gravado fica. Nao ha risco a anunciar, e por isso nao ha aviso.
  const semOsSiafi = { ...TRANSFERENCIA }
  delete semOsSiafi.transferido_siafi
  delete semOsSiafi.apropriado_siafi

  return comRede({
    'GET /equipamento/transferencia': { dados: [semOsSiafi] },
    'PUT /equipamento/transferencia/8': { message: 'ok' }
  }, async (chamadas) => {
    const r = await executar(comandoHistorico, ['transferencia', 'editar'], { id: '8', om: '1º BPE' })
    const avisos = r.avisos.join(' | ')
    assert.ok(!avisos.includes('O PUT gravaria o default'), avisos)

    // O que prova a preservacao e a AUSENCIA das duas chaves no corpo: mandar
    // `false` de volta seria justamente o que se quer evitar.
    const corpo = corpoDoPut(chamadas)
    assert.ok(!('transferido_siafi' in corpo), 'o CLI mandou um SIAFI que a leitura nao trouxe')
    assert.ok(!('apropriado_siafi' in corpo))
    assert.strictEqual(corpo.om, '1º BPE')
  })
})

// ---------------------------------------------------------------------------
// O recorte da leitura: o que a resposta traz e o corpo nao aceita
// ---------------------------------------------------------------------------

test('as colunas que a LEITURA acrescenta nao voltam no corpo', () => {
  // `nr_patrimonio` e `modelo` vem junto na lista de historico, e o nome
  // resolvido dos dominios (`tipo`, `situacao`) tambem. O validador do modulo e
  // ESTRITO: mandar uma delas de volta e 400 na cara.
  const { base } = corpoLib.recortar(models.transferenciaAtualizar, TRANSFERENCIA)
  for (const intruso of ['id', 'nr_patrimonio', 'modelo', 'tipo', 'situacao']) {
    assert.ok(!(intruso in base), `${intruso} voltaria no corpo e levaria 400`)
  }
  assert.ok('tipo_id' in base && 'situacao_id' in base)
})

test('as datas voltam como dia de calendario, e nao como timestamp', () => {
  // O servidor devolve '2026-06-01T03:00:00.000Z' e o schema aceita a string de
  // volta com .raw(), gravando-a CRUA numa coluna DATE. O recorte e do PREFIXO:
  // em UTC-3 a meia-noite local serializa como 'AAAA-MM-DDT03:00:00Z', e o
  // prefixo e o dia certo.
  const { base } = corpoLib.recortar(models.transferenciaAtualizar, TRANSFERENCIA)
  assert.strictEqual(base.data_solicitacao, '2026-06-01')
  assert.strictEqual(base.data_transferencia, null)
})
