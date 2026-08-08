'use strict'

// Modulo EQUIPAMENTO: o parque de material da Divisao.
//
// Feature de MODULO, e nao de plataforma: ela tem prefixo de rota
// (`/api/equipamento`), tela propria e perfil proprio em `dominio.modulo`. Quem
// atende a mapoteca nao precisa mexer na carga de estacao total, e quem cuida do
// parque nao precisa catalogar o acervo.
//
// A estrutura e a de quatro arquivos da casa (`index`, `*_ctrl`, `*_route`,
// `*_schema`), mais o gerador do .ods do Relatorio DMT, que tem arquivo proprio
// porque montar um pacote OpenDocument nao e assunto de controlador.

module.exports = {
  equipamentoRoute: require('./equipamento_route')
}
