'use strict'

// O bug que estes testes guardam derrubou TODO download pelo navegador quando o
// servidor subiu em Linux: o volume esta gravado como UNC do
// Windows e o `path.join` do POSIX trata `\\host\share` como nome de arquivo.
// Nao dava erro no deploy nem no log de subida; dava 404 em cada arquivo.
//
// Nao da para testar isso rodando so na plataforma corrente, entao os testes
// forcam `process.platform` nos dois valores. Sem isso o Linux da CI passaria
// verde no caminho do Windows e vice-versa, que e exatamente como o bug escapou.

const path = require('path')

// Host FICTICIO de proposito: este repositorio e publico. A UNC aqui e o
// OBJETO do teste, e nao um caminho de maquina real.
const UNC = `\\\\servidor-de-arquivos\\acervo_sca` // path-ok

const comPlataforma = (plataforma, fn) => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: plataforma, configurable: true })
  try {
    // O modulo le process.platform em cada chamada, mas recarregar mantem o
    // teste honesto caso alguem passe a resolver isso no carregamento.
    delete require.cache[require.resolve('../../utils/caminho_volume')]
    return fn(require('../../utils/caminho_volume'))
  } finally {
    Object.defineProperty(process, 'platform', original)
    delete require.cache[require.resolve('../../utils/caminho_volume')]
  }
}

describe('caminhoNoVolume', () => {
  const envOriginal = { ...process.env }
  afterEach(() => {
    process.env = { ...envOriginal }
  })

  it('no Windows devolve a UNC intacta, que e o comportamento de sempre', () => {
    const r = comPlataforma('win32', m => m.caminhoNoVolume(UNC, 'CO_s03_2991-3-SO_1dsg.tif'))
    expect(r).toBe(`${UNC}\\CO_s03_2991-3-SO_1dsg.tif`)
  })

  it('no Linux, com VOLUMES_RAIZ, a UNC vira o ponto de montagem', () => {
    process.env.VOLUMES_RAIZ = '/mnt'
    delete process.env.VOLUME_ACERVO_SCA_CAMINHO
    const r = comPlataforma('linux', m => m.caminhoNoVolume(UNC, 'CO_s03_2991-3-SO_1dsg.tif'))
    // O HOST sai do caminho: no Linux quem resolve o host e a montagem.
    expect(r).toBe('/mnt/acervo_sca/CO_s03_2991-3-SO_1dsg.tif')
  })

  it('no Linux, a chave do share MANDA sobre a convencao', () => {
    process.env.VOLUMES_RAIZ = '/mnt'
    process.env.VOLUME_ACERVO_SCA_CAMINHO = '/dados/acervo'
    const r = comPlataforma('linux', m => m.caminhoNoVolume(UNC, 'x.tif'))
    expect(r).toBe('/dados/acervo/x.tif')
  })

  it('no Linux SEM configuracao devolve o valor cru, para o erro dizer o que falta', () => {
    delete process.env.VOLUMES_RAIZ
    delete process.env.VOLUME_ACERVO_SCA_CAMINHO
    const r = comPlataforma('linux', m => m.caminhoNoVolume(UNC, 'x.tif'))
    // Adivinhar um /mnt qualquer daria erro mais dificil de ler que este.
    expect(r).toContain(UNC)
  })

  it('aceita mais de um segmento, como o ponto de controle exige', () => {
    process.env.VOLUMES_RAIZ = '/mnt'
    delete process.env.VOLUME_ACERVO_SCA_CAMINHO
    const r = comPlataforma('linux', m => m.caminhoNoVolume(UNC, 'PC-0001', 'foto.jpg'))
    expect(r).toBe('/mnt/acervo_sca/PC-0001/foto.jpg')
  })

  it('descarta segmento vazio, em vez de gerar barra dupla no meio', () => {
    process.env.VOLUMES_RAIZ = '/mnt'
    const r = comPlataforma('linux', m => m.caminhoNoVolume(UNC, '', null, 'x.tif'))
    expect(r).toBe('/mnt/acervo_sca/x.tif')
  })

  it('volume que JA e POSIX passa direto, sem traducao', () => {
    process.env.VOLUMES_RAIZ = '/mnt'
    const r = comPlataforma('linux', m => m.caminhoNoVolume('/dados/acervo', 'x.tif'))
    expect(r).toBe('/dados/acervo/x.tif')
  })

  it('a chave do share sai do proprio valor do volume', () => {
    const k = comPlataforma('linux', m => m.chaveDoShare(UNC))
    expect(k).toBe('VOLUME_ACERVO_SCA_CAMINHO')
    // Nao-alfanumerico vira _, para o nome do share caber numa chave de ambiente.
    const k2 = comPlataforma('linux', m => m.chaveDoShare(`\\\\host\\ponto-controle`))
    expect(k2).toBe('VOLUME_PONTO_CONTROLE_CAMINHO')
  })

  it('nao confunde caminho relativo com UNC', () => {
    const m = require('../../utils/caminho_volume')
    expect(m.ehUNC('/mnt/acervo')).toBe(false)
    expect(m.ehUNC('C:\\acervo')).toBe(false)
    expect(m.ehUNC(UNC)).toBe(true)
  })
})
