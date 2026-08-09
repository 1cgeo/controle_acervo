'use strict'

const perigoRoute = require('./perigo_route')

// O schema sai nomeado porque os TOKENS de confirmacao vivem nele, e quem os
// cita (a rota, o teste, e amanha o cliente) tem de citar a mesma constante. Duas
// copias da palavra `apagar_ut_sem_atividade` divergiriam na primeira correcao de
// grafia, e a rota passaria a recusar toda confirmacao correta.
const perigoSchema = require('./perigo_schema')

module.exports = { perigoRoute, perigoSchema }
