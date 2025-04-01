// Path: features\orders\routes\OrderList.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Paper,
  Chip,
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
import { useMapotecaOrders } from '@/hooks/useMapotecaOrders';
import { Order } from '@/types/order';

const OrderList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { orders, isLoadingOrders, deleteOrders } = useMapotecaOrders();
  const [selectedOrders, setSelectedOrders] = useState<Order[]>([]);

  const handleViewOrder = (order: Order) => {
    navigate(`/pedidos/${order.id}`);
  };

  const handleAddOrder = () => {
    navigate('/pedidos/novo');
  };

  const handleDeleteOrders = async (ordersToDelete: Order[]) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: `Você tem certeza que deseja excluir ${ordersToDelete.length > 1 ? 'estes pedidos' : 'este pedido'}?`,
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteOrders(ordersToDelete.map(order => order.id));
    } catch (error) {
      // User canceled the action or there was an error
      console.error('Error deleting orders:', error);
    }
  };

  // Function to get status chip color
  const getStatusColor = (statusId: number): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (statusId) {
      case 1: // Pré-cadastramento
        return 'default';
      case 2: // DIEx/Ofício recebido
        return 'info';
      case 3: // Em andamento
        return 'primary';
      case 4: // Remetido
        return 'secondary';
      case 5: // Concluído
        return 'success';
      case 6: // Cancelado
        return 'error';
      default:
        return 'default';
    }
  };

  const columns = [
    { id: 'id', label: 'ID', align: 'right' as const, sortable: true, priority: 5 },
    { 
      id: 'data_pedido', 
      label: 'Data Pedido', 
      align: 'center' as const, 
      sortable: true, 
      priority: 4,
      format: (value: string) => formatDate(value)
    },
    { 
      id: 'cliente_nome', 
      label: 'Cliente', 
      align: 'left' as const, 
      sortable: true, 
      priority: 5 
    },
    { 
      id: 'documento_solicitacao', 
      label: 'Documento', 
      align: 'left' as const, 
      sortable: true, 
      priority: 3 
    },
    { 
      id: 'situacao_pedido_nome', 
      label: 'Status', 
      align: 'center' as const, 
      sortable: true, 
      priority: 4,
      format: (value: string, row: Order) => (
        <Chip 
          label={value} 
          color={getStatusColor(row.situacao_pedido_id)} 
          size="small" 
        />
      )
    },
    { 
      id: 'prazo', 
      label: 'Prazo', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
      format: (value: string) => value ? formatDate(value) : '-'
    },
    { 
      id: 'quantidade_produtos', 
      label: 'Produtos', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
    },
    { 
      id: 'localizador_pedido', 
      label: 'Localizador', 
      align: 'center' as const, 
      sortable: true, 
      priority: 3,
    },
  ];

  const actions = [
    {
      icon: <VisibilityIcon />,
      tooltip: 'Ver detalhes',
      onClick: (_: any, selectedRows: Order[]) => handleViewOrder(selectedRows[0])
    },
    {
      icon: <DeleteIcon />,
      tooltip: 'Excluir',
      onClick: (_: any, selectedRows: Order[]) => handleDeleteOrders(selectedRows)
    },
    {
      icon: <AddIcon />,
      tooltip: 'Novo Pedido',
      isFreeAction: true,
      onClick: handleAddOrder
    }
  ];

  if (isLoadingOrders && orders.length === 0) {
    return <Loading />;
  }

  return (
    <Page title="Pedidos | Mapoteca Admin">
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" component="h1">
            Pedidos
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleAddOrder}
          >
            Novo Pedido
          </Button>
        </Box>

        <Paper sx={{ width: '100%', mb: 2 }}>
          <Table
            title="Pedidos"
            columns={columns}
            rows={orders}
            isLoading={isLoadingOrders}
            actions={actions}
            emptyMessage="Nenhum pedido encontrado"
            searchPlaceholder="Buscar pedido..."
            onSelectionChange={setSelectedOrders}
            options={{
              selection: true,
              exportButton: true,
              actionsColumnIndex: -1,
            }}
          />
        </Paper>
      </Container>
    </Page>
  );
};

export default OrderList;