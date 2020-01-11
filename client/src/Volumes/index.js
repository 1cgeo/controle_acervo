import React, { useState, useEffect } from 'react'
import { withRouter } from 'react-router-dom'
import TextField from '@material-ui/core/TextField'

import { getData, atualizaVolume, deletaVolume, criaVolume } from './api'
import { MessageSnackBar, MaterialTable } from '../helpers'
import styles from './styles'
import { handleApiError } from '../services'

export default withRouter(props => {
  const classes = styles()

  const [volumes, setVolumes] = useState([])
  const [tiposProduto, setTiposProduto] = useState([])

  const [snackbar, setSnackbar] = useState('')
  const [refresh, setRefresh] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let isCurrent = true
    const load = async () => {
      try {
        const response = await getData()
        if (!response || !isCurrent) return

        setVolumes(response.volumes)
        setTiposProduto(response.tipoProduto)
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
      const response = await criaVolume(newData.tipo_produto_id, newData.volume, newData.primario)
      if (!response) return

      setRefresh(new Date())
      setSnackbar({ status: 'success', msg: 'Volume de armazenamento adicionado com sucesso', date: new Date() })
    } catch (err) {
      handleApiError(err, setSnackbar)
    }
  }

  const handleUpdate = async (newData, oldData) => {
    try {
      const response = await atualizaVolume(newData.id, newData.tipo_produto_id, newData.volume, newData.primario)
      if (!response) return

      setRefresh(new Date())
      setSnackbar({ status: 'success', msg: 'Volume de armazenamento atualizado com sucesso', date: new Date() })
    } catch (err) {
      handleApiError(err, setSnackbar)
    }
  }

  const handleDelete = async oldData => {
    try {
      const response = await deletaVolume(oldData.id)
      if (!response) return

      setRefresh(new Date())
      setSnackbar({ status: 'success', msg: 'Volume de armazenamento deletado com sucesso', date: new Date() })
    } catch (err) {
      handleApiError(err, setSnackbar)
    }
  }

  return (
    <>
      <MaterialTable
        title='Volumes de armazenamento'
        loaded={loaded}
        columns={[
          {
            title: 'Nome',
            field: 'volume',
            editComponent: props => (
              <TextField
                type='text'
                value={props.value || ''}
                className={classes.textField}
                onChange={e => props.onChange(e.target.value)}
              />
            )
          },
          {
            title: 'Tipo de produto',
            field: 'tipo_produto_id',
            lookup: tiposProduto
          },
          {
            title: 'Volume primário',
            field: 'primario',
            type: 'boolean'
          }
        ]}
        data={volumes}
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
