import { api } from '../services'

const getData = async () => {
  return api.axiosAll({
    volumes: api.getData('/volume'),
    tipoProduto: api.getData('/tipos_produdo')
  })
}

const atualizaVolume = async (id, tipoProdutoId, volume, primario) => {
  return api.put(`/volumes/${id}`, { tipo_produto_id: tipoProdutoId, volume, primario })
}

const deletaVolume = async id => {
  return api.delete(`/volumes/${id}`)
}

const criaVolume = async (tipoProdutoId, volume, primario) => {
  return api.post('/volumes', { tipo_produto_id: tipoProdutoId, volume, primario })
}

export { getData, atualizaVolume, deletaVolume, criaVolume }
