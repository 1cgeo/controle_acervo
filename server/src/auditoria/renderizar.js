'use strict'

const { db } = require('../database')
const { entradaDe, dominiosCitados } = require('./mapa')

/**
 * O DIFF SAI PRONTO DO SERVIDOR, e o cliente nao traduz nada.
 *
 * POR QUE AQUI. Sao cerca de 60 tabelas auditadas nos tres modulos e cerca de 25
 * tabelas de dominio referenciadas por elas. Para traduzir `situacao_pedido_id: 3`
 * o cliente precisaria do catalogo daquele dominio em memoria, e a tela de
 * rastreabilidade mistura os tres modulos numa pagina so: ela precisaria de
 * TODOS os catalogos, inclusive dos modulos que a pessoa nao usa. Hoje o
 * orcamento nao guarda catalogo nenhum no cliente, e o `services/cache.js` nem
 * tem API para ler o cache sem refazer a chamada. O servidor tem os 25 catalogos
 * a um SELECT de distancia.
 *
 * O QUE ISTO CORRIGE. Ate 2026-08-02 a tela do pedido mostrava
 * `campos_alterados.join(', ')`, ou seja o NOME DA COLUNA DO BANCO
 * ("situacao_pedido_id, prazo") e mais nada -- enquanto `dados_antes` e
 * `dados_depois` chegavam na resposta e eram jogados fora. Quem lia sabia que
 * algo mudou, sem saber de que para que.
 */

// --- Cache dos catalogos de dominio -----------------------------------------
//
// Sao tabelas minusculas (`code` mais `nome`) que mudam quase nunca. Carregadas
// sob demanda e guardadas em memoria do processo; invalidadas quando um evento
// de escrita em `dominio.*` e registrado, que e ele mesmo um evento auditado.
//
// Cache FRIO nao quebra nada: sem traducao sai o numero cru, que e exatamente o
// comportamento que a tela tinha antes. E o modo de falhar certo.
let catalogos = null

/** Descarta o cache. Chamado quando uma tabela de dominio e alterada. */
const invalidarCatalogos = () => {
  catalogos = null
}

// Identificador de banco. Tudo o que este modulo interpola no SQL passa por aqui:
// os nomes vem do MAPA, que e codigo, entao isto acusa erro de digitacao antes de
// a consulta existir -- e nao deixa a porta aberta se um dia alguem os montar a
// partir de outra coisa.
const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/

const identificador = (valor, papel) => {
  const texto = String(valor)
  if (!IDENTIFICADOR.test(texto)) {
    throw new Error(`Auditoria: ${papel} invalido no catalogo de dominio: "${texto}"`)
  }
  return texto
}

/**
 * Carrega os catalogos de dominio citados pelo mapa.
 *
 * A COLUNA DE ROTULO NAO E SEMPRE `nome`, e supor que fosse custou caro: das 14
 * tabelas de dominio do ponto de controle, 12 chamam a coluna de `code_name`.
 * Enquanto isto assumia `nome`, elas simplesmente NAO PODIAM ser declaradas -- e
 * o efeito de declarar uma errada nao seria um campo sem traducao, seria a tela
 * de rastreabilidade INTEIRA caindo com 42703, porque o `enriquecer` roda sobre a
 * pagina toda e uma tabela quebrada leva junto os eventos dos outros modulos.
 *
 * Por isso a declaracao aceita as duas formas:
 *
 *   dominio: 'dominio.tipo_produto'                                  // code/nome
 *   dominio: { tabela: 'ponto_controle.tipo_marco_limite',
 *              rotulo: 'code_name' }                                 // coluna propria
 *
 * Cache FRIO nao quebra nada: sem traducao sai o numero cru, que e exatamente o
 * comportamento que a tela tinha antes. E o modo de falhar certo.
 */
const carregarCatalogos = async () => {
  if (catalogos) return catalogos

  const carregado = {}
  for (const decl of dominiosCitados()) {
    const [schema, tabela] = decl.tabela.split('.')
    const alvo = `${identificador(schema, 'schema')}.${identificador(tabela, 'tabela')}`
    const chave = identificador(decl.chave, 'coluna de chave')
    const rotulo = identificador(decl.rotulo, 'coluna de rotulo')

    const linhas = await db.conn.any(
      `SELECT ${chave} AS code, ${rotulo} AS nome FROM ${alvo}`
    )
    carregado[decl.tabela] = new Map(linhas.map(l => [String(l.code), l.nome]))
  }
  catalogos = carregado
  return catalogos
}

// --- Formatacao de valor ----------------------------------------------------
//
// Sete regras. Cada uma existe porque a alternativa produz uma leitura errada.

/** 'AAAA-MM-DD' ou Date -> 'DD/MM/AAAA'. Dia de calendario nao ganha fuso. */
const comoData = valor => {
  if (valor == null) return null
  const texto = valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor)
  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : texto
}

