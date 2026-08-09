'use strict'

// A PODA DE `pit.execucao.data_conclusao` E `pit.execucao.observacao`, do lado
// do CODIGO. O lado do BANCO (o `information_schema` e o CHECK de dois termos)
// se prova em `integration/pit_execucao_resumo.test.js`, contra o PostgreSQL.
//
// POR QUE ELAS SAIRAM. Medido em 2026-08-08 contra a producao restaurada: sao as
// unicas 2 colunas das 88 do schema `pit` nulas em 100% das linhas (0 de 109,
// nas duas), com ZERO eventos numa auditoria de 144 e sem nenhuma mensagem de
// commit que as justificasse. Sao o mesmo erro que deixou de fora as colunas
// `Situacao` e `Pronto` da planilha EXEC_PIT: campo inventado sem se saber o que
// ele guarda.
//
// POR QUE ISTO SE TESTA LENDO O FONTE. A coluna some do banco numa migracao, e o
// SQL que ainda a cita so falha quando alguem abre a tela -- com "coluna nao
// existe" e um 500 cru. A varredura e o que faz a poda ser de uma vez, em vez de
// aparecer meses depois na abertura de uma tela que ninguem associou a ela. E a
// mesma razao do `modulo_em_toda_rota.test.js`.

const fs = require('fs')
const path = require('path')

const schemas = require('../../pit/pit_schema')

const PODADAS = ['data_conclusao', 'observacao']

const ler = arquivo =>
  fs.readFileSync(path.join(__dirname, '..', '..', arquivo), 'utf8')

/**
 * O fonte SEM COMENTÁRIO, que é o que a varredura tem de olhar.
 *
 * O arquivo CITA as duas colunas de propósito, para dizer por que elas saíram e
 * o que a poda matou junto. Uma varredura de texto cru proibiria essa explicação
 * -- e o comentário que conta o motivo é justamente o que este repositório não
 * abre mão de ter. Caem as linhas de comentário de JS (`//`, `*`) e as de SQL
 * (`--`) dentro dos template literals.
 */
const semComentarios = fonte => fonte
  .split('\n')
  .filter(linha => !/^\s*(\/\/|\/\*|\*|--)/.test(linha))
  .join('\n')

describe('o Joi da celula nao oferece mais as duas colunas', () => {
  const chaves = Object.keys(schemas.salvarExecucao.describe().keys)

  test.each(PODADAS)('%s saiu de salvarExecucao', coluna => {
    expect(chaves).not.toContain(coluna)
  })

  // O CONTROLE. Sem ele, apagar o schema inteiro faria o caso acima passar.
  // Os quatro que ficam sao o contrato vivo que o `pit_cli` le.
  test('os quatro campos que ficam continuam la', () => {
    expect(chaves.sort()).toEqual(
      ['mes', 'meta_id', 'quantidade', 'quantidade_planejada'].sort()
    )
  })

  // NULO E ZERO CONTINUAM DIFERENTES nos dois numeros, e e o que a poda nao
  // podia levar junto: nulo e "ninguem lancou" e zero e "conferi e nao houve".
  test.each(['quantidade', 'quantidade_planejada'])(
    '%s aceita zero E aceita nulo, que sao coisas diferentes',
    campo => {
      const zero = schemas.salvarExecucao.validate(
        { meta_id: 1, mes: 3, [campo]: 0 }
      )
      expect(zero.error).toBeUndefined()
      expect(zero.value[campo]).toBe(0)

      const nulo = schemas.salvarExecucao.validate(
        { meta_id: 1, mes: 3, [campo]: null }
      )
      expect(nulo.error).toBeUndefined()
      expect(nulo.value[campo]).toBeNull()
    }
  )
})

describe('o SQL do PIT nao cita mais as duas colunas', () => {
  // O CONTROLADOR DA GRADE e o unico que as lia: a CTE `celula`, a grade, o
  // `listarDaMeta`, o teste de "celula vazia" e o merge de `salvar`.
  const bruto = ler(path.join('pit', 'pit_execucao_ctrl.js'))
  const fonte = semComentarios(bruto)

  test.each(PODADAS)('%s sumiu do codigo de pit_execucao_ctrl.js', coluna => {
    // A busca e por PALAVRA INTEIRA: `observacao` casaria dentro de
    // `observacao_envio` da mapoteca, que nao tem nada com isto.
    expect(fonte).not.toMatch(new RegExp(`\\b${coluna}\\b`))
  })

  // O CONTROLE DA VARREDURA. `semComentarios` e um filtro de texto, e um filtro
  // que come demais faria os dois casos acima passarem com o SQL intacto. Aqui
  // ele prova que o que sobrou continua sendo o codigo: o INSERT, o UPDATE e o
  // nome das duas colunas que FICAM.
  test('a varredura nao comeu o SQL junto com o comentario', () => {
    expect(fonte).toMatch(/INSERT INTO pit\.execucao/)
    expect(fonte).toMatch(/UPDATE pit\.execucao/)
    expect(fonte).toMatch(/\bquantidade_planejada\b/)
  })

  test('o teste de celula vazia passou a olhar os DOIS numeros', () => {
    // Enquanto ele olhava quatro campos, a linha que so tivesse observacao NAO
    // podia ser apagada pela tela, que so sabe mandar `planejada` e
    // `realizada`: a limpeza deixava a linha viva e invisivel.
    expect(fonte).toMatch(/const vazia = linha =>/)
    expect(fonte).toMatch(/linha\.quantidade_planejada == null &&\s*\n\s*linha\.quantidade == null/)
  })
})

