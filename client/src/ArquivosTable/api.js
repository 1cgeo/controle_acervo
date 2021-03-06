import { api } from "../services";

let cancel;

const getDadosPaginacao = async (
  page,
  perPage,
  sortColumn,
  sortDirection,
  filtro
) => {
  if (typeof cancel !== "undefined") {
    cancel.cancel();
  }
  cancel = api.axios.CancelToken.source();
  const response = await api.getData(
    `/api/acervo/arquivos?pagina=${page}&total_pagina=${perPage}&coluna_ordem=${sortColumn}&direcao_ordem=${sortDirection}&filtro=${filtro}`,
    {
      cancelToken: cancel.token
    }
  );
  if (!response) return false;

  if (!("arquivos" in response)) {
    throw new Error();
  }

  return { data: response.arquivos, total: response.total };
};

export { getDadosPaginacao };
