// Path: features\materials\routes\ConsumptionList.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Paper,
  Grid,
  Card,
  CardHeader,
  CardContent,
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
  Tab,
  Tabs,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  Assignment as AssignmentIcon,
  BarChart as BarChartIcon,
} from '@mui/icons-material';
import { useConfirm } from 'material-ui-confirm';
import { Table } from '@/components/ui/Table';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { formatDate } from '@/utils/formatters';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { ptBR } from 'date-fns/locale';
import { useMapotecaMaterials } from '@/hooks/useMapotecaMaterials';
import { ConsumptionItem, ConsumptionItemCreateRequest } from '@/types/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Schema for consumption creation
const consumptionSchema = z.object({
  tipo_material_id: z.number().int().positive('Tipo de material é obrigatório'),
  quantidade: z.number().positive('Quantidade deve ser positiva'),
  data_consumo: z.date(),
});

type ConsumptionFormValues = z.infer<typeof consumptionSchema>;

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
      id={`consumption-tabpanel-${index}`}
      aria-labelledby={`consumption-tab-${index}`}
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

const ConsumptionList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const {
    getConsumption,
    getMonthlyConsumption,
    materialTypes,
    isLoadingMaterialTypes,
    createConsumptionItem,
    deleteConsumptionItems,
    isCreatingConsumptionItem,
  } = useMapotecaMaterials();

  // Get consumption data with all filters (default)
  const { data: consumptionItems = [], isLoading: isLoadingConsumption } = getConsumption();
  
  // Get monthly consumption data
  const currentYear = new Date().getFullYear();
  const { data: monthlyConsumption = [], isLoading: isLoadingMonthlyConsumption } = getMonthlyConsumption(currentYear);

  const [selectedConsumption, setSelectedConsumption] = useState<ConsumptionItem[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [tabValue, setTabValue] = useState(0);

  // Form handling
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ConsumptionFormValues>({
    resolver: zodResolver(consumptionSchema),
    defaultValues: {
      tipo_material_id: 0,
      quantidade: 0,
      data_consumo: new Date(),
    },
  });

  // Handle tab change
  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleViewMaterial = (consumption: ConsumptionItem) => {
    navigate(`/materiais/${consumption.tipo_material_id}`);
  };

  const handleAddConsumption = () => {
    reset({
      tipo_material_id: 0,
      quantidade: 0,
      data_consumo: new Date(),
    });
    setOpenDialog(true);
  };

  const handleDeleteConsumption = async (consumptionToDelete: ConsumptionItem[]) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: `Você tem certeza que deseja excluir ${consumptionToDelete.length > 1 ? 'estes registros de consumo' : 'este registro de consumo'}?`,
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteConsumptionItems(consumptionToDelete.map(item => item.id));
    } catch (error) {
      // User canceled the action or there was an error
      console.error('Error deleting consumption items:', error);
    }
  };

  const onSubmit = async (data: ConsumptionFormValues) => {
    try {
      const consumptionData: ConsumptionItemCreateRequest = {
        tipo_material_id: data.tipo_material_id,
        quantidade: data.quantidade,
        data_consumo: data.data_consumo.toISOString(),
      };
      
      await createConsumptionItem(consumptionData);
      setOpenDialog(false);
    } catch (error) {
      console.error('Error creating consumption item:', error);
    }
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
  };

  // Format quantity display
  const formatQuantity = (value: number) => {
    return value.toFixed(2);
  };

  // Prepare chart data
  const prepareChartData = () => {
    if (!monthlyConsumption || monthlyConsumption.length === 0) {
      return [];
    }

    // Group by month and material
    const materialMap = new Map<number, { id: number; nome: string }>();
    monthlyConsumption.forEach((item) => {
      if (!materialMap.has(item.tipo_material_id)) {
        materialMap.set(item.tipo_material_id, {
          id: item.tipo_material_id,
          nome: item.tipo_material_nome,
        });
      }
    });

    // Create month data structure
    const monthData: Record<string, any>[] = [];
    for (let i = 1; i <= 12; i++) {
      const monthObj: Record<string, any> = { name: `Mês ${i}` };
      
      // Add each material with 0 quantity initially
      materialMap.forEach((material) => {
        monthObj[material.nome] = 0;
      });
      
      // Update with actual values
      monthlyConsumption
        .filter((item) => item.mes === i)
        .forEach((item) => {
          monthObj[item.tipo_material_nome] = item.quantidade;
        });
      
      monthData.push(monthObj);
    }

    return monthData;
  };

  const chartData = prepareChartData();

  // Generate colors for chart bars
  const generateChartColors = () => {
    const colors = [
      theme.palette.primary.main,
      theme.palette.secondary.main,
      theme.palette.success.main,
      theme.palette.info.main,
      theme.palette.warning.main,
      theme.palette.error.main,
    ];
    
    // Create a color map for all materials
    const colorMap = new Map<string, string>();
    
    if (monthlyConsumption) {
      // Get unique material names
      const materialNames = [...new Set(monthlyConsumption.map(item => item.tipo_material_nome))];
      
      // Assign colors
      materialNames.forEach((name, index) => {
        colorMap.set(name, colors[index % colors.length]);
      });
    }
    
    return colorMap;
  };

  const colorMap = generateChartColors();

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
      id: 'quantidade',
      label: 'Quantidade',
      align: 'right' as const,
      sortable: true,
      priority: 4,
      format: (value: number) => formatQuantity(value),
    },
    {
      id: 'data_consumo',
      label: 'Data de Consumo',
      align: 'center' as const,
      sortable: true,
      priority: 4,
      format: (value: string) => (value ? formatDate(value) : '-'),
    },
    {
      id: 'data_criacao',
      label: 'Data de Registro',
      align: 'center' as const,
      sortable: true,
      priority: 3,
      format: (value: string) => (value ? formatDate(value) : '-'),
    },
    {
      id: 'usuario_criacao_nome',
      label: 'Registrado por',
      align: 'left' as const,
      sortable: true,
      priority: 3,
    },
  ];

  const actions = [
    {
      icon: <VisibilityIcon />,
      tooltip: 'Ver material',
      onClick: (_: any, selectedRows: ConsumptionItem[]) => handleViewMaterial(selectedRows[0]),
    },
    {
      icon: <DeleteIcon />,
      tooltip: 'Excluir',
      onClick: (_: any, selectedRows: ConsumptionItem[]) => handleDeleteConsumption(selectedRows),
    },
    {
      icon: <AddIcon />,
      tooltip: 'Registrar Consumo',
      isFreeAction: true,
      onClick: handleAddConsumption,
    },
  ];

  // Summary cards for total consumption by material type
  const consumptionByMaterial = () => {
    if (!consumptionItems) return [];
    
    // Group consumption items by material type
    const materialMap = new Map<number, { name: string; total: number }>();
    
    consumptionItems.forEach(item => {
      if (!materialMap.has(item.tipo_material_id)) {
        materialMap.set(item.tipo_material_id, {
          name: item.tipo_material_nome || `Material ${item.tipo_material_id}`,
          total: 0,
        });
      }
      
      materialMap.get(item.tipo_material_id)!.total += item.quantidade;
    });
    
    // Convert to array and sort by total (descending)
    return Array.from(materialMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 3); // Take top 3
  };

  const isLoading = isLoadingConsumption || isLoadingMaterialTypes || isLoadingMonthlyConsumption;

  if (isLoading && consumptionItems.length === 0) {
    return <Loading />;
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ptBR}>
      <Page title="Consumo | Mapoteca Admin">
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h4" component="h1">
              Registro de Consumo
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

          {/* Tabs */}
          <Paper sx={{ width: '100%', mb: 4 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs 
                value={tabValue} 
                onChange={handleTabChange} 
                aria-label="consumption tabs"
              >
                <Tab 
                  label="Registros" 
                  icon={<AssignmentIcon />} 
                  iconPosition="start" 
                  id="consumption-tab-0" 
                  aria-controls="consumption-tabpanel-0" 
                />
                <Tab 
                  label="Estatísticas" 
                  icon={<BarChartIcon />} 
                  iconPosition="start" 
                  id="consumption-tab-1" 
                  aria-controls="consumption-tabpanel-1" 
                />
              </Tabs>
            </Box>

            {/* Registros Tab */}
            <TabPanel value={tabValue} index={0}>
              {/* Summary Cards */}
              <Grid container spacing={3} sx={{ mb: 4 }}>
                {consumptionByMaterial().map((material, index) => (
                  <Grid item xs={12} sm={6} md={4} key={index}>
                    <Card>
                      <CardHeader
                        avatar={<AssignmentIcon color="primary" />}
                        title={material.name}
                        titleTypographyProps={{ variant: 'h6' }}
                      />
                      <CardContent>
                        <Typography variant="h4" align="center">
                          {material.total.toFixed(2)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" align="center">
                          Total Consumido
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>

              {/* Table */}
              <Table
                title="Registros de Consumo"
                columns={columns}
                rows={consumptionItems}
                isLoading={isLoading}
                actions={actions}
                emptyMessage="Nenhum registro de consumo encontrado"
                searchPlaceholder="Buscar consumo..."
                onSelectionChange={setSelectedConsumption}
                options={{
                  selection: true,
                  exportButton: true,
                  actionsColumnIndex: -1,
                }}
              />
            </TabPanel>

            {/* Estatísticas Tab */}
            <TabPanel value={tabValue} index={1}>
              <Typography variant="h6" gutterBottom>
                Consumo Mensal por Material ({currentYear})
              </Typography>
              
              <Box sx={{ height: 500, mt: 3 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{
                      top: 20,
                      right: 30,
                      left: 20,
                      bottom: 70,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ bottom: 0 }} />
                    
                    {/* Create bars for each material */}
                    {Array.from(colorMap.entries()).map(([materialName, color]) => (
                      <Bar
                        key={materialName}
                        dataKey={materialName}
                        stackId="a"
                        fill={color}
                        name={materialName}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </TabPanel>
          </Paper>

          {/* Consumption Add Dialog */}
          <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
            <form onSubmit={handleSubmit(onSubmit)}>
              <DialogTitle>Registrar Consumo</DialogTitle>
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

                  <Grid item xs={12}>
                    <Controller
                      name="data_consumo"
                      control={control}
                      render={({ field }) => (
                        <DatePicker
                          label="Data de Consumo"
                          value={field.value}
                          onChange={(date) => field.onChange(date)}
                          slotProps={{
                            textField: {
                              fullWidth: true,
                              margin: 'normal',
                              error: !!errors.data_consumo,
                              helperText: errors.data_consumo?.message as string,
                            },
                          }}
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
                  disabled={isCreatingConsumptionItem}
                >
                  {isCreatingConsumptionItem ? 'Salvando...' : 'Salvar'}
                </Button>
              </DialogActions>
            </form>
          </Dialog>
        </Container>
      </Page>
    </LocalizationProvider>
  );
};

export default ConsumptionList;