// Path: features\plotters\routes\PlotterList.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Paper,
  Chip,
  Tooltip,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import { useConfirm } from 'material-ui-confirm';
import { Table } from '@/components/ui/Table';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { formatDate } from '@/utils/formatters';
import { useMapotecaPlotters } from '@/hooks/useMapotecaPlotters';
import PlotterAddEditDialog from '../components/PlotterAddEditDialog';
import { Plotter } from '@/types/plotter';

const PlotterList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { plotters, isLoadingPlotters, deletePlotters } = useMapotecaPlotters();
  const [selectedPlotters, setSelectedPlotters] = useState<Plotter[]>([]);
  const [openDialog, setOpenDialog] = useState(false);

  const handleViewPlotter = (plotter: Plotter) => {
    navigate(`/plotters/${plotter.id}`);
  };

  const handleAddPlotter = () => {
    setOpenDialog(true);
  };

  const handleDeletePlotters = async (plottersToDelete: Plotter[]) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: `Você tem certeza que deseja excluir ${plottersToDelete.length > 1 ? 'estas plotters' : 'esta plotter'}?`,
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deletePlotters(plottersToDelete.map(plotter => plotter.id));
    } catch (error) {
      // User canceled the action or there was an error
      console.error('Error deleting plotters:', error);
    }
  };

  const columns = [
    { id: 'id', label: 'ID', align: 'right' as const, sortable: true, priority: 5 },
    { 
      id: 'ativo', 
      label: 'Status', 
      align: 'center' as const, 
      sortable: true, 
      priority: 5,
      format: (value: boolean) => (
        <Chip 
          label={value ? "Ativo" : "Inativo"} 
          color={value ? "success" : "error"} 
          size="small" 
        />
      ) 
    },
    { id: 'nr_serie', label: 'Nº Série', align: 'left' as const, sortable: true, priority: 4 },
    { id: 'modelo', label: 'Modelo', align: 'left' as const, sortable: true, priority: 5 },
    { 
      id: 'data_aquisicao', 
      label: 'Data Aquisição', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
      format: (value: string) => value ? formatDate(value) : '-'
    },
    { 
      id: 'vida_util', 
      label: 'Vida Útil (meses)', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
      format: (value: number) => value || '-'
    },
    { 
      id: 'data_ultima_manutencao', 
      label: 'Última Manutenção', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
      format: (value: string) => value ? formatDate(value) : '-'
    },
    { 
      id: 'quantidade_manutencoes', 
      label: 'Qtd. Manutenções', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
      format: (value: number) => value || '0'
    },
  ];

  const actions = [
    {
      icon: <VisibilityIcon />,
      tooltip: 'Ver detalhes',
      onClick: (_: any, selectedRows: Plotter[]) => handleViewPlotter(selectedRows[0])
    },
    {
      icon: <DeleteIcon />,
      tooltip: 'Excluir',
      onClick: (_: any, selectedRows: Plotter[]) => handleDeletePlotters(selectedRows)
    },
    {
      icon: <AddIcon />,
      tooltip: 'Adicionar Plotter',
      isFreeAction: true,
      onClick: handleAddPlotter
    }
  ];

  if (isLoadingPlotters && plotters.length === 0) {
    return <Loading />;
  }

  return (
    <Page title="Plotters | Mapoteca Admin">
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" component="h1">
            Plotters
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleAddPlotter}
          >
            Nova Plotter
          </Button>
        </Box>

        <Paper sx={{ width: '100%', mb: 2 }}>
          <Table
            title="Plotters"
            columns={columns}
            rows={plotters}
            isLoading={isLoadingPlotters}
            actions={actions}
            emptyMessage="Nenhuma plotter encontrada"
            searchPlaceholder="Buscar plotter..."
            onSelectionChange={setSelectedPlotters}
            options={{
              selection: true,
              exportButton: true,
              actionsColumnIndex: -1,
            }}
          />
        </Paper>

        {/* Add/Edit Dialog */}
        <PlotterAddEditDialog
          open={openDialog}
          onClose={() => setOpenDialog(false)}
        />
      </Container>
    </Page>
  );
};

export default PlotterList;