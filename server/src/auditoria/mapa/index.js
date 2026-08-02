'use strict'

/**
 * O MAPA DE ENTIDADES: a unica declaracao de o que se audita e como se le.
 *
 * CONTRATO DE UMA ENTRADA
 * -----------------------
 * A chave e sempre `schema.tabela`, qualificada. 'arquivo' sozinho e ambiguo
 * entre `acervo`, `orcamento` e `ponto_controle`.
 *
 *   'mapoteca.produto_pedido': {
 *     modulo: 'mapoteca',        // OBRIGATORIO. acervo | mapoteca | orcamento | plataforma
 *     entidade: 'pedido',        // OBRIGATORIO. O AGREGADO DONO, nao a tabela.
 *
 *     // `entidade` tambem aceita FUNCAO da linha, para a tabela cujo dono nao e
 *     // fixo. Uma so no sistema: `orcamento.arquivo`, que pertence a exatamente
 *     // um de nota_credito_id, dfd_id ou pdr_ano (CHECK arquivo_um_vinculo).
 *     // Nao use a forma de funcao onde a entidade e constante: texto se le como
 *     // declaracao, e a funcao convida a inventar regra.
 *
 *     // OBRIGATORIO. Como chegar do registro ao id do agregado dono.
 *     // Recebe (t, linha) e devolve o id; pode ser assincrona quando o dono
 *     // esta a um salto de distancia (o arquivo do acervo aponta a versao, e o
 *     // produto esta adiante).
 *     agregado: (t, linha) => linha.pedido_id,
 *
 *     // OBRIGATORIO. A frase curta que identifica o registro na tela. E o que
 *     // aparece em vez de 20 campos numa INSERCAO ou numa EXCLUSAO, onde listar
 *     // campo a campo nao informa nada.
 *     resumo: linha => `Item ${linha.nome_avulso || linha.uuid_versao}`,
 *
 *     omitir: ['conteudo'],      // colunas que NUNCA entram no JSON (senha, BYTEA)
 *     geometrias: ['geom'],      // colunas geometricas, lidas em EWKT
 *
 *     // Rotulo, tipo e dominio por campo. A ORDEM desta declaracao e a ORDEM em
 *     // que as mudancas aparecem na tela, e ela espelha a ordem da ficha: assim
 *     // o historico se le na mesma sequencia do formulario que o produziu.
 *     campos: {
 *       quantidade:    { rotulo: 'Quantidade', tipo: 'numero' },
 *       tipo_midia_id: { rotulo: 'Midia', dominio: 'mapoteca.tipo_midia' },
 *       pedido_id:     { rotulo: 'Pedido', entidade: 'pedido' },
 *       // Quando a coluna de rotulo do dominio nao se chama `nome` (o ponto de
 *       // controle chama `code_name` em 12 das 14 dele):
 *       tipo_marco_id: { rotulo: 'Marco',
 *                        dominio: { tabela: 'ponto_controle.tipo_marco_limite',
 *                                   rotulo: 'code_name' } }
 *     }
 *   }
 *
 * TIPOS ACEITOS em `campos`: 'texto' (default), 'numero', 'data', 'data_hora',
 * 'dinheiro', 'booleano', 'geometria', 'lista'. Mais `dominio` (traduz pelo
 * catalogo, cache do servidor) e `entidade` (NAO traduz: sai o id com link, veja
 * abaixo).
 *
 * CAMPO SINTETICO (`sintetico: true`). Nem todo campo do evento e coluna da
 * tabela. A lista de itens do DFD e o rateio da NE sao reescritos INTEIROS a
 * cada salvamento (apaga tudo e reinsere), entao id e carimbo mudam sempre, e
 * comparar linha a linha acusaria mudanca em todo salvamento: o historico do DFD
 * viraria "removeu 4 itens, acrescentou 4 itens" toda vez que alguem abrisse e
 * salvasse. A saida e UM evento do PAI, com a lista descrita em texto num campo
 * que o controller monta. Esse campo tem de ser declarado `sintetico: true`,
 * porque a varredura de `__tests__/auditoria/mapa.test.js` confere cada campo
 * declarado contra as colunas dos `er/*.sql`: sem a marca, ou o teste reprova o
 * campo legitimo, ou (se afrouxado) deixaria passar o erro de digitacao num nome
 * de coluna de verdade, que e o que ele existe para pegar.
 *
 * POR QUE `entidade` NAO TRADUZ. O nome do cliente pode ter mudado depois do
 * evento. Mostrar "12o BE Cmb" ao lado de um evento de um ano atras afirma que o
 * pedido era daquele cliente com aquele nome, e pode ser falso. Dominio traduz
 * porque catalogo de dominio e estavel -- e quando ele muda, a mudanca e ela
 * mesma um evento auditado.
 *
 * CAMPO NAO DECLARADO NAO SOME DA TELA. Ele aparece com o proprio nome de coluna
 * e o valor cru. E a mesma regra que o `NOME_TABELA` da tela do pedido ja seguia:
 * coluna nova entra no historico enquanto ninguem a declarou, em vez de virar
 * uma mudanca invisivel. Um mapa que silencia o desconhecido esconde justamente
 * o campo que ninguem esta olhando.
 *
 * TABELA AUDITADA QUE NAO ESTA AQUI E ERRO EM TEMPO DE EXECUCAO, e nao um evento
 * com modulo vazio: evento sem agregado nao aparece em ficha nenhuma, e ninguem
 * descobriria a falta.
 *
 * PSEUDO-TABELA (`pseudoTabela: true`). Quatro acoes do sistema mudam estado sem
 * ter uma linha antes e depois: as duas visoes materializadas, a limpeza de
 * downloads expirados e a verificacao de volume. Elas geram evento de OPERACAO
 * (`registrarOperacao`), e o alvo delas nao e uma tabela do banco -- e a acao em
 * si. Uma entrada dessas se declara `pseudoTabela: true`, pelo MESMO motivo do
 * `sintetico`: a varredura confere cada chave contra os `CREATE TABLE` dos
 * `er/*.sql`, e sem a marca ou o teste reprova a entrada legitima, ou (se
 * afrouxado) deixaria passar o erro de digitacao num nome de tabela de verdade,
 * que e o que ele existe para pegar.
 *
 * POR QUE UM ARQUIVO POR MODULO. Sao ~60 tabelas. Num arquivo so, duas pessoas
 * (ou dois agentes) mexendo em modulos diferentes colidem na mesma linha. Aqui
 * cada modulo tem o seu, e este indice so junta e confere.
 */

