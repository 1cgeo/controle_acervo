'use strict'

// Gestao de identidade. E o comando de maior raio de explosao do SCA: o que se
// faz aqui vale em TODOS os modulos de uma vez, e o servidor le o banco a cada
// requisicao (verifyPerfil), entao desativar alguem tem efeito no mesmo segundo.
//
// Por isso ele tem um guardrail que os CLIs irmaos nao precisam ter: as
// operacoes em LOTE (resetar senha, editar lista) e as irreversiveis (excluir)
// resolvem os uuid para NOME antes de pedir confirmacao. Um uuid nao diz nada a
// ninguem; "vai resetar a senha de 3 pessoas: Silva, Souza, Oliveira" diz.
// Confirmar sem saber quem sao e o modo tipico de estragar acesso de gente de
// verdade.
//
// Resolver os nomes custa uma requisicao a mais, porque `GET /usuarios` e
// `verifyAdmin`. Vale a pena: e barata perto de confirmar as cegas, e quem chama
// estas rotas ja e administrador de qualquer forma.
//
// O --dry-run vem SEMPRE antes da exigencia de confirmacao. Exigir --confirmar
// para poder OLHAR a requisicao inverte o guardrail, e a propria recusa oferece
// o --dry-run como saida.

const fs = require('fs')

const { obter, montarCaminho } = require('../lib/recursos')
const esquema = require('../lib/schema')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

const recurso = () => obter('usuario')

// Campos cujo VALOR nunca sai na saida, nem em --dry-run. O eco de um corpo de
// criacao com a senha em claro vai parar em transcricao e em log.
const SEGREDOS = ['senha', 'senha_atual', 'senha_nova']

/**
 * Dependencias de rede, injetaveis. Os testes exercitam o guardrail (quem e
 * afetado, o que a confirmacao exige) sem subir servidor: o alvo do teste e a
 * DECISAO, e nao o transporte.
 */
const PADRAO = {
  listarUsuarios: async cfg => {
    const r = await http.autenticada(cfg, 'GET', '/usuarios')
    return Array.isArray(r.dados) ? r.dados : []
  },
  listarModulos: async cfg => {
    const r = await http.autenticada(cfg, 'GET', '/usuarios/dominio/modulo')
    return Array.isArray(r.dados) ? r.dados : []
  },
  listarNiveis: async cfg => {
    const r = await http.autenticada(cfg, 'GET', '/usuarios/dominio/tipo_perfil')
    return Array.isArray(r.dados) ? r.dados : []
  }
}

// ---------------------------------------------------------------------------
// Corpo e validacao
// ---------------------------------------------------------------------------

function lerCorpo (flags) {
  if (flags.data && flags['data-file']) {
    throw new Error('Use --data OU --data-file, nunca os dois.')
  }
  if (flags['data-file'] && flags['data-file'] !== true) {
    const conteudo = fs.readFileSync(flags['data-file'], 'utf8')
    try {
      return JSON.parse(conteudo)
    } catch (e) {
      throw new Error(`${flags['data-file']} nao contem JSON valido: ${e.message}`)
    }
  }
  if (flags.data && flags.data !== true) {
    try {
      return JSON.parse(flags.data)
    } catch (e) {
      throw new Error(`--data nao e JSON valido: ${e.message}`)
    }
  }
  return null
}

/** Copia do corpo com os segredos substituidos, para o eco do --dry-run. */
function ecoSeguro (corpo) {
  if (!corpo || typeof corpo !== 'object') return corpo
  if (Array.isArray(corpo)) return corpo.map(ecoSeguro)
  const copia = { ...corpo }
  for (const chave of SEGREDOS) {
    if (chave in copia) copia[chave] = '***'
  }
  if (Array.isArray(copia.usuarios)) copia.usuarios = copia.usuarios.map(ecoSeguro)
  return copia
}

