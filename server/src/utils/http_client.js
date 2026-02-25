'use strict'

const axios = require('axios')

const { USE_PROXY } = require('../config')

const httpClient = axios.create(
  USE_PROXY ? {} : { proxy: false }
)

module.exports = httpClient