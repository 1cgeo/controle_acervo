// Path: features\plotters\routes\PlotterDetails.tsx
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormHelperText,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Build as BuildIcon,
  Timeline as TimelineIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { useConfirm } from 'material-ui-confirm';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { ptBR } from 'date-fns/locale';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { formatDate } from '@/utils/formatters';
import { useMapotecaPlotters } from '@/hooks/useMapotecaPlotters';
import PlotterAddEditDialog from '../components/PlotterAddEditDialog';
import { MaintenanceItemCreateRequest } from '@/types/plotter';

// Schema for maintenance creation
const maintenanceSchema = z.object({
  data_manutencao: z.date(),
  valor: z.number().positive('Valor deve ser positivo'),
  descricao: z.string().optional(),
});

type MaintenanceFormValues = z.infer<typeof maintenanceSchema>;

const PlotterDetails = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const plotterId = id ? parseInt(id, 10) : undefined;
  
  const { 
    getPlotter, 
    createMaintenanceItem,
    updateMaintenanceItem,
    deleteMaintenanceItems,
    isCreatingMaintenanceItem
  } = useMapotecaPlotters();

  const { data: plotter, isLoading, isError, error, refetch } = getPlotter(plotterId);
  
  const [openPlotterDialog, setOpenPlotterDialog] = useState(false);
  const [openMaintenanceDialog, setOpenMaintenanceDialog] = useState(false);

  // Form handling
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MaintenanceFormValues>({
    resolver: zodResolver(maintenanceSchema),
    defaultValues: {
      data_manutencao: new Date(),
      valor: 0,
      descricao: '',
    },
  });

  // Handle navigation back to plotters list
  const handleBack = () => {
    navigate('/plotters');
  };

  // Handle editing plotter
  const handleEdit = () => {
    setOpenPlotterDialog(true);
  };

  // Handle deleting maintenance
  const handleDeleteMaintenance = async (maintenanceId: number) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: 'Você tem certeza que deseja excluir este registro de manutenção?',
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteMaintenanceItems([maintenanceId]);
      refetch();
    } catch (error) {
      console.error('Error deleting maintenance:', error);
    }
  };

  // Handle adding maintenance
  const handleAddMaintenance = () => {
    reset({
      data_manutencao: new Date(),
      valor: 0,
      descricao: '',
    });
    setOpenMaintenanceDialog(true);
  };

  const onSubmit = async (data: MaintenanceFormValues) => {
    if (!plotterId) return;

    try {
      const maintenanceData: MaintenanceItemCreateRequest = {
        plotter_id: plotterId,
        data_manutencao: data.data_manutencao.toISOString(),
        valor: data.valor,
        descricao: data.descricao,
      };
      
      await createMaintenanceItem(maintenanceData);
      setOpenMaintenanceDialog(false);
      refetch();
    } catch (error) {
      console.error('Error creating maintenance record:', error);
    }
  };

  const handleCloseMaintenanceDialog = () => {
    setOpenMaintenanceDialog(false);
  };

  // Format currency display
  const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  if (isError || !plotter) {
    return (
      <Page title="Detalhes da Plotter | Mapoteca Admin">
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
            sx={{ mb: 3 }}
          >
            Voltar
          </Button>
          
          <Alert severity="error" sx={{ mb: 3 }}>
            {error?.message || 'Erro ao carregar dados da plotter'}
          </Alert>
        </Container>
      </Page>
    );
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ptBR}>
      <Page title={`${plotter.modelo} | Mapoteca Admin`}>
        <Container maxWidth="xl" sx={{ py: 3 }}>
          {/* Header with back button and edit */}
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={handleBack}
            >
              Voltar para Plotters
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
                variant="contained"
                color="secondary"
                startIcon={<BuildIcon />}
                onClick={handleAddMaintenance}
              >
                Registrar Manutenção
              </Button>
            </Stack>
          </Box>

          {/* Plotter information */}
          <Paper sx={{ p: 3, mb: 4 }}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Box display="flex" alignItems="center" flexWrap="wrap" gap={2}>
                  <Typography variant="h4" component="h1">
                    {plotter.modelo}
                  </Typography>
                  <Chip 
                    label={plotter.ativo ? "Ativo" : "Inativo"} 
                    color={plotter.ativo ? "success" : "error"} 
                    size="medium"
                    icon={plotter.ativo ? <CheckCircleIcon /> : <CancelIcon />}
                  />
                </Box>
                <Typography variant="subtitle1" mt={1}>
                  N° Série: {plotter.nr_serie}
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <Divider />
              </Grid>

              <Grid item xs={12} md={6}>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Data de Aquisição
                    </Typography>
                    <Typography variant="body1">
                      {plotter.data_aquisicao ? formatDate(plotter.data_aquisicao) : 'Não informada'}
                    </Typography>
                  </Box>
                  
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Vida Útil
                    </Typography>
                    <Typography variant="body1">
                      {plotter.vida_util ? `${plotter.vida_util} meses` : 'Não informada'}
                    </Typography>
                  </Box>
                  
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Última Manutenção
                    </Typography>
                    <Typography variant="body1">
                      {plotter.estatisticas.data_ultima_manutencao 
                        ? formatDate(plotter.estatisticas.data_ultima_manutencao) 
                        : 'Sem registros de manutenção'}
                    </Typography>
                  </Box>
                </Stack>
              </Grid>

              <Grid item xs={12} md={6}>
                <Card sx={{ height: '100%', bgcolor: theme.palette.grey[50] }}>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Estatísticas de Manutenção
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">
                          Total de Manutenções
                        </Typography>
                        <Typography variant="h6">
                          {plotter.estatisticas.total_manutencoes}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">
                          Valor Total
                        </Typography>
                        <Typography variant="h6">
                          {formatCurrency(plotter.estatisticas.valor_total_manutencoes)}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">
                          Valor Médio
                        </Typography>
                        <Typography variant="h6">
                          {formatCurrency(plotter.estatisticas.valor_medio_manutencoes)}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">
                          Tempo Médio Entre Manutenções
                        </Typography>
                        <Typography variant="h6">
                          {plotter.estatisticas.tempo_medio_entre_manutencoes_dias 
                            ? `${plotter.estatisticas.tempo_medio_entre_manutencoes_dias.toFixed(0)} dias`
                            : 'N/A'}
                        </Typography>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Paper>

          {/* Maintenance history */}
          <Box mb={3}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h5">
                Histórico de Manutenções
              </Typography>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={handleAddMaintenance}
              >
                Registrar Manutenção
              </Button>
            </Box>
            
            {plotter.manutencoes.length > 0 ? (
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>ID</TableCell>
                      <TableCell>Data</TableCell>
                      <TableCell align="right">Valor</TableCell>
                      <TableCell>Descrição</TableCell>
                      <TableCell>Registrado por</TableCell>
                      <TableCell>Data de Registro</TableCell>
                      <TableCell align="center">Ações</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {plotter.manutencoes
                      .sort((a, b) => new Date(b.data_manutencao).getTime() - new Date(a.data_manutencao).getTime())
                      .map((maintenance) => (
                        <TableRow key={maintenance.id} hover>
                          <TableCell>{maintenance.id}</TableCell>
                          <TableCell>{formatDate(maintenance.data_manutencao)}</TableCell>
                          <TableCell align="right">{formatCurrency(maintenance.valor)}</TableCell>
                          <TableCell>{maintenance.descricao || '-'}</TableCell>
                          <TableCell>{maintenance.usuario_criacao_nome || '-'}</TableCell>
                          <TableCell>{maintenance.data_criacao ? formatDate(maintenance.data_criacao) : '-'}</TableCell>
                          <TableCell align="center">
                            <Tooltip title="Excluir">
                              <IconButton 
                                size="small" 
                                color="error"
                                onClick={() => handleDeleteMaintenance(maintenance.id)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))
                    }
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">
                Esta plotter ainda não possui registros de manutenção.
              </Alert>
            )}
          </Box>

          {/* Edit Dialog */}
          <PlotterAddEditDialog
            open={openPlotterDialog}
            plotter={plotter}
            onClose={() => setOpenPlotterDialog(false)}
          />

          {/* Maintenance Dialog */}
          <Dialog open={openMaintenanceDialog} onClose={handleCloseMaintenanceDialog} maxWidth="sm" fullWidth>
            <form onSubmit={handleSubmit(onSubmit)}>
              <DialogTitle>Registrar Manutenção</DialogTitle>
              <DialogContent dividers>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Controller
                      name="data_manutencao"
                      control={control}
                      render={({ field }) => (
                        <DatePicker
                          label="Data da Manutenção"
                          value={field.value}
                          onChange={(date) => field.onChange(date)}
                          slotProps={{
                            textField: {
                              fullWidth: true,
                              margin: 'normal',
                              error: !!errors.data_manutencao,
                              helperText: errors.data_manutencao?.message as string,
                            },
                          }}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Controller
                      name="valor"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Valor (R$)"
                          fullWidth
                          margin="normal"
                          type="number"
                          inputProps={{ step: "0.01", min: "0.01" }}
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          error={!!errors.valor}
                          helperText={errors.valor?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Controller
                      name="descricao"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Descrição"
                          fullWidth
                          margin="normal"
                          multiline
                          rows={3}
                          error={!!errors.descricao}
                          helperText={errors.descricao?.message}
                        />
                      )}
                    />
                  </Grid>
                </Grid>
              </DialogContent>
              <DialogActions>
                <Button onClick={handleCloseMaintenanceDialog}>Cancelar</Button>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={isCreatingMaintenanceItem}
                >
                  {isCreatingMaintenanceItem ? 'Salvando...' : 'Salvar'}
                </Button>
              </DialogActions>
            </form>
          </Dialog>
        </Container>
      </Page>
    </LocalizationProvider>
  );
};

export default PlotterDetails;