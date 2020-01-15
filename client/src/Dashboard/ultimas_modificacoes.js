import React from 'react'
import { MaterialTable } from '../helpers'
import DateFnsUtils from '@date-io/date-fns'

const dateFns = new DateFnsUtils()

export default ({ data }) => {
  return (
    <>
      <MaterialTable
        title='Últimas modificações'
        loaded
        columns={[
          { title: 'Produto', field: 'produto' },
          { title: 'Tipo de produto', field: 'tipo_produto' },
          { title: 'Operação', field: 'operacao' },
          { title: 'Usuário', field: 'usuario_modificacao' },
          { title: 'Data modificação', field: 'data_modificacao', render: rowData => { return dateFns.format(dateFns.date(rowData.data_execucao), 'kk:mm dd/MM/yyyy') } }
        ]}
        data={data}
      />
    </>
  )
}
