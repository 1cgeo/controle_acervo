'use strict'

const axios = require('axios')

const { USE_PROXY } = require('../config')

// Timeout para o auth server travado não pendurar logins indefinidamente
const httpClient = axios.create({
  timeout: 10000,
  ...(USE_PROXY ? {} : { proxy: false })
})

module.exports = httpClient
