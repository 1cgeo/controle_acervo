'use strict'

// O `testTimeout` do jest.config.js vale para TESTE, e nao para HOOK.
//
// Um `afterEach` herda o padrao de 5 s do Jest mesmo com `testTimeout: 30000`
// configurado. Quem estende o prazo dos hooks e o `jest.setTimeout()` chamado
// DENTRO do arquivo de teste, e por isso este setup existe: ele roda depois do
// framework carregar e vale para todos os arquivos do pacote de banco.
//
// O QUE ISSO CUSTAVA. O `afterEach` do pacote de banco chama `cleanTestData()`,
// que trunca dezenas de tabelas em transacao. Rodando em paralelo com os outros
// workers, ele passa dos 5 s de vez em quando: em tres rodadas cheias, duas
// tiveram suite vermelha por esse motivo, com o numero de falhas mudando entre
// elas. Nao era defeito do codigo, e as mesmas suites passavam sozinhas.
//
// Suite que falha a toa e pior que suite lenta: ela ensina a ignorar vermelho, e
// o dia em que o vermelho for de verdade ninguem vai olhar.
//
// 30 s e o MESMO numero do `testTimeout`, de proposito: um so limite para
// lembrar, e a limpeza real leva menos de um segundo quando a maquina esta
// livre.
jest.setTimeout(30000)