/** Valida o corpo e devolve o normalizado, ou lanca com o contrato junto. */
function validar (schemaJoi, corpo, acao) {
  const r = esquema.validarCorpo(schemaJoi, corpo)
  const avisos = []

  if (r.descartados.length) {
    // O servidor valida o corpo com stripUnknown: chave com nome errado some
    // sem erro e a resposta e 200. Sem este aviso, "achei que gravei" e
    // indistinguivel de "gravei".
    avisos.push(
      'Campos REMOVIDOS do corpo antes do envio (o servidor tambem os descartaria, ' +
      `em silencio): ${r.descartados.join(', ')}.\n` +
      '        Confira o nome em: efetivo schema usuario'
    )
  }

  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      schemaJoi, r.erros, `contrato completo: efetivo schema usuario   (operacao ${acao})`
    ))
    erro.jaFormatado = true
    if (avisos.length) erro.avisos = avisos
    throw erro
  }

  return { corpo: r.valor, avisos }
}

// ---------------------------------------------------------------------------
// Quem sera atingido
// ---------------------------------------------------------------------------

/** O rotulo que identifica a pessoa para um humano, na ordem em que ele le. */
function rotuloPessoa (u) {
  if (!u) return null
  const identidade = [u.tipo_posto_grad, u.nome_guerra || u.nome].filter(Boolean).join(' ')
  const login = u.login ? ` (${u.login})` : ''
  return (identidade + login).trim() || u.uuid || null
}

/**
 * Resolve uma lista de uuid para quem eles sao.
 * Devolve { conhecidos: [{uuid, rotulo, ativo, administrador, perfis}], desconhecidos, indisponivel }.
 */
async function resolverPessoas (cfg, uuids, deps) {
  let usuarios = []
  try {
    usuarios = await deps.listarUsuarios(cfg)
  } catch (e) {
    return { conhecidos: [], desconhecidos: uuids, indisponivel: true }
  }

  const porUuid = new Map(usuarios.map(u => [u.uuid, u]))
  const conhecidos = []
  const desconhecidos = []

  for (const uuid of uuids) {
    const u = porUuid.get(uuid)
    if (!u) {
      desconhecidos.push(uuid)
      continue
    }
    conhecidos.push({
      uuid,
      rotulo: rotuloPessoa(u) || uuid,
      ativo: u.ativo,
      administrador: u.administrador,
      senha_definida: u.senha_definida,
      perfis: u.perfis || {}
    })
  }

  return { conhecidos, desconhecidos, indisponivel: false }
}

/**
 * Bloco que torna o raio de explosao concreto antes de agir.
 *
 * Distingue os dois casos que parecem iguais e nao sao: "consultei a listagem e
 * este uuid NAO existe" (erro provavel na lista) contra "nao consegui consultar"
 * (nao sei nada sobre estes uuid). Confundir os dois faria o CLI afirmar um fato
 * que ele nao apurou.
 */
function blocoAfetados (titulo, pessoas) {
  const linhas = [titulo, '']
  for (const p of pessoas.conhecidos) {
    const marcas = []
    if (p.administrador) marcas.push('ADMINISTRADOR')
    if (p.ativo === false) marcas.push('ja inativo')
    linhas.push(`  ${p.rotulo}   (${p.uuid})${marcas.length ? '   [' + marcas.join(', ') + ']' : ''}`)
  }

  if (pessoas.indisponivel) {
    for (const u of pessoas.desconhecidos) linhas.push(`  (nao verificado)   ${u}`)
    linhas.push('')
    linhas.push('  A listagem nao respondeu, entao NAO foi possivel conferir de quem sao')
    linhas.push('  estes uuid. Isso nao quer dizer que nao existam: quer dizer que voce')
    linhas.push('  estaria confirmando as cegas.')
  } else {
    for (const u of pessoas.desconhecidos) linhas.push(`  ??? NAO ENCONTRADO   ${u}`)
  }
  return linhas
}

/** Erro ja formatado, para o roteador imprimir sem o prefixo [erro]. */
function recusa (linhas, avisos) {
  const erro = new Error(Array.isArray(linhas) ? linhas.join('\n') : linhas)
  erro.jaFormatado = true
  if (avisos && avisos.length) erro.avisos = avisos
  return erro
}

// ---------------------------------------------------------------------------
// Perfil por modulo
// ---------------------------------------------------------------------------

/**
 * Traduz "acervo=operador" ou "acervo=2" em [modulo, nivel], contra os DOMINIOS
 * VIVOS do servidor. O par nome/codigo nao e copiado para ca: modulo novo entra
 * com um INSERT em `dominio.modulo` (e a tabela existe justamente para isso), e
 * uma lista aqui envelheceria calada.
 */
