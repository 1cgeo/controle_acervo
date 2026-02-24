'use strict'

const jwt = require('jsonwebtoken')
const { JWT_SECRET } = require('../../config')

const ADMIN_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const USER_UUID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'

/**
 * Generates a valid JWT token for the test admin user.
 */
const generateAdminToken = () => {
  return jwt.sign(
    { id: 1, uuid: ADMIN_UUID, administrador: true },
    JWT_SECRET,
    { expiresIn: '1h' }
  )
}

/**
 * Generates a valid JWT token for the test regular user.
 */
const generateUserToken = () => {
  return jwt.sign(
    { id: 2, uuid: USER_UUID, administrador: false },
    JWT_SECRET,
    { expiresIn: '1h' }
  )
}

/**
 * Generates a JWT token with custom payload.
 */
const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
}

/**
 * Returns an expired JWT token for testing auth failures.
 */
const generateExpiredToken = () => {
  return jwt.sign(
    { id: 1, uuid: ADMIN_UUID, administrador: true },
    JWT_SECRET,
    { expiresIn: '0s' }
  )
}

module.exports = {
  ADMIN_UUID,
  USER_UUID,
  generateAdminToken,
  generateUserToken,
  generateToken,
  generateExpiredToken
}
