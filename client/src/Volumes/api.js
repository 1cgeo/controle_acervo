import { api } from "../services";

const getData = async () => {
  return api.axiosAll({
    volumes: api.getData("/api/volumes"),
    tipoProduto: api.getData("/api/tipos_produto"),
    associacao: api.getData("/api/volumes/associacao")
  });
};

const atualizaVolume = async (id, volume) => {
  return api.put(`/api/volumes/${id}`, {
    volume
  });
};

const deletaVolume = async id => {
  return api.delete(`/api/volumes/${id}`);
};

const criaVolume = async volume => {
  return api.post("/api/volumes", {
    volume
  });
};

const atualizaAssociacao = async (id, tipoProdutoId, volumeId, primario) => {
  return api.put(`/api/volumes/associacao/${id}`, {
    tipo_produto_id: tipoProdutoId,
    volume_armazenamento_id: volumeId,
    primario
  });
};

const deletaAssociacao = async id => {
  return api.delete(`/api/volumes/associacao/${id}`);
};

const criaAssociacao = async (tipoProdutoId, volumeId, primario) => {
  return api.post("/api/volumes/associacao", {
    tipo_produto_id: tipoProdutoId,
    volume_armazenamento_id: volumeId,
    primario
  });
};

export {
  getData,
  atualizaVolume,
  deletaVolume,
  criaVolume,
  atualizaAssociacao,
  deletaAssociacao,
  criaAssociacao
};
