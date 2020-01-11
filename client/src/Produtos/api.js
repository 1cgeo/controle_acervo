import { api } from '../services'

const getTiposProduto = async () => {
  return api.getData('/api/tipos_produto')
}

const atualizaTipoProduto = async (id, nome) => {
  return api.put(`/api/tipos_produto/${id}`, { nome })
}

const deletaTipoProduto = async id => {
  return api.delete(`/api/tipos_produto/${id}`)
}

const criaTipoProduto = async (nome) => {
  return api.post('/api/tipos_produto', { nome })
}

export { getTiposProduto, atualizaTipoProduto, deletaTipoProduto, criaTipoProduto }
