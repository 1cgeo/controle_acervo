// Path: features\materials\routes\StockList.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Paper,
  Chip,
  Card,
  CardHeader,
  CardContent,
  Grid,
  IconButton,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  SelectChangeEvent,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  Warehouse as WarehouseIcon,
} from '@mui/icons-material';
import { useConfirm } from 'material-ui-confirm';
import { Table } from '@/components/ui/Table';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { formatDate } from '@/utils/formatters';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMapotecaMaterials } from '@/hooks/useMapotecaMaterials';
import { StockItem, StockItemCreateRequest } from '@/types/material';

// Schema for stock creation/editing
const stockSchema = z.object({
  tipo_material_id: z.number().int().positive('Tipo de material é obrigatório'),
  localizacao_id: z.number().int().positive('Localização é obrigatória'),
  quantidade: z.number().positive('Quantidade deve ser positiva'),
});

type StockFormValues = z.infer<typeof stockSchema>;

const StockList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const {
    stockItems,
    materialTypes,
    locationTypes,
    isLoadingStockItems,
    isLoadingMaterialTypes,
    isLoadingLocationTypes,
    createStockItem,
    deleteStockItems,
    isCreatingStockItem,
  } = useMapotecaMaterials();

  const [selectedStock, setSelectedStock] = useState<StockItem[]>([]);
  const [openDialog, setOpenDialog] = useState(false);

  // Form handling
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<StockFormValues>({
    resolver: zodResolver(stockSchema),
    defaultValues: {
      tipo_material_id: 0,
      localizacao_id: 0,
      quantidade: 0,
    },
  });

  const handleViewMaterial = (stock: StockItem) => {
    navigate(`/materiais/${stock.tipo_material_id}`);
  };

  const handleAddStock = () => {
    reset({
      tipo_material_id: 0,
      localizacao_id: 0,
      quantidade: 0,
    });
    setOpenDialog(true);
  };

  const handleDeleteStock = async (stockToDelete: StockItem[]) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: `Você tem certeza que deseja excluir ${stockToDelete.length > 1 ? 'estes itens de estoque' : 'este item de estoque'}?`,
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteStockItems(stockToDelete.map(stock => stock.id));
    } catch (error) {
      // User canceled the action or there was an error
      console.error('Error deleting stock items:', error);
    }
  };

  const onSubmit = async (data: StockFormValues) => {
    try {
      const stockData: StockItemCreateRequest = {
        tipo_material_id: data.tipo_material_id,
        localizacao_id: data.localizacao_id,
        quantidade: data.quantidade,
      };
      
      await createStockItem(stockData);
      setOpenDialog(false);
    } catch (error) {
      console.error('Error creating stock item:', error);
    }
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
  };

  // Format quantity display
  const formatQuantity = (value: number) => {
    return value.toFixed(2);
  };

  const columns = [
    { id: 'id', label: 'ID', align: 'right' as const, sortable: true, priority: 5 },
    {
      id: 'tipo_material_nome',
      label: 'Material',
      align: 'left' as const,
      sortable: true,
      priority: 5,
    },
    {
      id: 'localizacao_nome',
      label: 'Localização',
      align: 'left' as const,
      sortable: true,
      priority: 4,
    },
    {
      id: 'quantidade',
      label: 'Quantidade',
      align: 'right' as const,
      sortable: true,
      priority: 4,
      format: (value: number) => formatQuantity(value),
    },
    {
      id: 'data_criacao',
      label: 'Data de Criação',
      align: 'center' as const,
      sortable: true,
      priority: 3,
      format: (value: string) => (value ? formatDate(value) : '-'),
    },
    {
      id: 'usuario_criacao_nome',
      label: 'Criado por',
      align: 'left' as const,
      sortable: true,
      priority: 3,
    },
  ];

  const actions = [
    {
      icon: <VisibilityIcon />,
      tooltip: 'Ver material',
      onClick: (_: any, selectedRows: StockItem[]) => handleViewMaterial(selectedRows[0]),
    },
    {
      icon: <DeleteIcon />,
      tooltip: 'Excluir',
      onClick: (_: any, selectedRows: StockItem[]) => handleDeleteStock(selectedRows),
    },
    {
      icon: <AddIcon />,
      tooltip: 'Adicionar Estoque',
      isFreeAction: true,
      onClick: handleAddStock,
    },
  ];

  // Summary cards for total stock by location
  const stockByLocation = () => {
    // Group stock items by location
    const locationMap = new Map<number, { name: string; total: number }>();
    
    stockItems.forEach(item => {
      if (!locationMap.has(item.localizacao_id)) {
        locationMap.set(item.localizacao_id, {
          name: item.localizacao_nome || `Localização ${item.localizacao_id}`,
          total: 0,
        });
      }
      
      locationMap.get(item.localizacao_id)!.total += item.quantidade;
    });
    
    return Array.from(locationMap.values());
  };

  const isLoading = isLoadingStockItems || isLoadingMaterialTypes || isLoadingLocationTypes;

  if (isLoading && stockItems.length === 0) {
    return <Loading />;
  }

  return (
    <Page title="Estoque | Mapoteca Admin">
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" component="h1">
            Estoque de Materiais
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

        {/* Summary Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {stockByLocation().map((location, index) => (
            <Grid item xs={12} sm={6} md={4} key={index}>
              <Card>
                <CardHeader
                  avatar={<WarehouseIcon color="primary" />}
                  title={location.name}
                  titleTypographyProps={{ variant: 'h6' }}
                />
                <CardContent>
                  <Typography variant="h4" align="center">
                    {location.total.toFixed(2)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" align="center">
                    Quantidade Total
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Table */}
        <Paper sx={{ width: '100%', mb: 2 }}>
          <Table
            title="Estoque"
            columns={columns}
            rows={stockItems}
            isLoading={isLoading}
            actions={actions}
            emptyMessage="Nenhum item de estoque encontrado"
            searchPlaceholder="Buscar estoque..."
            onSelectionChange={setSelectedStock}
            options={{
              selection: true,
              exportButton: true,
              actionsColumnIndex: -1,
            }}
          />
        </Paper>

        {/* Stock Add Dialog */}
        <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
          <form onSubmit={handleSubmit(onSubmit)}>
            <DialogTitle>Adicionar Estoque</DialogTitle>
            <DialogContent dividers>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Controller
                    name="tipo_material_id"
                    control={control}
                    render={({ field }) => (
                      <FormControl
                        fullWidth
                        margin="normal"
                        error={!!errors.tipo_material_id}
                      >
                        <InputLabel>Tipo de Material</InputLabel>
                        <Select
                          {...field}
                          value={field.value || 0}
                          onChange={(e: SelectChangeEvent<number>) => {
                            field.onChange(Number(e.target.value));
                          }}
                          label="Tipo de Material"
                        >
                          <MenuItem value={0} disabled>
                            Selecione o tipo de material
                          </MenuItem>
                          {materialTypes.map((type) => (
                            <MenuItem key={type.id} value={type.id}>
                              {type.nome}
                            </MenuItem>
                          ))}
                        </Select>
                        {errors.tipo_material_id && (
                          <FormHelperText>
                            {errors.tipo_material_id.message}
                          </FormHelperText>
                        )}
                      </FormControl>
                    )}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Controller
                    name="localizacao_id"
                    control={control}
                    render={({ field }) => (
                      <FormControl
                        fullWidth
                        margin="normal"
                        error={!!errors.localizacao_id}
                      >
                        <InputLabel>Localização</InputLabel>
                        <Select
                          {...field}
                          value={field.value || 0}
                          onChange={(e: SelectChangeEvent<number>) => {
                            field.onChange(Number(e.target.value));
                          }}
                          label="Localização"
                        >
                          <MenuItem value={0} disabled>
                            Selecione a localização
                          </MenuItem>
                          {locationTypes.map((type) => (
                            <MenuItem key={type.code} value={type.code}>
                              {type.nome}
                            </MenuItem>
                          ))}
                        </Select>
                        {errors.localizacao_id && (
                          <FormHelperText>
                            {errors.localizacao_id.message}
                          </FormHelperText>
                        )}
                      </FormControl>
                    )}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Controller
                    name="quantidade"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Quantidade"
                        fullWidth
                        margin="normal"
                        type="number"
                        inputProps={{ step: "0.01", min: "0.01" }}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        error={!!errors.quantidade}
                        helperText={errors.quantidade?.message}
                      />
                    )}
                  />
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseDialog}>Cancelar</Button>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                disabled={isCreatingStockItem}
              >
                {isCreatingStockItem ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </Container>
    </Page>
  );
};

export default StockList;