// Path: features\clients\routes\ClientList.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Alert,
  Paper,
  Chip,
  IconButton,
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
import { useMapotecaClient } from '@/hooks/useMapotecaClient';
import ClientAddEditDialog from '../components/ClientAddEditDialog';
import { Client } from '@/types/client';

const ClientList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { clients, isLoadingClients, deleteClients } = useMapotecaClient();
  const [selectedClients, setSelectedClients] = useState<Client[]>([]);
  const [openDialog, setOpenDialog] = useState(false);

  const handleViewClient = (client: Client) => {
    navigate(`/clientes/${client.id}`);
  };

  const handleAddClient = () => {
    setOpenDialog(true);
  };

  const handleDeleteClients = async (clientsToDelete: Client[]) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: `Você tem certeza que deseja excluir ${clientsToDelete.length > 1 ? 'estes clientes' : 'este cliente'}?`,
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteClients(clientsToDelete.map(client => client.id));
    } catch (error) {
      // User canceled the action or there was an error
      console.error('Error deleting clients:', error);
    }
  };

  const columns = [
    { id: 'id', label: 'ID', align: 'right' as const, sortable: true, priority: 5 },
    { id: 'nome', label: 'Nome', align: 'left' as const, sortable: true, priority: 5 },
    { 
      id: 'tipo_cliente_nome', 
      label: 'Tipo', 
      align: 'left' as const, 
      sortable: true, 
      priority: 4 
    },
    { 
      id: 'ponto_contato_principal', 
      label: 'Contato', 
      align: 'left' as const, 
      sortable: true, 
      priority: 3 
    },
    { 
      id: 'total_pedidos', 
      label: 'Total Pedidos', 
      align: 'right' as const, 
      sortable: true, 
      priority: 4 
    },
    { 
      id: 'data_ultimo_pedido', 
      label: 'Último Pedido', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
      format: (value: string) => value ? formatDate(value) : '-'
    },
    { 
      id: 'pedidos_em_andamento', 
      label: 'Em Andamento', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
      format: (value: number) => (
        <Chip 
          label={value} 
          color={value > 0 ? 'info' : 'default'} 
          size="small" 
        />
      )
    },
  ];

  const actions = [
    {
      icon: <VisibilityIcon />,
      tooltip: 'Ver detalhes',
      onClick: (_: any, selectedRows: Client[]) => handleViewClient(selectedRows[0])
    },
    {
      icon: <DeleteIcon />,
      tooltip: 'Excluir',
      onClick: (_: any, selectedRows: Client[]) => handleDeleteClients(selectedRows)
    },
    {
      icon: <AddIcon />,
      tooltip: 'Adicionar Cliente',
      isFreeAction: true,
      onClick: handleAddClient
    }
  ];

  if (isLoadingClients && clients.length === 0) {
    return <Loading />;
  }

  return (
    <Page title="Clientes | Mapoteca Admin">
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" component="h1">
            Clientes
          </Typography>
        </Box>

        <Paper sx={{ width: '100%', mb: 2 }}>
          <Table
            title="Clientes"
            columns={columns}
            rows={clients}
            isLoading={isLoadingClients}
            actions={actions}
            emptyMessage="Nenhum cliente encontrado"
            searchPlaceholder="Buscar cliente..."
            onSelectionChange={setSelectedClients}
            options={{
              selection: true,
              exportButton: true,
              actionsColumnIndex: -1,
            }}
          />
        </Paper>

        {/* Add/Edit Dialog */}
        <ClientAddEditDialog
          open={openDialog}
          onClose={() => setOpenDialog(false)}
        />
      </Container>
    </Page>
  );
};

export default ClientList;