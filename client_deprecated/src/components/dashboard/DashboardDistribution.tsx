import { Grid, Box, Typography, Card, CardContent, useTheme } from '@mui/material';
import { PieChart } from '@/components/charts/PieChart';
import { BarChart } from '@/components/charts/BarChart';
import {
  useProductsByType,
  useStorageByType,
  useStorageByVolume,
} from '@/hooks/useDashboard';

export const DashboardDistribution = () => {
  const theme = useTheme();
  const { data: productsByTypeData, isLoading: isLoadingProductsByType } = useProductsByType();
  const { data: storageByTypeData, isLoading: isLoadingStorageByType } = useStorageByType();
  const { data: storageByVolumeData, isLoading: isLoadingStorageByVolume } = useStorageByVolume();

  // Prepare pie chart data for products by type
  const productsByTypePieData = productsByTypeData?.map(item => ({
    label: item.tipo_produto,
    value: item.quantidade,
  })) || [];

  // Prepare bar chart data and series for storage by type
  const storageByTypeBarData = storageByTypeData || [];
  const storageByTypeSeries = [
    {
      dataKey: 'total_gb',
      name: 'GB',
      color: theme.palette.primary.main,
    },
  ];

  // Prepare custom chart for storage by volume
  const storageByVolumeData2 = storageByVolumeData?.map(item => {
    const usagePercentage = (item.total_gb / item.capacidade_gb_volume) * 100;
    return {
      ...item,
      usage_percentage: usagePercentage > 100 ? 100 : usagePercentage,
      available_gb: Math.max(0, item.capacidade_gb_volume - item.total_gb),
    };
  }) || [];

  const volumeStorageSeries = [
    {
      dataKey: 'total_gb',
      name: 'Usado (GB)',
      color: theme.palette.info.main,
    },
    {
      dataKey: 'available_gb',
      name: 'Disponível (GB)',
      color: theme.palette.grey[300],
    },
  ];

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" gutterBottom>
        Distribuição
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <PieChart
                title="Produtos por Tipo"
                data={productsByTypePieData}
                height={300}
                isLoading={isLoadingProductsByType}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <BarChart
                title="Armazenamento por Tipo de Produto"
                data={storageByTypeBarData}
                series={storageByTypeSeries}
                xAxisDataKey="tipo_produto"
                height={300}
                isLoading={isLoadingStorageByType}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <BarChart
                title="Armazenamento por Volume"
                data={storageByVolumeData2}
                series={volumeStorageSeries}
                xAxisDataKey="nome_volume"
                height={300}
                stacked={true}
                isLoading={isLoadingStorageByVolume}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};