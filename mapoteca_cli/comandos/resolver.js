'use strict'

// Os dois verbos de RESOLUCAO, que colapsam o passo mais caro do dia a dia da
// mapoteca: transformar o que o documento escreveu no identificador que a API
// exige.
//
//   mapoteca resolver 2962-4-NE 2963-1 ...   folha do documento -> uuid_versao
//   mapoteca cliente resolver "6 RCB"        nome ou sigla do documento -> cliente_id
//
// Por que existem:
//
// Casar UMA folha com o acervo sao duas chamadas (busca por semelhanca, depois
// o detalhe do produto para escolher a versao) mais um filtro exato e uma regra
// de escolha de versao. Num pedido de trinta folhas isso e sessenta chamadas
// sequenciais e sessenta respostas grandes no contexto do agente. Aqui vira uma
// invocacao e uma tabela de trinta linhas.
//
// O lado do cliente e pior: a API nao tem busca de cliente. A unica opcao e
// baixar a lista inteira e casar do lado de ca, e e por nao fazer isso direito
// que a mesma OM entra duas vezes na base e o historico dela racha em dois.
//
// Nenhum dos dois DECIDE por conta propria em caso de duvida: ambiguidade vira
// aviso e nenhuma escolha. Um chute silencioso aqui vira folha errada impressa.

const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')
const mi = require('../lib/mi')
const plano = require('../lib/plano')

// Carta Topografica. E o que a mapoteca distribui em quase todo pedido; quem
// quiser ortoimagem (3) ou tematica (7) passa --tipo-produto.
const TIPO_PRODUTO_PADRAO = 2

const COLUNAS_RESOLUCAO = [
  'mi', 'situacao', 'produto_id', 'produto_nome', 'escala',
  'uuid_versao', 'versao', 'data_edicao', 'arquivos'
]

/**
 * Escolhe a versao que serve para atender um pedido.
 *
 * Regra do dominio: vale a mais recente por data de edicao QUE TENHA ARQUIVO.
 * Versao sem arquivo e registro historico (uma folha 25k costuma ter as quatro
 * edicoes antigas cadastradas sem nenhum arquivo) e escolhe-la produziria um
 * item que a mapoteca nunca consegue imprimir.
 */
function escolherVersao (versoes) {
  const todas = Array.isArray(versoes) ? versoes : []
  const comArquivo = todas.filter(v => Array.isArray(v.arquivos) && v.arquivos.length)

  const candidatas = comArquivo.length ? comArquivo : todas
  if (!candidatas.length) return { versao: null, motivo: 'produto sem nenhuma versao cadastrada' }

  const ordenadas = [...candidatas].sort((a, b) => {
    const da = String(a.versao_data_edicao || '')
    const db = String(b.versao_data_edicao || '')
    return db.localeCompare(da)
  })

  return {
    versao: ordenadas[0],
    motivo: comArquivo.length
      ? null
      : 'NENHUMA versao deste produto tem arquivo: e registro historico e nao serve para imprimir'
  }
}

/**
 * Produto que a mapoteca consegue IMPRIMIR: tem ao menos uma versao com arquivo.
 *
 * Dois tipos de produto legitimo nascem sem arquivo nenhum e nunca servem a um
 * pedido: a folha PLANEJADA do PIT (rota propria `produto_versao_planejada`, que
 * registra producao prometida) e o registro historico de edicao antiga. Os dois
 * existem de proposito no acervo, e nenhum dos dois e carta que se possa tirar
 * do plotter.
 */
function produtoImprimivel (dados) {
  const versoes = (dados && Array.isArray(dados.versoes)) ? dados.versoes : []
  return versoes.some(v => Array.isArray(v.arquivos) && v.arquivos.length)
}