/**
 * D2: A CTE `celula` E O FROM EXTERNO DO `resumoDoAno` LEEM A MESMA REVISAO.
 *
 * ESTE GUARDA E ESTRUTURAL, E E DE PROPOSITO. O `resumoDoAno` lia o FROM externo
 * de `pit.meta_em(<ultimo dia do mes>)` e a CTE lia `pit.meta_vigente`, que e a
 * revisao de HOJE: duas fontes para a mesma pergunta, e uma delas ignorando o
 * mes. Nenhum caso de COMPORTAMENTO separa os dois SQL hoje, e a razao esta
 * medida em `integration/pit_execucao_resumo.test.js`: `meta_em(d)` e
 * `meta_vigente` mais o predicado da data, entao um e subconjunto do outro por
 * construcao. Um teste de comportamento que "falhasse sem a correcao" teria de
 * ser inventado, e inventado ele nao guardaria nada.
 *
 * O QUE ELE PRENDE, ENTAO: que a segunda fonte nao volte. No dia em que
 * `meta_vigente` ganhar um filtro que `meta_em` nao tenha -- e ela ja e a unica
 * das duas sem teto de data --, a divergencia deixa de ser latente e o relatorio
 * de marco passa a mudar sozinho, sem escrita nenhuma. E a mesma classe de
 * guarda do `modulo_em_toda_rota.test.js`.
 */
describe('o resumo do ano le UMA revisao so', () => {
  const fonte = ler(path.join('pit', 'pit_execucao_ctrl.js'))

  // O corpo do `resumoDoAno`, do cabecalho ate onde o proximo comeca. Ler o
  // arquivo inteiro faria a `grade` e o `listarDaMeta` -- que sao telas de HOJE,
  // e leem `meta_vigente` com razao -- reprovarem este caso. E sem comentario,
  // pela mesma razao da varredura de cima: o SQL EXPLICA que lia
  // `pit.meta_vigente` e deixou de ler, e essa frase e para ficar.
  const resumo = semComentarios(fonte.slice(
    fonte.indexOf('controller.resumoDoAno'),
    fonte.indexOf('controller.listarDaMeta')
  ))

  test('o resumoDoAno nao cita pit.meta_vigente em lugar nenhum', () => {
    expect(resumo).not.toContain('pit.meta_vigente')
  })

  test('as DUAS fontes dele sao pit.meta_em', () => {
    const ocorrencias = resumo.match(/pit\.meta_em\(/g) || []
    expect(ocorrencias).toHaveLength(2)
  })

  // A DATA E ESCRITA UMA VEZ SO, e e o que impede as duas de divergirem no
  // proximo ajuste: com duas copias da expressao, mexer numa e esquecer a outra
  // recria o defeito sem erro de sintaxe e sem teste vermelho.
  test('a data da edicao e uma constante, e nao duas copias', () => {
    expect(fonte).toMatch(/const DATA_DA_EDICAO = /)
    const usos = resumo.match(/\$\{DATA_DA_EDICAO\}/g) || []
    expect(usos).toHaveLength(2)
  })

  // D1, no mesmo lugar: o filtro que tira a meta cancelada da 2.1. O
  // comportamento esta preso contra o banco; aqui se prende que ele esta na
  // consulta CERTA, e nao na `grade`, que ja o tinha.
  test('o resumoDoAno filtra a meta cancelada, como a grade ja fazia', () => {
    expect(resumo).toMatch(/cancelada IS NOT TRUE/)
  })
})

describe('o mapa de auditoria nao declara mais as duas colunas', () => {
  // Os eventos ANTIGOS que as citam continuam em `auditoria.evento` (aquele
  // schema nao tem DELETE), e `renderizar.js` exibe o campo sem declaracao pelo
  // PROPRIO nome de coluna. O rastro nao fica orfao: perde o apelido.
  const mapa = require('../../auditoria/mapa/plataforma')
  const campos = Object.keys(mapa['pit.execucao'].campos)

  test.each(PODADAS)('%s saiu do mapa de pit.execucao', coluna => {
    expect(campos).not.toContain(coluna)
  })

  test('os quatro que ficam continuam declarados, com rotulo', () => {
    expect(campos.sort()).toEqual(
      ['mes', 'meta_id', 'quantidade', 'quantidade_planejada'].sort()
    )
  })
})
