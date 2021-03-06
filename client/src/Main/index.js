import React, { useState } from 'react'
import { withRouter, HashRouter, Route } from 'react-router-dom'
import clsx from 'clsx'
import AppBar from '@material-ui/core/AppBar'
import Drawer from '@material-ui/core/Drawer'
import Container from '@material-ui/core/Container'
import Toolbar from '@material-ui/core/Toolbar'
import IconButton from '@material-ui/core/IconButton'
import Typography from '@material-ui/core/Typography'
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft'
import MenuIcon from '@material-ui/icons/Menu'
import ExitToAppIcon from '@material-ui/icons/ExitToApp'

import styles from './styles'
import { MainListItems, AdminListItems } from './list_items'
import { handleLogout } from './api.js'

import Dashboard from '../Dashboard'
import Produtos from '../Produtos'
import Volumes from '../Volumes'
import ArquivosTable from '../ArquivosTable'
import GerenciarUsuarios from '../GerenciarUsuarios'

export default withRouter(props => {
  const classes = styles()

  const [open, setOpen] = useState(false)

  const handleDrawerOpen = () => {
    setOpen(true)
  }
  const handleDrawerClose = () => {
    setOpen(false)
  }

  const clickLogout = () => {
    handleLogout()
    props.history.push('/login')
  }

  return (
    <div className={classes.root}>
      <HashRouter>
        <AppBar position='absolute' className={clsx(classes.appBar, open && classes.appBarShift)}>
          <Toolbar className={classes.toolbar}>
            <IconButton
              edge='start'
              color='inherit'
              aria-label='open drawer'
              onClick={handleDrawerOpen}
              className={clsx(classes.menuButton, open && classes.menuButtonHidden)}
            >
              <MenuIcon />
            </IconButton>
            <Typography component='h1' variant='h6' color='inherit' noWrap className={classes.title}>
              Sistema de Controle do Acervo
            </Typography>
            <IconButton color='inherit' onClick={clickLogout}>
              <Typography variant='body1' color='inherit' noWrap className={classes.title}>
                Sair
              </Typography>
              <ExitToAppIcon className={classes.logoutButton} />
            </IconButton>
          </Toolbar>
        </AppBar>
        <Drawer
          variant='permanent'
          classes={{
            paper: clsx(classes.drawerPaper, !open && classes.drawerPaperClose)
          }}
          open={open}
        >
          <div className={classes.toolbarIcon}>
            <Typography variant='h6' className={classes.menu}>
              Menu
            </Typography>
            <IconButton onClick={handleDrawerClose}>
              <ChevronLeftIcon />
            </IconButton>
          </div>
          <MainListItems />
          {props.role === 'ADMIN' &&
            <>
              <AdminListItems />
            </>}
        </Drawer>
        <main className={classes.content}>
          <div className={classes.appBarSpacer} />
          <Container maxWidth='xl' className={classes.container}>
            <Route exact path='/' component={Dashboard} />
            <Route exact path='/tipo_produtos' component={Produtos} />
            <Route exact path='/volumes' component={Volumes} />
            <Route exact path='/arquivos' component={ArquivosTable} />
            <Route exact path='/gerenciar_usuarios' component={GerenciarUsuarios} />
          </Container>
        </main>
      </HashRouter>
    </div>
  )
})
