import { Grid, Box, Typography, useTheme } from '@mui/material';
import { StatsCard } from '@/components/dashboard/StatsCard';
import StorageIcon from '@mui/icons-material/Storage';
import PeopleIcon from '@mui/icons-material/People';
import DataUsageIcon from '@mui/icons-material/DataUsage';
import {
  useTotalProducts,
  useTotalStorage,
  useTotalUsers,
} from '@/hooks/useDashboard';

export const DashboardOverview = () => {
  const theme = useTheme();
  const { data: totalProductsData, isLoading: isLoadingProducts } = useTotalProducts();
  const { data: totalStorageData, isLoading: isLoadingStorage } = useTotalStorage();
  const { data: totalUsersData, isLoading: isLoadingUsers } = useTotalUsers();

  // Format the values
  const totalProducts = totalProductsData?.total_produtos?.toLocaleString() || '0';
  const totalStorage = totalStorageData?.total_gb?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || '0';
  const totalUsers = totalUsersData?.total_usuarios?.toLocaleString() || '0';

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" gutterBottom>
        Visão Geral
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <StatsCard
            title="Total de Produtos"
            value={totalProducts}
            icon={<StorageIcon />}
            color={theme.palette.primary.main}
            loading={isLoadingProducts}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatsCard
            title="Armazenamento Total"
            value={totalStorage}
            suffix="GB"
            icon={<DataUsageIcon />}
            color={theme.palette.warning.main}
            loading={isLoadingStorage}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatsCard
            title="Total de Usuários"
            value={totalUsers}
            icon={<PeopleIcon />}
            color={theme.palette.success.main}
            loading={isLoadingUsers}
          />
        </Grid>
      </Grid>
    </Box>
  );
};