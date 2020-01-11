import React from 'react'
import { NavLink } from 'react-router-dom'
import ListItem from '@material-ui/core/ListItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import ListItemText from '@material-ui/core/ListItemText'
import ListSubheader from '@material-ui/core/ListSubheader'
import Divider from '@material-ui/core/Divider'
import List from '@material-ui/core/List'
import InsertChartIcon from '@material-ui/icons/InsertChart'
import VerifiedUserIcon from '@material-ui/icons/VerifiedUser'
import Tooltip from '@material-ui/core/Tooltip'
import DescriptionIcon from '@material-ui/icons/Description'
import StorageIcon from '@material-ui/icons/Storage'
import WidgetsIcon from '@material-ui/icons/Widgets'

import styles from './styles'

export const MainListItems = props => {
  const classes = styles()

  return (
    <List>
      <Divider />
      <Tooltip title='Dashboard' placement='right-start'>
        <ListItem button component={NavLink} replace exact to='/' activeClassName={classes.active}>
          <ListItemIcon>
            <InsertChartIcon />
          </ListItemIcon>
          <ListItemText primary='Dashboard' />
        </ListItem>
      </Tooltip>
    </List>
  )
}

export const AdminListItems = props => {
  const classes = styles()

  return (
    <List>
      <Divider />
      <ListSubheader inset>Administração</ListSubheader>

      <Tooltip title='Tipo de produtos' placement='right-start'>
        <ListItem button component={NavLink} replace exact to='/tipo_produtos' activeClassName={classes.active}>
          <ListItemIcon>
            <WidgetsIcon />
          </ListItemIcon>
          <ListItemText primary='Tipo de produtos' />
        </ListItem>
      </Tooltip>

      <Tooltip title='Volumes de armazenamento' placement='right-start'>
        <ListItem button component={NavLink} replace exact to='/volumes' activeClassName={classes.active}>
          <ListItemIcon>
            <StorageIcon />
          </ListItemIcon>
          <ListItemText primary='Volumes de armazenamento' />
        </ListItem>
      </Tooltip>

      <Tooltip title='Arquivos' placement='right-start'>
        <ListItem button component={NavLink} replace exact to='/arquivos' activeClassName={classes.active}>
          <ListItemIcon>
            <DescriptionIcon />
          </ListItemIcon>
          <ListItemText primary='Arquivos' />
        </ListItem>
      </Tooltip>

      <Tooltip title='Gerenciar usuários' placement='right-start'>
        <ListItem button component={NavLink} replace exact to='/gerenciar_usuarios' activeClassName={classes.active}>
          <ListItemIcon>
            <VerifiedUserIcon />
          </ListItemIcon>
          <ListItemText primary='Gerenciar usuários' />
        </ListItem>
      </Tooltip>

    </List>
  )
}
