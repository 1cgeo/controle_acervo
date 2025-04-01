// Path: components\layouts\AppSidebar.tsx
import { useLocation } from 'react-router-dom';
import { Link as RouterLink } from 'react-router-dom';
import {
  Drawer,
  Typography,
  List,
  Divider,
  IconButton,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  useTheme,
  Collapse,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import ReceiptIcon from '@mui/icons-material/Receipt';
import InventoryIcon from '@mui/icons-material/Inventory';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PrintIcon from '@mui/icons-material/Print';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { useState } from 'react';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import AssessmentIcon from '@mui/icons-material/Assessment';

interface AppSidebarProps {
  open: boolean;
  onClose: () => void;
  drawerWidth: number;
}

const AppSidebar = ({ open, onClose, drawerWidth }: AppSidebarProps) => {
  const { pathname } = useLocation();
  const theme = useTheme();
  
  // State for collapsible sections
  const [materialOpen, setMaterialOpen] = useState(false);

  // Toggle function for material section
  const handleMaterialClick = () => {
    setMaterialOpen(!materialOpen);
  };

  // Check if the current path is active for styling
  const isActive = (path: string) => {
    return pathname === path || (path !== '/' && pathname.startsWith(path));
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
        },
      }}
      // Modal drawer for all screen sizes
      variant="temporary"
      ModalProps={{
        keepMounted: true, // Better mobile performance
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: theme.spacing(0, 1),
          ...theme.mixins.toolbar,
        }}
      >
        <Typography variant="h6" sx={{ ml: 2 }}>
          Menu
        </Typography>
        <IconButton onClick={onClose}>
          <ChevronLeftIcon />
        </IconButton>
      </Box>

      <Divider />
      
      <List>
        <ListItemButton
          component={RouterLink}
          to="/dashboard"
          selected={isActive('/dashboard')}
          onClick={onClose}
        >
          <ListItemIcon>
            <DashboardIcon />
          </ListItemIcon>
          <ListItemText primary="Dashboard" />
        </ListItemButton>

        <ListItemButton
          component={RouterLink}
          to="/clientes"
          selected={isActive('/clientes')}
          onClick={onClose}
        >
          <ListItemIcon>
            <PeopleIcon />
          </ListItemIcon>
          <ListItemText primary="Clientes" />
        </ListItemButton>

        <ListItemButton
          component={RouterLink}
          to="/pedidos"
          selected={isActive('/pedidos')}
          onClick={onClose}
        >
          <ListItemIcon>
            <ReceiptIcon />
          </ListItemIcon>
          <ListItemText primary="Pedidos" />
        </ListItemButton>

        {/* Expandable Materials section */}
        <ListItemButton onClick={handleMaterialClick}>
          <ListItemIcon>
            <InventoryIcon />
          </ListItemIcon>
          <ListItemText primary="Materiais" />
          {materialOpen ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
        
        <Collapse in={materialOpen} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            <ListItemButton
              component={RouterLink}
              to="/materiais"
              selected={isActive('/materiais')}
              onClick={onClose}
              sx={{ pl: 4 }}
            >
              <ListItemIcon>
                <InventoryIcon />
              </ListItemIcon>
              <ListItemText primary="Tipos de Material" />
            </ListItemButton>
            
            <ListItemButton
              component={RouterLink}
              to="/estoque"
              selected={isActive('/estoque')}
              onClick={onClose}
              sx={{ pl: 4 }}
            >
              <ListItemIcon>
                <WarehouseIcon />
              </ListItemIcon>
              <ListItemText primary="Estoque" />
            </ListItemButton>
            
            <ListItemButton
              component={RouterLink}
              to="/consumo"
              selected={isActive('/consumo')}
              onClick={onClose}
              sx={{ pl: 4 }}
            >
              <ListItemIcon>
                <AddShoppingCartIcon />
              </ListItemIcon>
              <ListItemText primary="Consumo" />
            </ListItemButton>
          </List>
        </Collapse>

        <ListItemButton
          component={RouterLink}
          to="/plotters"
          selected={isActive('/plotters')}
          onClick={onClose}
        >
          <ListItemIcon>
            <PrintIcon />
          </ListItemIcon>
          <ListItemText primary="Plotters" />
        </ListItemButton>
      </List>
    </Drawer>
  );
};

export default AppSidebar;