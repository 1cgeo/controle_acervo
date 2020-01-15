import React, { useState, useEffect } from 'react'
import { withRouter } from 'react-router-dom'
import Grid from '@material-ui/core/Grid'
import ReactLoading from 'react-loading'

import UltimasModificacoesDataTable from './ultimas_modificacoes'
import styles from './styles'

import { getDashboardData } from './api'
import { MessageSnackBar, Pie, Card, StackedArea, StackedBar } from '../helpers'

export default withRouter(props => {
  const classes = styles()

  const [snackbar, setSnackbar] = useState('')
  const [loaded, setLoaded] = useState(false)

  const [produtosCadastrados, setProdutosCadastrados] = useState(0)
  const [tamanhoArquivos, setTamanhoArquivos] = useState(0)
  const [downloads, setDownloads] = useState([])
  const [tiposProdutos, setTiposProdutos] = useState([])
  const [produtosTipo, setProdutosTipo] = useState([])
  const [tamanhoVolume, setTamanhoVolume] = useState([])
  const [downloadsUsuario, setDownloadsUsuario] = useState([])
  const [situacaoBDGEx, setSituacaoBDGEx] = useState([])
  const [produtosTipoDia, setProdutosTipoDia] = useState([])
  const [ultimasModificacoes, setUltimasModificacoes] = useState([])

  useEffect(() => {
    let isCurrent = true
    const load = async () => {
      try {
        const response = await getDashboardData()
        if (!response || !isCurrent) return
        setProdutosCadastrados(response.produtosCadastrados)
        setTamanhoArquivos(response.tamanhoArquivos)
        setDownloads(response.downloads)
        setTiposProdutos(response.tiposProdutos)
        setProdutosTipo(response.produtosTipo)
        setTamanhoVolume(response.tamanhoVolume)
        setDownloadsUsuario(response.downloadsUsuario)
        setSituacaoBDGEx(response.situacaoBDGEx)
        setProdutosTipoDia(response.produtosTipoDia)
        setUltimasModificacoes(response.ultimasModificacoes)
        setLoaded(true)
      } catch (err) {
        setSnackbar({ status: 'error', msg: 'Ocorreu um erro ao se comunicar com o servidor.', date: new Date() })
      }
    }
    load()

    return () => {
      isCurrent = false
    }
  }, [])

  return (
    <>
      {loaded ? (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6} lg={3}>
            <Card label='Produtos cadastrados' currentValue={produtosCadastrados} />
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <Card label='Tamanho dos arquivos' currentValue={tamanhoArquivos} />
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <Card label='Downloads' currentValue={downloads} />
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <Card label='Tipos de produtos' currentValue={tiposProdutos} />
          </Grid>
          <Grid item xs={12} md={12} lg={6}>
            <StackedBar title='Produtos por tipo' series={produtosTipo} dataKey='data' />
          </Grid>
          <Grid item xs={12} md={12} lg={6}>
            <StackedBar title='Tamanho por volume' series={tamanhoVolume} dataKey='data' />
          </Grid>
          <Grid item xs={12} md={12} lg={8}>
            <StackedArea title='Downloads por usuário' series={downloadsUsuario} dataKey='data' />
          </Grid>
          <Grid item xs={12} md={12} lg={4}>
            <Pie title='Situação BDGEx' data={situacaoBDGEx} nameKey='situacao' valueKey='quantidade' />
          </Grid>
          <Grid item xs={12} md={12} lg={12}>
            <StackedArea title='Produtos carregados por dia' series={produtosTipoDia} dataKey='data' />
          </Grid>
          <Grid item xs={12}>
            <UltimasModificacoesDataTable data={ultimasModificacoes} />
          </Grid>
        </Grid>
      )
        : (
          <div className={classes.loading}>
            <ReactLoading type='bars' color='#F83737' height='5%' width='5%' />
          </div>
        )}
      {snackbar ? <MessageSnackBar status={snackbar.status} key={snackbar.date} msg={snackbar.msg} /> : null}
    </>
  )
})