const acervo = require('./acervo')
const mapoteca = require('./mapoteca')
const orcamento = require('./orcamento')
const plataforma = require('./plataforma')

const MODULOS_VALIDOS = new Set(['acervo', 'mapoteca', 'orcamento', 'plataforma'])

const mapa = { ...acervo, ...mapoteca, ...orcamento, ...plataforma }

// Conferencia no CARREGAMENTO do modulo, e nao na primeira escrita: entrada mal
// formada derruba o boot com a mensagem certa, em vez de derrubar uma transacao
// de producao no meio de um cadastro. E a mesma politica do verifyPerfil, que
// recusa modulo desconhecido ao montar a rota.
for (const [chave, entrada] of Object.entries(mapa)) {
  if (!chave.includes('.')) {
    throw new Error(`Mapa de auditoria: a chave "${chave}" precisa ser schema.tabela`)
  }
  if (!MODULOS_VALIDOS.has(entrada.modulo)) {
    throw new Error(`Mapa de auditoria: modulo desconhecido em "${chave}": ${entrada.modulo}`)
  }
  if (!entrada.entidade) {
    throw new Error(`Mapa de auditoria: falta "entidade" em "${chave}"`)
  }
  if (typeof entrada.agregado !== 'function') {
    throw new Error(`Mapa de auditoria: "agregado" de "${chave}" precisa ser funcao`)
  }
  if (typeof entrada.resumo !== 'function') {
    throw new Error(`Mapa de auditoria: "resumo" de "${chave}" precisa ser funcao`)
  }
}

/**
 * A entrada de uma tabela, ou erro se ela nao foi declarada.
 * @param {string} tabela - 'schema.tabela'
 * @returns {object}
 */
const entradaDe = tabela => {
  const entrada = mapa[tabela]
  if (!entrada) {
    throw new Error(
      `Tabela "${tabela}" nao esta no mapa de auditoria (server/src/auditoria/mapa/). ` +
      'Declare-a antes de auditar: sem agregado, o evento nao apareceria em ficha nenhuma.'
    )
  }
  return entrada
}

/** Todas as chaves declaradas, para os testes de varredura. */
const tabelasDeclaradas = () => Object.keys(mapa)

/**
 * Normaliza a declaracao de dominio de um campo.
 *
 * `dominio` aceita duas formas, e a segunda existe porque a coluna de rotulo NAO
 * e sempre `nome`: das 14 tabelas de dominio do ponto de controle, 12 chamam a
 * coluna de `code_name`. Enquanto so a primeira forma existia, elas nao podiam
 * ser declaradas.
 *
 *   dominio: 'dominio.tipo_produto'
 *   dominio: { tabela: 'ponto_controle.tipo_marco_limite', rotulo: 'code_name' }
 *
 * @param {string|object} dominio
 * @returns {{tabela: string, chave: string, rotulo: string}}
 */
const normalizarDominio = dominio => {
  if (typeof dominio === 'string') {
    return { tabela: dominio, chave: 'code', rotulo: 'nome' }
  }
  return {
    tabela: dominio.tabela,
    chave: dominio.chave || 'code',
    rotulo: dominio.rotulo || 'nome'
  }
}

/**
 * Os dominios citados por algum campo, ja normalizados, que o cache do servidor
 * carrega. Um dominio citado por dois campos entra UMA vez.
 */
const dominiosCitados = () => {
  const porTabela = new Map()
  for (const entrada of Object.values(mapa)) {
    for (const decl of Object.values(entrada.campos || {})) {
      if (!decl.dominio) continue
      const normal = normalizarDominio(decl.dominio)
      porTabela.set(normal.tabela, normal)
    }
  }
  return [...porTabela.values()]
}

module.exports = {
  mapa,
  entradaDe,
  tabelasDeclaradas,
  dominiosCitados,
  normalizarDominio,
  MODULOS_VALIDOS
}