const comoDataHora = valor => {
  if (valor == null) return null
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return String(valor)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** NUMERIC do PostgreSQL chega como string; o Number e seguro na faixa de valores do orcamento. */
const comoDinheiro = valor => {
  if (valor == null) return null
  const n = Number(valor)
  if (Number.isNaN(n)) return String(valor)
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const comoNumero = valor => {
  if (valor == null) return null
  const n = Number(valor)
  return Number.isNaN(n) ? String(valor) : n.toLocaleString('pt-BR')
}

const comoLista = valor => {
  if (valor == null) return null
  if (Array.isArray(valor)) return valor.length ? valor.join(', ') : '(lista vazia)'
  return String(valor)
}

/**
 * O texto de um valor, conforme o tipo declarado no mapa.
 *
 * Nulo devolve `null`, e quem desenha a tela escreve a palavra "vazio": celula
 * em branco se leria como "esta coluna nao se aplica", e "passou a ter
 * observacao" e "sempre foi vazio" sao fatos diferentes.
 */
const textoDoValor = (valor, decl, catalogo) => {
  if (valor == null) return null

  // O valor pode ter sido substituido pelo `sanitizar` (segredo, binario,
  // geometria grande). Nesse caso a propria substituicao ja traz a frase.
  if (typeof valor === 'object' && !Array.isArray(valor)) {
    if (valor._omitido) return `(${valor.bytes} bytes, não guardado)`
    if (valor._truncado) return valor.resumo
  }

  if (decl.dominio) {
    const nome = catalogo && catalogo.get(String(valor))
    // O nome E o codigo: so o nome esconde o valor real quando o catalogo mudar,
    // e so o numero nao diz nada. Codigo sem traducao sai como numero cru, e nao
    // como vazio -- inventar traducao e pior do que mostrar o numero.
    return nome ? `${nome} (${valor})` : String(valor)
  }

  // FK para ENTIDADE nao e traduzida, de proposito: o nome do cliente pode ter
  // mudado depois do evento, e mostrar o nome de hoje ao lado de um valor de um
  // ano atras afirma algo que pode ser falso. Sai o id, e a tela faz o link.
  if (decl.entidade) return `#${valor}`

  switch (decl.tipo) {
    case 'data': return comoData(valor)
    case 'data_hora': return comoDataHora(valor)
    case 'dinheiro': return comoDinheiro(valor)
    case 'numero': return comoNumero(valor)
    case 'lista': return comoLista(valor)
    case 'booleano': return valor === true ? 'Sim' : valor === false ? 'Não' : String(valor)
    default: {
      const texto = String(valor)
      // Texto longo e recortado com o tamanho ao lado: o inteiro quebraria a
      // tabela e nao informaria mais.
      return texto.length > 300 ? `${texto.slice(0, 300)}... (${texto.length} caracteres)` : texto
    }
  }
}

// --- A montagem -------------------------------------------------------------

/**
 * As mudancas de um evento, prontas para a tela.
 *
 * A ORDEM e a da declaracao do mapa (que espelha a ordem da ficha), e nao
 * alfabetica: assim o historico se le na mesma sequencia do formulario que
 * produziu a mudanca. Campo NAO DECLARADO vai para o fim, com o proprio nome de
 * coluna, o que tambem o faz saltar aos olhos de quem tiver de declara-lo.
 *
 * @param {object} evento - a linha de auditoria.evento
 * @param {object} catalogosCarregados
 * @returns {Array<object>}
 */
const montarMudancas = (evento, catalogosCarregados) => {
  const entrada = entradaDe(evento.tabela)
  const campos = entrada.campos || {}
  const alterados = evento.campos_alterados || []
  const antes = evento.dados_antes || {}
  const depois = evento.dados_depois || {}

  const ordem = Object.keys(campos)
  const declarados = alterados.filter(c => ordem.includes(c))
  declarados.sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))
  const naoDeclarados = alterados.filter(c => !ordem.includes(c)).sort()

  return [...declarados, ...naoDeclarados].map(campo => {
    const decl = campos[campo] || { rotulo: campo, tipo: 'texto' }
    const catalogo = decl.dominio ? catalogosCarregados[decl.dominio] : null

    return {
      campo,
      rotulo: decl.rotulo || campo,
      tipo: decl.dominio ? 'dominio' : decl.entidade ? 'entidade' : decl.tipo || 'texto',
      // A entidade-alvo vai junto para a tela montar o link sem adivinhar.
      entidade_alvo: decl.entidade || null,
      declarado: Boolean(campos[campo]),
      antes: antes[campo] != null ? antes[campo] : null,
      depois: depois[campo] != null ? depois[campo] : null,
      antes_texto: textoDoValor(antes[campo], decl, catalogo),
      depois_texto: textoDoValor(depois[campo], decl, catalogo)
    }
  })
}

/**
 * O `resumo` de um evento: a frase que identifica o registro.
 *
 * E o que aparece em vez de 20 campos numa INSERCAO (onde todos os campos
 * "mudaram" e a lista nao informaria nada) e numa EXCLUSAO.
 *
 * Se a funcao de resumo falhar (linha com campo faltando, dado antigo), a tela
 * nao pode cair junto: devolve o proprio nome da tabela. O historico e
 * acessorio; a ficha e o trabalho.
 */
const montarResumo = evento => {
  const entrada = entradaDe(evento.tabela)
  const linha = evento.dados_depois || evento.dados_antes
  if (!linha) return evento.tabela
  try {
    return entrada.resumo(linha) || evento.tabela
  } catch (err) {
    return evento.tabela
  }
}

/**
 * Enriquece uma pagina de eventos com `mudancas` e `resumo`.
 *
 * Recebe a lista inteira e carrega os catalogos UMA vez: por evento seriam 25
 * consultas por linha da tela.
 */
const enriquecer = async eventos => {
  if (!eventos || !eventos.length) return []
  const cat = await carregarCatalogos()

  return eventos.map(e => ({
    ...e,
    resumo: montarResumo(e),
    mudancas: montarMudancas(e, cat)
  }))
}

module.exports = {
  enriquecer,
  montarMudancas,
  montarResumo,
  textoDoValor,
  carregarCatalogos,
  invalidarCatalogos
}
