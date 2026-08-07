'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const contrato = require('../lib/contrato')

// Fixture com a anatomia medida na tela docNcuq1.php em 2026-08-07: um seletor
// de colunas, seletores de dimensao com name terminado em [], e os campos de
// periodo obrigatorios. Nao e a tela inteira; e o que o parser precisa ver.
const TELA = `
<html><body>
  <form id="formulario">
    <input type="text" id="searchInput" name="searchInput" placeholder="Buscar na p&aacute;gina...">
    <input type="text" id="DATAINI" name="DATAINI" placeholder="DATA EMISS&Atilde;O INICIAL" required="" readonly>
    <input type="text" id="DATAFIM" name="DATAFIM" placeholder="DATA EMISS&Atilde;O FINAL" required="">
    <input type="text" id="NUMERO_NC" name="NUMERO_NC" placeholder="NOTA DE CREDITO">
    <input type="hidden" name="csrf" value="x">
    <select id="coluna" name="coluna[]" multiple>
      <option value="NUMERO_NC" selected>N&Uacute;MERO NC</option>
      <option value="DATA_EMISSAO" selected>DATA EMISS&Atilde;O</option>
      <option value="OBS">OBS</option>
      <option value="VALOR_NC">VALOR NC</option>
    </select>
    <select id="filtro" name="filtro[]" multiple>
      <option value="1">ignorar</option>
    </select>
    <select id="ND" name="ND[]" multiple>
      <option value="">todas</option>
      <option value="339015">339015 - Di&aacute;rias</option>
      <option value="339030">339030 - Material de Consumo</option>
    </select>
    <select id="UG_FAV" name="UG_FAV[]" multiple>
      <option value="160382">160382 - 1&ordm; CGEO</option>
    </select>
  </form>
</body></html>`

test('ler extrai as colunas com rotulo e marcacao', () => {
  const lido = contrato.ler(TELA)
  assert.deepStrictEqual(lido.colunas.map(c => c.campo),
    ['NUMERO_NC', 'DATA_EMISSAO', 'OBS', 'VALOR_NC'])
  assert.strictEqual(lido.colunas[0].rotulo, 'NÚMERO NC')
  assert.deepStrictEqual(lido.padraoDaPagina, ['NUMERO_NC', 'DATA_EMISSAO'])
})

test('ler separa seletores de campos de texto', () => {
  const lido = contrato.ler(TELA)
  const campos = lido.filtros.map(f => f.campo)
  assert.ok(campos.includes('ND'))
  assert.ok(campos.includes('UG_FAV'))
  // O seletor de colunas e o de "filtro" da propria tela nao sao dimensoes.
  assert.ok(!campos.includes('coluna'))
  assert.ok(!campos.includes('filtro'))

  const textos = lido.textos.map(t => t.nome)
  assert.deepStrictEqual(textos, ['DATAINI', 'DATAFIM', 'NUMERO_NC'])
  // O campo de busca da tela e o hidden nao sao filtro da consulta.
  assert.ok(!textos.includes('searchInput'))
  assert.ok(!textos.includes('csrf'))
})

test('a opcao vazia do seletor nao vira valor de dominio', () => {
  const lido = contrato.ler(TELA)
  const nd = lido.filtros.find(f => f.campo === 'ND')
  assert.deepStrictEqual(nd.valores.map(v => v.valor), ['339015', '339030'])
})

test('o periodo obrigatorio chega marcado como obrigatorio', () => {
  const lido = contrato.ler(TELA)
  assert.strictEqual(lido.textos.find(t => t.nome === 'DATAINI').obrigatorio, true)
  assert.strictEqual(lido.textos.find(t => t.nome === 'NUMERO_NC').obrigatorio, false)
})

test('tela sem seletor de colunas falha com mensagem util', () => {
  assert.throws(
    () => contrato.ler('<html><body><p>outra pagina</p></body></html>'),
    /nao tem o seletor de colunas/
  )
})

test('conferirColunas recusa coluna inexistente em vez de devolver vazia', () => {
  const lido = contrato.ler(TELA)
  assert.throws(
    () => contrato.conferirColunas(lido, ['NUMERO_NC', 'NAO_EXISTE']),
    /Coluna inexistente/
  )
  assert.doesNotThrow(() => contrato.conferirColunas(lido, ['NUMERO_NC', 'OBS']))
})

test('conferirFiltros recusa campo inexistente e so AVISA valor fora da lista', () => {
  const lido = contrato.ler(TELA)
  assert.throws(() => contrato.conferirFiltros(lido, { NAO_EXISTE: ['x'] }), /Filtro inexistente/)

  const avisos = contrato.conferirFiltros(lido, { ND: ['339015', '449052'] })
  assert.strictEqual(avisos.length, 1)
  assert.match(avisos[0], /449052/)
})

test('semTags limpa o botao que o SAG devolve dentro da celula', () => {
  const celula = '<button class="btn" onclick=\'geradocNC("x");\'>2026NC402171</button>'
  assert.strictEqual(contrato.semTags(celula), '2026NC402171')
})
