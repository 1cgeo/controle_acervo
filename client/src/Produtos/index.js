import React, { useState, useEffect } from 'react'
import { withRouter } from 'react-router-dom'
import TextField from '@material-ui/core/TextField'

import { getTiposProduto, atualizaTipoProduto, deletaTipoProduto, criaTipoProduto } from './api'
import { MessageSnackBar, MaterialTable } from '../helpers'
import styles from './styles'
import { handleApiError } from '../services'

export default withRouter(props => {
  const classes = styles()

  const [tiposProduto, setTiposProduto] = useState([])
  const [snackbar, setSnackbar] = useState('')
  const [refresh, setRefresh] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let isCurrent = true
    const load = async () => {
      try {
        const response = await getTiposProduto()
        if (!response || !isCurrent) return

        setTiposProduto(response)
        setLoaded(true)
      } catch (err) {
        if (!isCurrent) return
        handleApiError(err, setSnackbar)
      }
    }
    load()

    return () => {
      isCurrent = false
    }
  }, [refresh])

  const handleAdd = async newData => {
    try {
      const response = await criaTipoProduto(newData.nome)
      if (!response) return

      setRefresh(new Date())
      setSnackbar({ status: 'success', msg: 'Tipo de produto adicionado com sucesso', date: new Date() })
    } catch (err) {
      handleApiError(err, setSnackbar)
    }
  }

  const handleUpdate = async (newData, oldData) => {
    try {
      const response = await atualizaTipoProduto(newData.id, newData.nome)
      if (!response) return

      setRefresh(new Date())
      setSnackbar({ status: 'success', msg: 'Tipo de produto atualizado com sucesso', date: new Date() })
    } catch (err) {
      handleApiError(err, setSnackbar)
    }
  }

  const handleDelete = async oldData => {
    try {
      const response = await deletaTipoProduto(oldData.id)
      if (!response) return

      setRefresh(new Date())
      setSnackbar({ status: 'success', msg: 'Tipo de produto deletado com sucesso', date: new Date() })
    } catch (err) {
      handleApiError(err, setSnackbar)
    }
  }

  return (
    <>
      <MaterialTable
        title='Tipos de produto'
        loaded={loaded}
        columns={[
          {
            title: 'Nome',
            field: 'nome',
            editComponent: props => (
              <TextField
                type='text'
                value={props.value || ''}
                className={classes.textField}
                onChange={e => props.onChange(e.target.value)}
              />
            )
          }
        ]}
        data={tiposProduto}
        editable={{
          onRowAdd: handleAdd,
          onRowUpdate: handleUpdate,
          onRowDelete: handleDelete
        }}
      />
      {snackbar ? <MessageSnackBar status={snackbar.status} key={snackbar.date} msg={snackbar.msg} /> : null}
    </>
  )
})
