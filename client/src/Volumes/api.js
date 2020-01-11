import { api } from '../services'

const getData = async () => {
  return api.axiosAll({
    volumes: api.getData('/api/volume'),
    tipoProduto: api.getData('/api/tipos_produdo')
  })
}

const atualizaVolume = async (id, tipoProdutoId, volume, primario) => {
  return api.put(`/api/volumes/${id}`, { tipo_produto_id: tipoProdutoId, volume, primario })
}

const deletaVolume = async id => {
  return api.delete(`/api/volumes/${id}`)
}

const criaVolume = async (tipoProdutoId, volume, primario) => {
  return api.post('/api/volumes', { tipo_produto_id: tipoProdutoId, volume, primario })
}

export { getData, atualizaVolume, deletaVolume, criaVolume }
