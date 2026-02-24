'use strict'

const loginSchema = require('../../../login/login_schema')

describe('Login Schema', () => {
  describe('login', () => {
    it('should validate correct login data', () => {
      const { error } = loginSchema.login.validate({
        usuario: 'admin',
        senha: 'password123',
        cliente: 'sca_web'
      })
      expect(error).toBeUndefined()
    })

    it('should accept sca_qgis as valid client', () => {
      const { error } = loginSchema.login.validate({
        usuario: 'admin',
        senha: 'pass',
        cliente: 'sca_qgis'
      })
      expect(error).toBeUndefined()
    })

    it('should reject invalid client value', () => {
      const { error } = loginSchema.login.validate({
        usuario: 'admin',
        senha: 'pass',
        cliente: 'invalid_client'
      })
      expect(error).toBeDefined()
    })

    it('should require usuario', () => {
      const { error } = loginSchema.login.validate({
        senha: 'pass',
        cliente: 'sca_web'
      })
      expect(error).toBeDefined()
    })

    it('should require senha', () => {
      const { error } = loginSchema.login.validate({
        usuario: 'admin',
        cliente: 'sca_web'
      })
      expect(error).toBeDefined()
    })

    it('should require cliente', () => {
      const { error } = loginSchema.login.validate({
        usuario: 'admin',
        senha: 'pass'
      })
      expect(error).toBeDefined()
    })
  })
})