function normalizarNivel (bruto, niveis) {
  const texto = String(bruto).trim()
  if (/^\d+$/.test(texto)) return Number(texto)

  const alvo = texto.toLowerCase()
  const achado = niveis.find(n => String(n.nome).toLowerCase() === alvo)
  if (!achado) {
    const opcoes = niveis.map(n => `${n.code}=${n.nome}`).join(', ')
    throw new Error(
      `Nivel de perfil desconhecido: "${bruto}". Aceitos: ${opcoes || '1, 2, 3'}.`
    )
  }
  return achado.code
}

function conferirModulo (nome, modulos) {
  const nomes = modulos.map(m => m.nome_abrev)
  if (nomes.length && !nomes.includes(nome)) {
    throw new Error(
      `Modulo desconhecido: "${nome}". Aceitos: ${nomes.join(', ')} ` +
      '(a chave do mapa `perfis` e o nome_abrev de dominio.modulo).'
    )
  }
}

/**
 * Monta o mapa que vai no corpo. `null` REMOVE o acesso; modulo que nao aparece
 * no mapa fica como esta (quem decide isso e o servidor, e por isso revogar
 * precisa ser dito, nunca omitido).
 */
function montarPerfis (concedidos, revogados, niveis, modulos) {
  const perfis = {}

  for (const par of concedidos) {
    const igual = String(par).indexOf('=')
    if (igual === -1) {
      throw new Error(`--conceder espera modulo=nivel (recebi "${par}").`)
    }
    const modulo = String(par).slice(0, igual).trim()
    conferirModulo(modulo, modulos)
    perfis[modulo] = normalizarNivel(String(par).slice(igual + 1), niveis)
  }

  for (const bruto of revogados) {
    const modulo = String(bruto).trim()
    conferirModulo(modulo, modulos)
    if (modulo in perfis) {
      throw new Error(
        `O modulo "${modulo}" aparece em --conceder e em --revogar ao mesmo tempo. ` +
        'Escolha um: o corpo tem uma chave so por modulo, e a ultima venceria em silencio.'
      )
    }
    perfis[modulo] = null
  }

  return perfis
}

/**
 * O que muda, modulo a modulo. Devolve [{modulo, de, para, tipo}], com tipo em
 * 'concede' | 'sobe' | 'desce' | 'revoga' | 'igual'.
 */
function diffPerfis (atual, novo) {
  const linhas = []
  for (const modulo of Object.keys(novo)) {
    const de = atual && atual[modulo] !== undefined ? atual[modulo] : null
    const para = novo[modulo]
    let tipo = 'igual'
    if (de === para) tipo = 'igual'
    else if (para === null) tipo = 'revoga'
    else if (de === null) tipo = 'concede'
    else tipo = para > de ? 'sobe' : 'desce'
    linhas.push({ modulo, de, para, tipo })
  }
  return linhas
}

/** Tira acesso e rebaixar pedem confirmacao; conceder e subir, nao. */
function tiraAcesso (diff) {
  return diff.filter(d => d.tipo === 'revoga' || d.tipo === 'desce')
}

const NOME_NIVEL = (niveis, code) => {
  if (code === null || code === undefined) return 'nenhum'
  const achado = niveis.find(n => n.code === code)
  return achado ? `${code} (${achado.nome})` : String(code)
}

// ---------------------------------------------------------------------------
// Comando
// ---------------------------------------------------------------------------

