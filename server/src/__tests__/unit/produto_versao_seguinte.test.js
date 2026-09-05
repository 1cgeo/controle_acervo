'use strict'

// `produtoCtrl.versaoSeguinte`: quem e a versao SEGUINTE a esta.
//
// POR QUE ELA EXISTE. `deleteVersoes` recusa apagar versao INTERMEDIARIA: se a
// seguinte esta no acervo, ela se apoia nesta, e apagar a de baixo deixa a de
// cima descrevendo uma edicao que nao existe mais. Ate 2026-09-05 a guarda
// reconhecia so o rotulo NOVO (`N-SIGLA`), e uma `2ª Edição` saia sem aviso
// nenhum com a `3ª Edição` presente.
//
// OS DOIS FORMATOS SAO IGUALMENTE VALIDOS, e quem diz isso e o gatilho
// `acervo.validate_version` (`er/acervo.sql`), que aceita exatamente
// `^[0-9]+ª Edição$` e `^[0-9]+-[A-Z]{1,5}$`. Os regex daqui sao os mesmos, e
// e por isso que este arquivo existe separado do caso de rota: o caso de rota
// precisa de PostgreSQL e prova UM cenario, e quando ele fica vermelho nao diz
// qual dos dois formatos quebrou.
//
// O banco nao entra aqui: `versaoSeguinte` e funcao pura sobre o rotulo.

const produtoCtrl = require('../../produto/produto_ctrl')

const { versaoSeguinte } = produtoCtrl

describe('versaoSeguinte, formato novo "N-SIGLA"', () => {
  it.each([
    ['1-DSG', '2-DSG'],
    ['2-DSG', '3-DSG'],
    ['9-CIGEX', '10-CIGEX'],
    ['10-DSG', '11-DSG']
  ])('%s vem antes de %s', (rotulo, esperado) => {
    expect(versaoSeguinte(rotulo)).toBe(esperado)
  })

  it('a sigla atravessa inteira, e nao vira outra', () => {
    expect(versaoSeguinte('3-CIGEX')).toBe('4-CIGEX')
  })
})

// A FAMILIA QUE FALTAVA. Sem estes casos, a correcao de 2026-09-05 nao esta
// provada: o arquivo inteiro passaria com a funcao devolvendo `null` para todo
// rotulo legado, que e exatamente o defeito.
describe('versaoSeguinte, formato legado "Nª Edição"', () => {
  it.each([
    ['1\u00aa Edi\u00e7\u00e3o', '2\u00aa Edi\u00e7\u00e3o'],
    ['2\u00aa Edi\u00e7\u00e3o', '3\u00aa Edi\u00e7\u00e3o'],
    ['9\u00aa Edi\u00e7\u00e3o', '10\u00aa Edi\u00e7\u00e3o']
  ])('%s vem antes de %s', (rotulo, esperado) => {
    expect(versaoSeguinte(rotulo)).toBe(esperado)
  })

  // O ordinal FEMININO (U+00AA) e o acento fazem parte do rotulo. Trocados pelo
  // 'a' comum ou por "Edicao" sem cedilha, o gatilho do banco ja teria recusado
  // a linha, e reconhece-los aqui seria proteger rotulo que nao existe.
  it('recusa o quase-rotulo: sem ordinal, sem acento, ou com "edicao" minusculo', () => {
    expect(versaoSeguinte('2a Edi\u00e7\u00e3o')).toBeNull()
    expect(versaoSeguinte('2\u00aa Edicao')).toBeNull()
    expect(versaoSeguinte('2\u00aa edi\u00e7\u00e3o')).toBeNull()
    expect(versaoSeguinte('2\u00aa  Edi\u00e7\u00e3o')).toBeNull()
  })
})

describe('versaoSeguinte, rotulo sem sucessor', () => {
  // ANCORAS. Sem `^` e `$`, "produto 1-DSG antigo" casaria e a guarda passaria a
  // proteger uma versao que o banco nunca aceitou. E o mesmo cuidado que
  // `er/acervo.sql` documenta ao lado do gatilho.
  it.each([
    'Edicao unica',
    'versao 1-DSG',
    '1-DSG rev',
    '1-dsg',
    '1-ABCDEF',
    '-DSG',
    '',
    null,
    undefined
  ])('%s nao tem seguinte', (rotulo) => {
    expect(versaoSeguinte(rotulo)).toBeNull()
  })
})
