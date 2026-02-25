// Path: features\dashboard\routes\Dashboard.tsx
import { useMemo } from 'react';
import { 
  Grid, 
  Container, 
  Typography, 
  Box, 
  Alert, 
  Paper, 
  useTheme,
  Card,
  CardContent
} from '@mui/material';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { useDashboard } from '@/hooks/useDashboard';
import { DashboardSummaryCard } from '../components/DashboardSummaryCard';
import { OrderStatusChart } from '../components/OrderStatusChart';
import { OrderTimelineChart } from '../components/OrderTimelineChart';
import { MaterialStockChart } from '../components/MaterialStockChart';
import { PendingOrdersTable } from '../components/PendingOrdersTable';
import { 
  Assessment as AssessmentIcon,
  Inventory as InventoryIcon,
  Schedule as ScheduleIcon,
  People as PeopleIcon
} from '@mui/icons-material';

const Dashboard = () => {
  const theme = useTheme();
  const { dashboardData, isLoading, isError, error } = useDashboard();

  // Memoize formatted data for components
  const formattedData = useMemo(() => {
    if (!dashboardData) return null;

    return {
      orderStatusData: dashboardData.orderStatusDistribution,
      timelineData: dashboardData.ordersTimeline,
      stockLocationData: dashboardData.stockByLocation,
      pendingOrdersData: dashboardData.pendingOrders
    };
  }, [dashboardData]);

  // Show loading state
  if (isLoading) {
    return (
      <Page title="Dashboard | Mapoteca Admin">
        <Container maxWidth="xl" sx={{ py: 4 }}>
          <Typography variant="h4" gutterBottom>
            Dashboard
          </Typography>
          <Box display="flex" justifyContent="center" my={4}>
            <Loading />
          </Box>
        </Container>
      </Page>
    );
  }

  // Show error state
  if (isError) {
    return (
      <Page title="Dashboard | Mapoteca Admin">
        <Container maxWidth="xl" sx={{ py: 4 }}>
          <Typography variant="h4" gutterBottom>
            Dashboard
          </Typography>
          <Alert severity="error" sx={{ mb: 3 }}>
            Erro ao carregar dados do dashboard:{' '}
            {error || 'Tente novamente.'}
          </Alert>
        </Container>
      </Page>
    );
  }

  // If no data but no error either
  if (!dashboardData || !formattedData) {
    return (
      <Page title="Dashboard | Mapoteca Admin">
        <Container maxWidth="xl" sx={{ py: 4 }}>
          <Typography variant="h4" gutterBottom>
            Dashboard
          </Typography>
          <Alert severity="warning" sx={{ mb: 3 }}>
            Nenhum dado disponível para exibição.
          </Alert>
        </Container>
      </Page>
    );
  }

  const { orderStatusData } = formattedData;

  return (
    <Page title="Dashboard | Mapoteca Admin">
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          Dashboard
        </Typography>

        <Grid container spacing={3}>
          {/* Summary Cards */}
          <Grid item xs={12} md={6} lg={3}>
            <DashboardSummaryCard
              title="Total de Pedidos"
              value={orderStatusData.total}
              icon={<AssessmentIcon fontSize="large" />}
              iconColor={theme.palette.primary.main}
            />
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <DashboardSummaryCard
              title="Pedidos em Andamento"
              value={orderStatusData.em_andamento}
              icon={<ScheduleIcon fontSize="large" />}
              iconColor={theme.palette.info.main}
            />
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <DashboardSummaryCard
              title="Pedidos Concluídos"
              value={orderStatusData.concluidos}
              icon={<AssessmentIcon fontSize="large" />}
              iconColor={theme.palette.success.main}
            />
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <DashboardSummaryCard
              title="Pedidos Pendentes"
              value={orderStatusData.pendentes}
              icon={<PeopleIcon fontSize="large" />}
              iconColor={theme.palette.warning.main}
            />
          </Grid>

          {/* Charts */}
          <Grid item xs={12} md={6}>
            <OrderStatusChart data={formattedData.orderStatusData.distribuicao} />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <MaterialStockChart data={formattedData.stockLocationData} />
          </Grid>
          
          <Grid item xs={12}>
            <OrderTimelineChart data={formattedData.timelineData} />
          </Grid>

          {/* Pending Orders Table */}
          <Grid item xs={12}>
            <PendingOrdersTable orders={formattedData.pendingOrdersData} />
          </Grid>
        </Grid>
      </Container>
    </Page>
  );
};

export default Dashboard;