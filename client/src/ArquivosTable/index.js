import React, { useState, useMemo } from 'react'
import { withRouter } from 'react-router-dom'

import { getDadosPaginacao } from './api'
import { MessageSnackBar, DataTable } from '../helpers'
import { handleApiError } from '../services'

export default withRouter(props => {
  const [snackbar, setSnackbar] = useState('')

  const fetchData = useMemo(() => async (page, perPage, column, sortDirection, filterText) => {
    try {
      const response = await getDadosPaginacao(page, perPage, column, sortDirection, filterText)
      if (!response) return

      return response
    } catch (err) {
      handleApiError(err, setSnackbar)
      return { data: [], total: 0 }
    }
  }, [])

  return (
    <>
      <DataTable
        title='Arquivos'
        columns={[
          { name: 'uuid', selector: 'uuid' },
          { name: 'Produto', selector: 'produto' },
          { name: 'Tipo de produto', selector: 'tipo_produto' },
          { name: 'Data do produto', selector: 'data_produto' },
          { name: 'Arquivo', selector: 'arquivo' },
          { name: 'Extensão', selector: 'extensao' },
          { name: 'Tamanho (mb)', selector: 'tamanho_mb' }

        ]}
        fetchData={fetchData}
      />
      {snackbar ? <MessageSnackBar status={snackbar.status} key={snackbar.date} msg={snackbar.msg} /> : null}
    </>
  )
})