async function executar (args, cfg, injetadas) {
  const deps = { ...PADRAO, ...(injetadas || {}) }
  const acao = args._[1] || 'listar'
  const flags = args.flags
  const rec = recurso()
  const modulo = rec.schema()

  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: rec.operacoes.listar.colunas
  }

  switch (acao) {
    // -----------------------------------------------------------------------
    // Os dominios que se resolvem ANTES de criar alguem ou mexer em perfil.
    case 'dominios': {
      const [postos, modulos, niveis] = await Promise.all([
        http.autenticada(cfg, 'GET', '/usuarios/dominio/tipo_posto_grad'),
        http.autenticada(cfg, 'GET', '/usuarios/dominio/modulo'),
        http.autenticada(cfg, 'GET', '/usuarios/dominio/tipo_perfil')
      ])
      const linhas = [
        'tipo_posto_grad_id  (campo do corpo de criar/editar)',
        saida.lista(postos.dados, { formato: opcoesSaida.formato, padrao: ['code', 'nome_abrev', 'nome'] }).texto,
        '',
        'modulo  (a CHAVE do mapa `perfis` e o nome_abrev)',
        saida.lista(modulos.dados, { formato: opcoesSaida.formato, padrao: ['code', 'nome_abrev', 'nome'] }).texto,
        '',
        'tipo_perfil  (o VALOR do mapa `perfis`; hierarquico, e null remove o acesso)',
        saida.lista(niveis.dados, { formato: opcoesSaida.formato, padrao: ['code', 'nome'] }).texto
      ]
      return { texto: linhas.join('\n') }
    }

    // -----------------------------------------------------------------------
    case 'listar': {
      const usuarios = await deps.listarUsuarios(cfg)

      // Filtros locais, e nao de servidor: GET /usuarios nao aceita query
      // nenhuma (ver `divergencias` no README). Fazer a peneira aqui e honesto;
      // inventar `?ativo=true` seria anunciar um contrato que nao existe.
      let linhas = usuarios
      const avisos = []
      if (flags.ativo !== undefined && flags.ativo !== true) {
        const alvo = String(flags.ativo) === 'true'
        linhas = linhas.filter(u => u.ativo === alvo)
      }
      if (flags.admin === true) linhas = linhas.filter(u => u.administrador === true)
      if (flags['sem-senha'] === true) linhas = linhas.filter(u => u.senha_definida === false)
      if (flags.modulo !== undefined && flags.modulo !== true) {
        const nome = String(flags.modulo)
        linhas = linhas.filter(u => u.perfis && u.perfis[nome] !== undefined)
      }
      if (linhas.length !== usuarios.length) {
        avisos.push(
          `Filtro aplicado no CLIENTE (${usuarios.length} -> ${linhas.length}): a rota ` +
          'GET /usuarios devolve a lista inteira e nao aceita filtro de query.'
        )
      }

      const out = saida.lista(linhas, opcoesSaida)
      return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
    }

    // -----------------------------------------------------------------------
    // Nao ha GET /usuarios/:uuid no servidor: o CLI recorta da listagem.
    case 'obter': {
      const uuid = argsLib.exigir(flags, 'uuid', 'uuid da pessoa')
      const usuarios = await deps.listarUsuarios(cfg)
      const achado = usuarios.find(u => u.uuid === uuid)
      if (!achado) {
        throw recusa([
          `Nenhum usuario com uuid ${uuid} na listagem.`,
          '',
          'Confira a lista: efetivo usuario listar',
          '(o servidor nao tem GET /usuarios/:uuid; esta resposta sai do recorte',
          ' da listagem, entao "nao esta na lista" e a unica resposta possivel.)'
        ])
      }
      return {
        texto: saida.registro(achado, { ...opcoesSaida, padrao: null }),
        avisos: ['Recortado da listagem: o servidor nao tem rota de usuario por uuid.']
      }
    }

    // -----------------------------------------------------------------------
    case 'criar': {
      const bruto = lerCorpo(flags)
      if (!bruto || typeof bruto !== 'object') {
        throw new Error(
          "criar exige --data '{...}' ou --data-file corpo.json.\n" +
          'Contrato: efetivo schema usuario\n' +
          'Resolva tipo_posto_grad_id (e os nomes de modulo) antes com: efetivo usuario dominios'
        )
      }
      const { corpo, avisos } = validar(modulo.criaUsuario, bruto, acao)

      if (!corpo.perfis || !Object.keys(corpo.perfis).length) {
        avisos.push(
          'Sem `perfis` no corpo, a pessoa e criada SEM acesso a modulo nenhum: ela ' +
          'entra e nao ve nada. Conceder e ato explicito, aqui ou depois com: ' +
          'efetivo usuario perfis --uuid <uuid> --conceder acervo=consulta'
        )
      }

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado. A requisicao seria:',
            '  POST /api/usuarios   (exige ADMINISTRADOR)',
            '  corpo (ja validado contra o schema vivo; senha omitida do eco):',
            JSON.stringify(ecoSeguro(corpo), null, 2)
          ].join('\n'),
          avisos
        }
      }

      const r = await http.autenticada(cfg, 'POST', '/usuarios', { corpo })
      const uuid = r.dados && r.dados.uuid ? r.dados.uuid : '(sem uuid na resposta)'
      return {
        texto: `${r.message || 'usuario criado'}\nuuid       ${uuid}\n` +
          `login      ${corpo.login}\nadmin      ${corpo.administrador ? 'sim' : 'nao'}\n` +
          `ativo      ${corpo.ativo ? 'sim' : 'nao'}`,
        avisos
      }
    }

    // -----------------------------------------------------------------------
    case 'editar': {
      const uuid = argsLib.exigir(flags, 'uuid', 'uuid da pessoa a editar')
      const bruto = lerCorpo(flags)
      if (!bruto || typeof bruto !== 'object') {
        throw new Error(
          "editar exige --data '{...}'. Contrato: efetivo schema usuario\n" +
          'Lembre: `administrador` e `ativo` sao OBRIGATORIOS no corpo (e strict, ' +
          'ou seja, true/false e nao "true"). Os campos de identidade sao ' +
          'opcionais, e omitir vale "nao mexe".'
        )
      }
      const { corpo, avisos } = validar(modulo.updateUsuario, bruto, acao)

      if (corpo.ativo === false) {
        avisos.push(
          'ativo=false corta o login desta pessoa em TODOS os modulos, no mesmo ' +
          'segundo (o verifyPerfil le o banco a cada requisicao). Nada avisa a pessoa.'
        )
      }

      const caminho = montarCaminho(rec.operacoes.editar, { uuid })

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado. A requisicao seria:',
            `  PUT /api${caminho}   (exige ADMINISTRADOR)`,
            JSON.stringify(ecoSeguro(corpo), null, 2)
          ].join('\n'),
          avisos
        }
      }

      const r = await http.autenticada(cfg, 'PUT', caminho, { corpo })
      return { texto: r.message || 'usuario atualizado', avisos }
    }

    // -----------------------------------------------------------------------
    // Alteracao em LOTE: resolve os uuid para nome antes de confirmar.
    case 'editar-lista': {
      const bruto = lerCorpo(flags)
      if (!bruto || typeof bruto !== 'object') {
        throw new Error(
          "editar-lista exige --data '{\"usuarios\": [...]}'. Contrato: efetivo schema usuario"
        )
      }
      const { corpo, avisos } = validar(modulo.updateUsuarioLista, bruto, acao)

      const uuids = corpo.usuarios.map(u => u.uuid)
      const pessoas = await resolverPessoas(cfg, uuids, deps)
      const linhas = blocoAfetados(
        `ALTERAR administrador/ativo/perfil de ${uuids.length} pessoa(s):`, pessoas
      )

      const desativados = corpo.usuarios.filter(u => u.ativo === false).length
      if (desativados) {
        linhas.push('', `${desativados} delas ficam INATIVAS: o login cai em todos os modulos, na hora.`)
      }
      if (pessoas.desconhecidos.length && !pessoas.indisponivel) {
        const n = pessoas.desconhecidos.length
        linhas.push(
          '',
          `ATENCAO: ${n} uuid ${n === 1 ? 'nao foi encontrado' : 'nao foram encontrados'} na listagem.`,
          'O servidor recusa a lista inteira nesse caso, mas confira antes: uuid',
          'errado atinge a pessoa errada.'
        )
      }

      if (flags['dry-run']) {
        linhas.push('', '[dry-run] nada foi enviado. Seria: PUT /api/usuarios', JSON.stringify(ecoSeguro(corpo), null, 2))
        return { texto: linhas.join('\n'), avisos }
      }

      // Confirmacao pela CONTAGEM: obriga a olhar quantos sao, e um --confirmar
      // copiado de outro comando nao passa por acidente.
      if (flags.confirmar !== String(uuids.length)) {
        linhas.push(
          '',
          'Nao confirmado. Para executar, informe a QUANTIDADE em --confirmar:',
          `  efetivo usuario editar-lista --data '...' --confirmar ${uuids.length}`,
          'Para so ver a requisicao que sairia: acrescente --dry-run.'
        )
        throw recusa(linhas, avisos)
      }

      const r = await http.autenticada(cfg, 'PUT', '/usuarios', { corpo })
      linhas.push('', r.message || 'usuarios atualizados')
      return { texto: linhas.join('\n'), avisos }
    }

    // -----------------------------------------------------------------------
    case 'excluir': {
      const uuid = argsLib.exigir(flags, 'uuid', 'uuid da pessoa a excluir')
      const pessoas = await resolverPessoas(cfg, [uuid], deps)
      const linhas = blocoAfetados('Exclusao DEFINITIVA (nao ha tabela de deletados) de:', pessoas)

      linhas.push(
        '',
        'Quem ja trabalhou no sistema NAO se apaga: se desativa. O servidor recusa',
        'a exclusao quando ha registro apontando para a pessoa, e a resposta dele',
        'diz isso com todas as letras. Desativar e:',
        `  efetivo usuario editar --uuid ${uuid} --data '{"administrador": false, "ativo": false}'`
      )

      const caminho = montarCaminho(rec.operacoes.excluir, { uuid })

      if (flags['dry-run']) {
        linhas.push('', `[dry-run] nada foi enviado. Seria: DELETE /api${caminho}`)
        return { texto: linhas.join('\n') }
      }

      if (flags.confirmar !== String(uuid)) {
        linhas.push(
          '',
          'Nao confirmado. Para excluir de fato, repita o uuid em --confirmar:',
          `  efetivo usuario excluir --uuid ${uuid} --confirmar ${uuid}`,
          'Para so ver a requisicao que sairia: acrescente --dry-run.'
        )
        throw recusa(linhas)
      }

      try {
        const r = await http.autenticada(cfg, 'DELETE', caminho)
        linhas.push('', r.message || 'usuario excluido')
        return { texto: linhas.join('\n') }
      } catch (err) {
        // A MENSAGEM DO SERVIDOR VEM INTEIRA. O 400 daqui e quase sempre a
        // traducao da violacao de FK ("Usuário já possui registros no sistema e
        // não pode ser excluído. Desative-o.") ou a trava do ultimo
        // administrador ativo. As duas dizem o que fazer; trocar qualquer uma
        // por "nao foi possivel excluir" seria substituir a instrucao pelo
        // codigo de status.
        if (err instanceof http.ErroHttp) {
          linhas.push(
            '',
            `O servidor RECUSOU a exclusao (HTTP ${err.status}):`,
            `  ${err.mensagem}`,
            '',
            'Isso normalmente e o esperado, e nao um defeito. Desative em vez de excluir:',
            `  efetivo usuario editar --uuid ${uuid} --data '{"administrador": false, "ativo": false}'`
          )
          throw recusa(linhas)
        }
        throw err
      }
    }

    // -----------------------------------------------------------------------
    case 'resetar-senha': {
      const uuids = argsLib.lista(flags.uuids)
      if (!uuids || !uuids.length) {
        throw new Error(
          'resetar-senha exige --uuids U1,U2 (um ou mais uuid). ' +
          'Descubra com: efetivo usuario listar'
        )
      }

      // Valida a lista contra o schema real, que ja cobra uuid valido e proibe
      // repeticao (`.unique()`).
      const { corpo, avisos } = validar(modulo.listaUsuario, { usuarios: uuids }, acao)

      const pessoas = await resolverPessoas(cfg, uuids, deps)
      const linhas = blocoAfetados(
        `RESETAR A SENHA de ${uuids.length} pessoa(s). ` +
        'A senha de cada uma passa a ser o LOGIN dela:', pessoas
      )

      linhas.push(
        '',
        'Com todas as letras: depois disto, quem souber o login de uma destas',
        'pessoas entra na conta dela. Avise cada uma e peca que troque a senha',
        '(efetivo usuario trocar-senha), senao o acesso fica aberto.',
        'O reset vale para ADMINISTRADOR tambem, ao contrario do sistema de origem.'
      )

      if (pessoas.desconhecidos.length && !pessoas.indisponivel) {
        const n = pessoas.desconhecidos.length
        linhas.push(
          '',
          `ATENCAO: ${n} uuid ${n === 1 ? 'nao foi encontrado' : 'nao foram encontrados'} na listagem.`,
          'Confira a lista antes de confirmar: uuid errado atinge a pessoa errada.'
        )
      }

      if (flags['dry-run']) {
        linhas.push(
          '',
          '[dry-run] nada foi enviado. Seria: POST /api/usuarios/senha/reset',
          JSON.stringify(corpo, null, 2)
        )
        return { texto: linhas.join('\n'), avisos }
      }

      if (flags.confirmar !== String(uuids.length)) {
        linhas.push(
          '',
          'Nao confirmado. Para executar, informe a QUANTIDADE em --confirmar:',
          `  efetivo usuario resetar-senha --uuids ${uuids.join(',')} --confirmar ${uuids.length}`,
          'Para so ver a requisicao que sairia: acrescente --dry-run.'
        )
        throw recusa(linhas, avisos)
      }

      const r = await http.autenticada(cfg, 'POST', '/usuarios/senha/reset', { corpo })
      const total = r.dados && r.dados.total !== undefined ? r.dados.total : uuids.length
      linhas.push('', `${r.message || 'senhas resetadas'} (${total} pessoa(s))`)
      return { texto: linhas.join('\n'), avisos }
    }

    // -----------------------------------------------------------------------
    // Perfil por modulo. Vai pela MESMA rota do editar, e por isso o corpo
    // precisa levar `administrador` e `ativo`: eles sao obrigatorios no schema.
    // Reenviar os valores lidos da listagem e o que impede "conceder consulta no
    // acervo" de desativar a pessoa por omissao.
    case 'perfis': {
      const uuid = argsLib.exigir(flags, 'uuid', 'uuid da pessoa')
      const concedidos = argsLib.repetida(flags, 'conceder')
      const revogados = argsLib.repetida(flags, 'revogar')

      const pessoas = await resolverPessoas(cfg, [uuid], deps)
      if (!pessoas.conhecidos.length) {
        throw recusa(blocoAfetados('Nao foi possivel identificar:', pessoas).concat([
          '',
          'Sem administrador e ativo lidos da listagem nao da para montar o corpo:',
          'os dois sao obrigatorios no PUT, e chutar qualquer um deles mudaria o',
          'acesso da pessoa sem ninguem pedir.'
        ]))
      }
      const pessoa = pessoas.conhecidos[0]

      const niveis = await deps.listarNiveis(cfg)
      const modulos = await deps.listarModulos(cfg)

      if (!concedidos.length && !revogados.length) {
        const atuais = Object.keys(pessoa.perfis).length
          ? Object.entries(pessoa.perfis)
            .map(([m, n]) => `  ${m.padEnd(12)} ${NOME_NIVEL(niveis, n)}`)
            .join('\n')
          : '  (nenhum modulo: a pessoa entra e nao ve nada)'
        return {
          texto: [
            `${pessoa.rotulo}   (${uuid})`,
            `administrador ${pessoa.administrador ? 'sim' : 'nao'}   ativo ${pessoa.ativo ? 'sim' : 'nao'}`,
            '',
            'perfis por modulo',
            atuais,
            '',
            'Para mudar:',
            `  efetivo usuario perfis --uuid ${uuid} --conceder acervo=consulta`,
            `  efetivo usuario perfis --uuid ${uuid} --revogar mapoteca --confirmar ${uuid}`
          ].join('\n')
        }
      }

      const perfis = montarPerfis(concedidos, revogados, niveis, modulos)
      const diff = diffPerfis(pessoa.perfis, perfis)

      const linhas = [
        `${pessoa.rotulo}   (${uuid})`,
        '',
        'mudanca de perfil'
      ]
      for (const d of diff) {
        const rotulo = { concede: 'concede', sobe: 'sobe   ', desce: 'DESCE  ', revoga: 'REVOGA ', igual: 'igual  ' }[d.tipo]
        linhas.push(`  ${rotulo} ${d.modulo.padEnd(12)} ${NOME_NIVEL(niveis, d.de)} -> ${NOME_NIVEL(niveis, d.para)}`)
      }

      const perigosas = tiraAcesso(diff)
      if (perigosas.length) {
        linhas.push(
          '',
          `${perigosas.length} mudanca(s) TIRAM acesso (${perigosas.map(d => d.modulo).join(', ')}).`,
          'Isso vale no mesmo segundo: o verifyPerfil le o banco a cada requisicao.'
        )
        // O --dry-run passa por aqui sem confirmar: ele nao envia nada, e o
        // bloco de mudancas acima ja esta na saida para ser olhado.
        if (!flags['dry-run'] && flags.confirmar !== String(uuid)) {
          linhas.push(
            '',
            'Nao confirmado. Para executar, repita o uuid em --confirmar:',
            `  efetivo usuario perfis --uuid ${uuid} ${concedidos.map(c => `--conceder ${c}`).concat(revogados.map(r => `--revogar ${r}`)).join(' ')} --confirmar ${uuid}`,
            'Para so ver a requisicao que sairia: acrescente --dry-run.'
          )
          throw recusa(linhas)
        }
      }

      // administrador e ativo vao INTACTOS, lidos da listagem: sao obrigatorios
      // no schema e este verbo nao tem opiniao sobre eles.
      const bruto = {
        administrador: pessoa.administrador === true,
        ativo: pessoa.ativo === true,
        perfis
      }
      const { corpo, avisos } = validar(modulo.updateUsuario, bruto, acao)
      const caminho = montarCaminho(rec.operacoes.perfis, { uuid })

      if (flags['dry-run']) {
        linhas.push(
          '',
          `[dry-run] nada foi enviado. Seria: PUT /api${caminho}`,
          JSON.stringify(corpo, null, 2)
        )
        return { texto: linhas.join('\n'), avisos }
      }

      const r = await http.autenticada(cfg, 'PUT', caminho, { corpo })
      linhas.push('', r.message || 'perfis atualizados')
      return { texto: linhas.join('\n'), avisos }
    }

    // -----------------------------------------------------------------------
    // O PROPRIO cadastro: as duas unicas coisas deste comando que nao exigem
    // administrador.
    case 'meu-perfil': {
      const r = await http.autenticada(cfg, 'GET', '/usuarios/perfil')
      return { texto: saida.registro(r.dados, { ...opcoesSaida, padrao: null }) }
    }

    case 'trocar-senha': {
      const atual = argsLib.exigir(flags, 'senha-atual', 'a senha VIGENTE (o servidor a exige)')
      const nova = argsLib.exigir(flags, 'senha-nova', 'a senha nova')
      const { corpo, avisos } = validar(
        modulo.updateSenhaPropria, { senha_atual: atual, senha_nova: nova }, acao
      )

      if (flags['dry-run']) {
        return {
          texto: '[dry-run] nada foi enviado. Seria: PUT /api/usuarios/perfil/senha ' +
            '(corpo com senha_atual e senha_nova, nao ecoadas).',
          avisos
        }
      }

      const r = await http.autenticada(cfg, 'PUT', '/usuarios/perfil/senha', { corpo })
      return { texto: r.message || 'senha alterada', avisos }
    }

    default:
      throw new Error(
        `Acao desconhecida "${acao}" para usuario. Use: dominios, listar, obter, ` +
        'criar, editar, editar-lista, excluir, resetar-senha, perfis, meu-perfil, ' +
        'trocar-senha.\nContrato: efetivo schema usuario'
      )
  }
}

