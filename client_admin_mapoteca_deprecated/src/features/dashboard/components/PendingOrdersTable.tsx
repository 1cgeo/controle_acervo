// Path: features\dashboard\components\PendingOrdersTable.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Card,
  CardHeader,
  CardContent,
  Chip,
  IconButton,
  TablePagination,
} from '@mui/material';
import { VisibilityOutlined as ViewIcon } from '@mui/icons-material';
import { PendingOrder } from '@/types/dashboard';

interface PendingOrdersTableProps {
  orders: PendingOrder[];
}

export const PendingOrdersTable = ({ orders }: PendingOrdersTableProps) => {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR');
  };

  // Handle pagination
  const handleChangePage = (_: any, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Navigate to order details
  const handleViewOrder = (orderId: number) => {
    navigate(`/pedidos/${orderId}`);
  };

  // Get status color based on order status
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

  // Compute the orders to display based on pagination
  const displayedOrders = orders.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Card>
      <CardHeader title="Pedidos Pendentes" />
      <CardContent>
        <TableContainer component={Paper} sx={{ maxHeight: 440 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Data do Pedido</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Prazo</TableCell>
                <TableCell align="center">Produtos</TableCell>
                <TableCell>Dias até Prazo</TableCell>
                <TableCell align="center">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {displayedOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{order.id}</TableCell>
                  <TableCell>{formatDate(order.data_pedido)}</TableCell>
                  <TableCell>{order.cliente_nome}</TableCell>
                  <TableCell>
                    <Chip
                      label={order.situacao_nome}
                      color={getStatusColor(order.situacao_pedido_id)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{order.prazo ? formatDate(order.prazo) : '-'}</TableCell>
                  <TableCell align="center">{order.quantidade_produtos}</TableCell>
                  <TableCell>
                    {order.dias_ate_prazo !== null ? (
                      <Chip
                        label={order.dias_ate_prazo}
                        color={order.atrasado ? 'error' : order.dias_ate_prazo < 3 ? 'warning' : 'success'}
                        size="small"
                      />
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <IconButton
                      size="small"
                      onClick={() => handleViewOrder(order.id)}
                      color="primary"
                    >
                      <ViewIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {displayedOrders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    Nenhum pedido pendente encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[5, 10, 25]}
          component="div"
          count={orders.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="Linhas por página:"
          labelDisplayedRows={({ from, to, count }) => `${from}-${to} de ${count}`}
        />
      </CardContent>
    </Card>
  );
};