// Path: features\materials\routes\MaterialDetails.tsx
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Paper,
  Divider,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Card,
  CardContent,
  Alert,
  IconButton,
  Stack,
  Tooltip,
  useTheme,
  Tabs,
  Tab,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Inventory as InventoryIcon,
  Assignment as AssignmentIcon,
  Warehouse as WarehouseIcon,
} from '@mui/icons-material';
import { useConfirm } from 'material-ui-confirm';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { formatDate } from '@/utils/formatters';
import { useMapotecaMaterials } from '@/hooks/useMapotecaMaterials';
import MaterialAddEditDialog from '../components/MaterialAddEditDialog';
import StockAddDialog from '../components/StockAddDialog';
import ConsumptionAddDialog from '../components/ConsumptionAddDialog';

// Interface for tab panel props
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

// Tab Panel component
const TabPanel = (props: TabPanelProps) => {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`material-tabpanel-${index}`}
      aria-labelledby={`material-tab-${index}`}
      {...other}
      style={{ paddingTop: 16 }}
    >
      {value === index && (
        <Box>
          {children}
        </Box>
      )}
    </div>
  );
};

const MaterialDetails = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const materialId = id ? parseInt(id, 10) : undefined;
  
  const { 
    getMaterialType, 
    deleteMaterialTypes,
    createStockItem,
    deleteStockItems,
    createConsumptionItem,
    deleteConsumptionItems,
    isLoadingMaterialTypes
  } = useMapotecaMaterials();
  
  const { data: material, isLoading, isError, error, refetch } = getMaterialType(materialId);
  
  const [openMaterialDialog, setOpenMaterialDialog] = useState(false);
  const [openStockDialog, setOpenStockDialog] = useState(false);
  const [openConsumptionDialog, setOpenConsumptionDialog] = useState(false);
  const [tabValue, setTabValue] = useState(0);

  // Handle tab change
  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Handle navigation back to materials list
  const handleBack = () => {
    navigate('/materiais');
  };

  // Handle editing material
  const handleEdit = () => {
    setOpenMaterialDialog(true);
  };

  // Handle deleting material
  const handleDelete = async () => {
    if (!materialId) return;
    
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: `Você tem certeza que deseja excluir o material "${material?.nome}"?`,
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteMaterialTypes([materialId]);
      navigate('/materiais');
    } catch (error) {
      // User canceled or there was an error
      console.error('Error deleting material:', error);
    }
  };

  // Handle adding stock
  const handleAddStock = () => {
    setOpenStockDialog(true);
  };

  // Handle deleting stock
  const handleDeleteStock = async (stockId: number) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: 'Você tem certeza que deseja excluir este estoque?',
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteStockItems([stockId]);
      refetch();
    } catch (error) {
      console.error('Error deleting stock:', error);
    }
  };

  // Handle adding consumption
  const handleAddConsumption = () => {
    setOpenConsumptionDialog(true);
  };

  // Handle deleting consumption
  const handleDeleteConsumption = async (consumptionId: number) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: 'Você tem certeza que deseja excluir este registro de consumo?',
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteConsumptionItems([consumptionId]);
      refetch();
    } catch (error) {
      console.error('Error deleting consumption:', error);
    }
  };

  if (isLoading || isLoadingMaterialTypes) {
    return <Loading fullScreen />;
  }

  if (isError || !material) {
    return (
      <Page title="Detalhes do Material | Mapoteca Admin">
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
            sx={{ mb: 3 }}
          >
            Voltar
          </Button>
          
          <Alert severity="error" sx={{ mb: 3 }}>
            {error?.message || 'Erro ao carregar dados do material'}
          </Alert>
        </Container>
      </Page>
    );
  }

  return (
    <Page title={`${material.nome} | Mapoteca Admin`}>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        {/* Header with back button and edit */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
          >
            Voltar para Materiais
          </Button>
          
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<EditIcon />}
              onClick={handleEdit}
            >
              Editar
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDelete}
            >
              Excluir
            </Button>
          </Stack>
        </Box>

        {/* Material information */}
        <Paper sx={{ p: 3, mb: 4 }}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h4" component="h1">
                {material.nome}
              </Typography>
              {material.descricao && (
                <Typography variant="body1" color="text.secondary" mt={1}>
                  {material.descricao}
                </Typography>
              )}
            </Grid>

            <Grid item xs={12}>
              <Divider />
            </Grid>

            <Grid item xs={12} md={6}>
              <Card sx={{ height: '100%', bgcolor: theme.palette.grey[50] }}>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={2}>
                    <InventoryIcon color="primary" sx={{ mr: 1 }} />
                    <Typography variant="h6">
                      Estoque
                    </Typography>
                  </Box>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Quantidade Total
                      </Typography>
                      <Typography variant="h6">
                        {material.estoque?.total.toFixed(2) || '0.00'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Localizações
                      </Typography>
                      <Typography variant="h6">
                        {material.estoque?.localizacoes || 0}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card sx={{ height: '100%', bgcolor: theme.palette.grey[50] }}>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={2}>
                    <AssignmentIcon color="secondary" sx={{ mr: 1 }} />
                    <Typography variant="h6">
                      Consumo
                    </Typography>
                  </Box>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Total Consumido
                      </Typography>
                      <Typography variant="h6">
                        {material.consumo?.total_consumido?.toFixed(2) || '0.00'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Média por Consumo
                      </Typography>
                      <Typography variant="h6">
                        {material.consumo?.media_por_consumo?.toFixed(2) || '0.00'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Total de Registros
                      </Typography>
                      <Typography variant="h6">
                        {material.consumo?.total_registros || 0}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Último Consumo
                      </Typography>
                      <Typography variant="body1">
                        {material.consumo?.ultimo_consumo 
                          ? formatDate(material.consumo.ultimo_consumo) 
                          : 'N/A'}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Paper>

        {/* Tabs for Stock and Consumption */}
        <Paper sx={{ width: '100%', mb: 2 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs 
              value={tabValue} 
              onChange={handleTabChange} 
              aria-label="material tabs"
            >
              <Tab 
                label="Estoque" 
                icon={<WarehouseIcon />} 
                iconPosition="start" 
                id="material-tab-0" 
                aria-controls="material-tabpanel-0" 
              />
              <Tab 
                label="Consumo" 
                icon={<AssignmentIcon />} 
                iconPosition="start" 
                id="material-tab-1" 
                aria-controls="material-tabpanel-1" 
              />
            </Tabs>
          </Box>

          {/* Stock Tab */}
          <TabPanel value={tabValue} index={0}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">
                Registros de Estoque
              </Typography>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={handleAddStock}
              >
                Adicionar Estoque
              </Button>
            </Box>

            {material.estoque?.registros && material.estoque.registros.length > 0 ? (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>ID</TableCell>
                      <TableCell>Localização</TableCell>
                      <TableCell align="right">Quantidade</TableCell>
                      <TableCell>Criado por</TableCell>
                      <TableCell>Data de Criação</TableCell>
                      <TableCell align="center">Ações</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {material.estoque.registros.map((stock) => (
                      <TableRow key={stock.id} hover>
                        <TableCell>{stock.id}</TableCell>
                        <TableCell>{stock.localizacao_nome}</TableCell>
                        <TableCell align="right">{stock.quantidade.toFixed(2)}</TableCell>
                        <TableCell>{stock.usuario_criacao_nome || '-'}</TableCell>
                        <TableCell>{stock.data_criacao ? formatDate(stock.data_criacao) : '-'}</TableCell>
                        <TableCell align="center">
                          <Tooltip title="Remover">
                            <IconButton 
                              size="small" 
                              color="error"
                              onClick={() => handleDeleteStock(stock.id)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">
                Não há registros de estoque para este material.
              </Alert>
            )}
          </TabPanel>

          {/* Consumption Tab */}
          <TabPanel value={tabValue} index={1}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">
                Registros de Consumo
              </Typography>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={handleAddConsumption}
              >
                Registrar Consumo
              </Button>
            </Box>

            {material.consumo?.registros_recentes && material.consumo.registros_recentes.length > 0 ? (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>ID</TableCell>
                      <TableCell>Data de Consumo</TableCell>
                      <TableCell align="right">Quantidade</TableCell>
                      <TableCell>Registrado por</TableCell>
                      <TableCell>Data de Registro</TableCell>
                      <TableCell align="center">Ações</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {material.consumo.registros_recentes.map((consumption) => (
                      <TableRow key={consumption.id} hover>
                        <TableCell>{consumption.id}</TableCell>
                        <TableCell>{formatDate(consumption.data_consumo)}</TableCell>
                        <TableCell align="right">{consumption.quantidade.toFixed(2)}</TableCell>
                        <TableCell>{consumption.usuario_criacao_nome || '-'}</TableCell>
                        <TableCell>{consumption.data_criacao ? formatDate(consumption.data_criacao) : '-'}</TableCell>
                        <TableCell align="center">
                          <Tooltip title="Remover">
                            <IconButton 
                              size="small" 
                              color="error"
                              onClick={() => handleDeleteConsumption(consumption.id)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">
                Não há registros de consumo para este material.
              </Alert>
            )}
          </TabPanel>
        </Paper>

        {/* Edit Dialog */}
        <MaterialAddEditDialog
          open={openMaterialDialog}
          material={material}
          onClose={() => setOpenMaterialDialog(false)}
        />

        {/* Stock Dialog */}
        <StockAddDialog
          open={openStockDialog}
          onClose={() => setOpenStockDialog(false)}
          materialId={materialId}
        />

        {/* Consumption Dialog */}
        <ConsumptionAddDialog
          open={openConsumptionDialog}
          onClose={() => setOpenConsumptionDialog(false)}
          materialId={materialId}
        />
      </Container>
    </Page>
  );
};

export default MaterialDetails;