/**
 * Quando esta invocacao vai de fato EXIGIR configuracao de servidor. Errar o
 * nome da acao e conhecimento local e nao pode pedir SCA_URL.
 *
 * O --dry-run das acoes de ESCRITA tambem nao exige: elas validam o corpo contra
 * o Joi sem rede. Elas ainda TENTAM resolver os uuid para nome (que e o
 * guardrail), e sem servidor isso cai no caso "nao verificado", que a saida diz
 * com todas as letras em vez de fingir que conferiu. Ja o --dry-run de uma
 * leitura nao existe: nao ha corpo para validar, e a acao e a propria leitura.
 */
const ACOES = new Set([
  'dominios', 'listar', 'obter', 'criar', 'editar', 'editar-lista', 'excluir',
  'resetar-senha', 'perfis', 'meu-perfil', 'trocar-senha'
])

const SO_LEITURA = new Set(['dominios', 'listar', 'obter', 'meu-perfil'])

function precisaServidor (args) {
  const acao = args._[1] || 'listar'
  if (!ACOES.has(acao)) return false
  if (args.flags['dry-run'] === true && !SO_LEITURA.has(acao)) return false
  return true
}

module.exports = {
  executar,
  precisaServidor,
  // Exportados para os testes: o alvo e a DECISAO do guardrail, nao o transporte.
  rotuloPessoa,
  resolverPessoas,
  blocoAfetados,
  montarPerfis,
  diffPerfis,
  tiraAcesso,
  normalizarNivel,
  ecoSeguro,
  PADRAO
}