async function resolverUmMi (cfg, bruto, filtros) {
  const canonico = mi.normalizar(bruto)
  const linha = { mi: canonico || String(bruto), situacao: 'ok' }

  if (!canonico) {
    linha.situacao = 'MI ilegivel'
    return { linha, aviso: `"${bruto}" nao tem forma de MI (esperado 2962, 2962-4 ou 2962-4-NE).` }
  }

  const busca = await http.autenticada(cfg, 'GET', '/acervo/busca' + http.query({
    termo: canonico,
    tipo_produto_id: filtros.tipoProduto,
    tipo_escala_id: filtros.escala,
    limit: 50
  }))

  // A busca do servidor e por semelhanca (ILIKE '%termo%'): ela devolve tudo que
  // CONTEM o MI, inclusive o MI de outra folha que o contenha como prefixo. O
  // casamento exato e responsabilidade de quem chama.
  const candidatos = (busca.dados && busca.dados.dados ? busca.dados.dados : [])
    .filter(p => mi.iguais(p.mi, canonico))

  if (!candidatos.length) {
    linha.situacao = 'ausente do acervo'
    return {
      linha,
      aviso: `${canonico}: nenhum produto com este MI no acervo. A folha nao pode virar item ` +
        '(todo item aponta uma versao). Nomeie-a na observacao do pedido.'
    }
  }

  // O detalhe de CADA candidato. Com um candidato so e a mesma chamada unica de
  // sempre; com mais de um, e o que permite descartar quem nao serve para
  // imprimir ANTES de declarar ambiguidade.
  const detalhados = []
  for (const candidato of candidatos) {
    await http.pausa()
    const detalhe = await http.autenticada(
      cfg, 'GET', `/acervo/produto/detalhado/${candidato.id}`
    )
    detalhados.push({ produto: candidato, dados: detalhe.dados || {} })
  }

  const avisosPrevios = []
  let escolhido = detalhados[0]

  if (detalhados.length > 1) {
    // A MESMA regra que `escolherVersao` aplica entre VERSOES, um nivel acima,
    // entre PRODUTOS: vale quem tem arquivo, e os sem arquivo so voltam a
    // concorrer se nenhum tiver.
    //
    // Sem isto, o MI de uma folha planejada do PIT vira ambiguidade, o comando
    // manda "fixe o uuid_versao a mao no plano", e o uuid da folha que AINDA NAO
    // EXISTE passa no dry-run e no servidor sem um aviso (a validacao do item e
    // so `SELECT uuid_versao FROM acervo.versao`). O item nasceria apontando
    // carta nao produzida, e o erro so apareceria na impressao. Medido em
    // 2026-08-24: o lote planejado de 2026-08-07 deixou 44 MI assim, e os 44 ja
    // tinham sido pedidos ao menos uma vez.
    const imprimiveis = detalhados.filter(d => produtoImprimivel(d.dados))
    const semArquivo = detalhados.filter(d => !produtoImprimivel(d.dados))
    const ids = lista => lista.map(d => d.produto.id).join(', ')

    if (imprimiveis.length === 1) {
      escolhido = imprimiveis[0]
      avisosPrevios.push(
        `${canonico}: ${detalhados.length} produtos com o mesmo MI (ids ` +
        `${ids(detalhados)}). Escolhi o ${escolhido.produto.id}, o unico com arquivo. ` +
        `Sem arquivo, descartado(s): ${ids(semArquivo)} (folha planejada do PIT ou ` +
        'registro historico, que a mapoteca nao imprime).'
      )
    } else if (imprimiveis.length === 0) {
      linha.situacao = `AMBIGUO (${ids(detalhados)})`
      return {
        linha,
        aviso: `${canonico}: ${detalhados.length} produtos com o mesmo MI (ids ` +
          `${ids(detalhados)}), e NENHUM tem arquivo. A folha nao pode virar item. ` +
          'Nomeie-a na observacao do pedido.'
      }
    } else {
      linha.situacao = `AMBIGUO (${ids(imprimiveis)})`
      return {
        linha,
        aviso: `${canonico}: ${imprimiveis.length} produtos com o mesmo MI TEM arquivo ` +
          `(ids ${ids(imprimiveis)}). Nao escolhi nenhum. Recorte com --tipo-produto ou ` +
          '--escala, ou fixe o uuid_versao a mao no plano, conferindo no acervo que a ' +
          'versao escolhida tem arquivo.'
      }
    }
  }

  const produto = escolhido.produto
  const dados = escolhido.dados
  linha.produto_id = produto.id
  linha.produto_nome = produto.nome
  linha.escala = produto.escala

  const { versao, motivo } = escolherVersao(dados.versoes)

  if (!versao) {
    linha.situacao = 'sem versao'
    return { linha, aviso: `${canonico}: ${motivo}.` }
  }

  linha.uuid_versao = versao.uuid_versao
  linha.versao = versao.versao
  linha.data_edicao = versao.versao_data_edicao
  linha.arquivos = Array.isArray(versao.arquivos) ? versao.arquivos.length : 0
  linha.total_versoes = Array.isArray(dados.versoes) ? dados.versoes.length : 0

  const avisos = [...avisosPrevios]
  if (motivo) {
    linha.situacao = 'sem arquivo'
    avisos.push(`${canonico}: ${motivo}.`)
  }
  // O nome que o documento escreveu, quando informado, e conferido contra o do
  // acervo. Quando os dois brigam, o MI manda (ele e verificavel; o nome so
  // revela a intencao de quem digitou), mas a divergencia precisa aparecer.
  if (filtros.nomes && filtros.nomes[canonico]) {
    const doDocumento = String(filtros.nomes[canonico]).trim().toLowerCase()
    const doAcervo = String(produto.nome || '').trim().toLowerCase()
    if (doDocumento && doAcervo && doDocumento !== doAcervo) {
      linha.divergencia_nome = `documento diz "${filtros.nomes[canonico]}", acervo diz "${produto.nome}"`
      avisos.push(
        `${canonico}: DIVERGENCIA DE NOME. ${linha.divergencia_nome}. ` +
        'Prevalece o MI; registre a divergencia na observacao do item.'
      )
    }
  }

  return { linha, avisos }
}

