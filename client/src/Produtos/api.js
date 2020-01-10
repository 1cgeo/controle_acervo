import { api } from '../services'

const getTiposProduto = async () => {
  return api.getData('/tipos_produto')
}

const atualizaTipoProduto = async (id, nome) => {
  return api.put(`/tipos_produto/${id}`, { nome })
}

const deletaTipoProduto = async id => {
  return api.delete(`/tipos_produto/${id}`)
}

const criaTipoProduto = async (nome) => {
  return api.post('/tipos_produto', { nome })
}

export { getTiposProduto, atualizaTipoProduto, deletaTipoProduto, criaTipoProduto }