async function resolverMis (args, cfg) {
  const flags = args.flags
  const nomes = {}
  let brutos = args._.slice(1)

  // Tambem aceita ler os MIs de um plano: e o caminho normal, porque o plano ja
  // traz o MI E o nome como o documento escreveu, que e o que permite detectar a
  // divergencia de nome.
  const caminhoPlano = argsLib.texto(flags, 'plano')
  if (caminhoPlano) {
    const p = plano.ler(caminhoPlano)
    const itens = Array.isArray(p.itens) ? p.itens : []
    brutos = [...brutos, ...itens.map(i => i.mi).filter(Boolean)]
    for (const item of itens) {
      const canonico = mi.normalizar(item.mi)
      if (canonico && item.nome) nomes[canonico] = item.nome
    }
  }

  if (!brutos.length) {
    throw new Error(
      'Informe pelo menos um MI: mapoteca resolver 2962-4-NE 2963-1\n' +
      'ou aponte um plano: mapoteca resolver --plano pedido.json'
    )
  }

  const filtros = {
    tipoProduto: argsLib.numero(flags, 'tipo-produto', TIPO_PRODUTO_PADRAO),
    escala: argsLib.numero(flags, 'escala', null),
    nomes
  }

  const linhas = []
  const avisos = []
  for (const [i, bruto] of brutos.entries()) {
    // Pausa entre folhas: o SCA corta em 200 requisicoes por minuto e cada folha
    // gasta duas. Sem isso, um pedido grande leva 429 no meio e deixa o trabalho
    // pela metade.
    if (i > 0) await http.pausa()
    const r = await resolverUmMi(cfg, bruto, filtros)
    linhas.push(r.linha)
    if (r.aviso) avisos.push(r.aviso)
    if (r.avisos) avisos.push(...r.avisos)
  }

  const out = saida.lista(linhas, {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: COLUNAS_RESOLUCAO
  })

  const resolvidos = linhas.filter(l => l.uuid_versao).length
  const rodape = `\n${resolvidos} de ${linhas.length} folha(s) casadas com uma versao do acervo.` +
    (resolvidos < linhas.length
      ? ' As demais NAO podem virar item: nomeie-as na observacao do pedido.'
      : '')

  return { texto: out.texto + rodape, avisos: [...out.avisos, ...avisos] }
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/** Normaliza para comparar: sem acento, sem pontuacao, minusculo. */
function chave (texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(new RegExp('[\u005Cu0300-\u005Cu036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * A MESMA normalizacao, sem separador nenhum. E o que faz "CRO/3", "CRO 3",
 * "cro-3" e "cro3" virarem a mesma coisa: a sigla que o documento assina troca
 * de barra para espaco para nada conforme quem digitou.
 */
function chaveCompacta (texto) {
  return chave(texto).replace(/ /g, '')
}

/**
 * Pontua a SIGLA do cliente contra o termo, na forma compacta.
 *
 * A base guarda a sigla numa coluna propria (`mapoteca.cliente.sigla`, "CRO/3")
 * ao lado do nome por extenso, e o documento assina pela sigla. Sem esta conta,
 * "CRO 3" nao achava ninguem entre os 179 clientes (medido em 2026-08-25),
 * enquanto "Comissao Regional de Obras" achava o 146. E "nao achei" nao para
 * ali: o `acharOuCriarCliente` do `cadastrar` casa por nome EXATO e CRIA quando
 * nao acha, entao a mesma OM entra duas vezes e o historico dela racha em dois.
 *
 * A CONTENCAO SO VALE QUANDO A SIGLA COBRE METADE DO TERMO. Sem essa regra, uma
 * sigla de tres letras casa dentro de qualquer nome por extenso compactado
 * ("REG" dentro de "comissaoREGionaldeobras") e entra na lista como ruido.
 */
function pontuarSigla (sigla, alvoCompacto) {
  const s = chaveCompacta(sigla)
  if (!s || !alvoCompacto) return 0
  if (s === alvoCompacto) return 900

  const menor = Math.min(s.length, alvoCompacto.length)
  const maior = Math.max(s.length, alvoCompacto.length)
  if (menor < 3 || menor * 2 < maior) return 0

  return (alvoCompacto.includes(s) || s.includes(alvoCompacto)) ? 350 : 0
}

/**
 * Casa um termo contra a lista de clientes, pelo NOME e pela SIGLA. A base
 * guarda o nome POR EXTENSO ("6o Regimento de Cavalaria Blindado") e a sigla
 * ("6o RCB") em colunas separadas, e o documento ora usa um, ora a outra.
 *
 * Alem do nome inteiro procura-se por PALAVRA: quem digitou "Cavalaria Blindado
 * Alegrete" precisa achar a mesma OM.
 *
 * As duas contas SOMAM, entao quem casa pelos dois lados fica acima de quem
 * casa por um so. A sigla exata (900) vale menos que o nome exato (1000) e mais
 * que o nome que apenas CONTEM o termo (500): sigla e identificador, e nome por
 * extenso e prosa.
 */
function casarClientes (clientes, termo) {
  const alvo = chave(termo)
  if (!alvo) return []
  const alvoCompacto = chaveCompacta(termo)
  const palavras = alvo.split(' ').filter(p => p.length > 2)

  return clientes
    .map(c => {
      const nome = chave(c.nome)
      let pontos = 0
      if (nome === alvo) pontos = 1000
      else if (nome.includes(alvo)) pontos = 500
      else if (alvo.includes(nome)) pontos = 400
      const casadas = palavras.filter(p => nome.includes(p))
      pontos += casadas.length * 10
      pontos += pontuarSigla(c.sigla, alvoCompacto)
      return { cliente: c, pontos, palavras_casadas: casadas.length }
    })
    .filter(r => r.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
}

async function resolverCliente (args, cfg) {
  const flags = args.flags
  const termo = args._.slice(2).join(' ').trim()
  if (!termo) {
    throw new Error('Informe o nome ou a sigla: mapoteca cliente resolver "6 RCB"')
  }

  const r = await http.autenticada(cfg, 'GET', '/mapoteca/cliente')
  const clientes = Array.isArray(r.dados) ? r.dados : []
  const casados = casarClientes(clientes, termo)

  if (!casados.length) {
    return {
      texto: `Nenhum cliente casa com "${termo}" entre os ${clientes.length} cadastrados.`,
      avisos: [
        'A busca ja cobriu o nome por extenso E a sigla, e "CRO/3", "CRO 3" e "cro3" ' +
        'sao a mesma coisa aqui. Antes de criar um cliente novo, tente pela ' +
        'palavra-chave do nome por extenso ou pela cidade. Criar duplicata racha o ' +
        'historico da OM em dois.'
      ]
    }
  }

  const linhas = casados.slice(0, argsLib.numero(flags, 'limite', 10)).map(c => ({
    id: c.cliente.id,
    nome: c.cliente.nome,
    // A sigla SAI na tabela porque e por ela que metade dos casamentos acontece:
    // sem mostra-la, quem buscou "CRO 3" nao ve por que a linha entrou.
    sigla: c.cliente.sigla,
    tipo_cliente_nome: c.cliente.tipo_cliente_nome,
    total_pedidos: c.cliente.total_pedidos,
    data_ultimo_pedido: c.cliente.data_ultimo_pedido,
    ponto_contato_principal: c.cliente.ponto_contato_principal,
    palavras_casadas: c.palavras_casadas
  }))

  const out = saida.lista(linhas, {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: ['id', 'nome', 'sigla', 'tipo_cliente_nome', 'total_pedidos', 'data_ultimo_pedido', 'palavras_casadas']
  })

  const avisos = []
  if (casados.length > 1 && casados[0].pontos === casados[1].pontos) {
    avisos.push(
      'Os dois primeiros casam igualmente bem: escolha o cliente_id a mao, nao pelo topo da lista.'
    )
  }

  return { texto: out.texto, avisos: [...out.avisos, ...avisos] }
}

async function executar (args, cfg) {
  if (args._[0] === 'cliente') return resolverCliente(args, cfg)
  return resolverMis(args, cfg)
}

module.exports = {
  executar,
  precisaServidor: true,
  escolherVersao,
  produtoImprimivel,
  resolverUmMi,
  casarClientes,
  chave,
  chaveCompacta,
  pontuarSigla,
  TIPO_PRODUTO_PADRAO
}
