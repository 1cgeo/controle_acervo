import { useState } from 'react';
import {
  Grid,
  Box,
  Typography,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import { BarChart } from '@/components/charts/BarChart';
import { PieChart } from '@/components/charts/PieChart';
import {
  useProductActivityTimeline,
  useVersionStatistics,
  useStorageGrowthTrends,
  useProjectStatusSummary,
  useUserActivityMetrics,
} from '@/hooks/useDashboard';

export const DashboardAdvancedAnalytics = () => {
  // States for interactive components
  const [timelineMonths, setTimelineMonths] = useState(12);
  const [storageMonths, setStorageMonths] = useState(12);
  const [analyticsTab, setAnalyticsTab] = useState(0);

  // Fetch data
  const { data: productActivityData, isLoading: isLoadingProductActivity } =
    useProductActivityTimeline(timelineMonths);
  const { data: versionStatisticsData, isLoading: isLoadingVersionStatistics } =
    useVersionStatistics();
  const { data: storageGrowthData, isLoading: isLoadingStorageGrowth } =
    useStorageGrowthTrends(storageMonths);
  const { data: projectStatusData, isLoading: isLoadingProjectStatus } =
    useProjectStatusSummary();
  const { data: userActivityData, isLoading: isLoadingUserActivity } =
    useUserActivityMetrics(10);

  // Prepare product activity timeline data
  const productActivitySeries = [
    { dataKey: 'new_products', name: 'Novos Produtos', color: '#4caf50' },
    { dataKey: 'modified_products', name: 'Produtos Modificados', color: '#ff9800' },
  ];

  // Prepare version distribution data for pie chart
  const versionDistributionData = versionStatisticsData?.distribution?.map(item => ({
    label: `${item.versions_per_product} versões`,
    value: item.product_count,
  })) || [];

  // Prepare version type distribution data for pie chart
  const versionTypeData = versionStatisticsData?.type_distribution?.map(item => ({
    label: item.version_type,
    value: item.version_count,
  })) || [];

  // Prepare storage growth trends data
  const storageGrowthSeries = [
    { dataKey: 'gb_added', name: 'GB Adicionados', color: '#4caf50' },
    { dataKey: 'cumulative_gb', name: 'GB Acumulados', color: '#2196f3' },
  ];

  // Prepare project status data for pie charts
  const projectStatusPieData = projectStatusData?.project_status?.map(item => ({
    label: item.status,
    value: item.project_count,
  })) || [];

  const lotStatusPieData = projectStatusData?.lot_status?.map(item => ({
    label: item.status,
    value: item.lot_count,
  })) || [];

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" gutterBottom>
        Análises Avançadas
      </Typography>
      <Grid container spacing={3}>
        {/* Product Activity Timeline */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6">Timeline de Atividade de Produtos</Typography>
                <FormControl variant="outlined" size="small" sx={{ width: 120 }}>
                  <InputLabel>Período</InputLabel>
                  <Select
                    value={timelineMonths}
                    onChange={(e) => setTimelineMonths(Number(e.target.value))}
                    label="Período"
                  >
                    <MenuItem value={6}>6 meses</MenuItem>
                    <MenuItem value={12}>12 meses</MenuItem>
                    <MenuItem value={24}>24 meses</MenuItem>
                  </Select>
                </FormControl>
              </Box>
              <BarChart
                title=""
                data={productActivityData || []}
                series={productActivitySeries}
                xAxisDataKey="month"
                height={300}
                isLoading={isLoadingProductActivity}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Version Statistics */}
        <Grid item xs={12}>
          <Card>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={analyticsTab}
                onChange={(e, newValue) => setAnalyticsTab(newValue)}
                aria-label="analytics tabs"
              >
                <Tab label="Estatísticas de Versões" />
                <Tab label="Tendências de Armazenamento" />
                <Tab label="Status de Projetos" />
                <Tab label="Atividade de Usuários" />
              </Tabs>
            </Box>
            <CardContent>
              {/* Version Statistics Tab */}
              {analyticsTab === 0 && (
                <Box>
                  {versionStatisticsData && (
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Resumo
                      </Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={6} md={3}>
                          <Paper sx={{ p: 2, textAlign: 'center' }} elevation={1}>
                            <Typography variant="subtitle2" color="text.secondary">
                              Total de Versões
                            </Typography>
                            <Typography variant="h4">
                              {versionStatisticsData.stats.total_versions.toLocaleString()}
                            </Typography>
                          </Paper>
                        </Grid>
                        <Grid item xs={6} md={3}>
                          <Paper sx={{ p: 2, textAlign: 'center' }} elevation={1}>
                            <Typography variant="subtitle2" color="text.secondary">
                              Produtos com Versões
                            </Typography>
                            <Typography variant="h4">
                              {versionStatisticsData.stats.products_with_versions.toLocaleString()}
                            </Typography>
                          </Paper>
                        </Grid>
                        <Grid item xs={6} md={3}>
                          <Paper sx={{ p: 2, textAlign: 'center' }} elevation={1}>
                            <Typography variant="subtitle2" color="text.secondary">
                              Média de Versões
                            </Typography>
                            <Typography variant="h4">
                              {versionStatisticsData.stats.avg_versions_per_product.toFixed(1)}
                            </Typography>
                          </Paper>
                        </Grid>
                        <Grid item xs={6} md={3}>
                          <Paper sx={{ p: 2, textAlign: 'center' }} elevation={1}>
                            <Typography variant="subtitle2" color="text.secondary">
                              Máximo de Versões
                            </Typography>
                            <Typography variant="h4">
                              {versionStatisticsData.stats.max_versions_per_product}
                            </Typography>
                          </Paper>
                        </Grid>
                      </Grid>
                    </Box>
                  )}

                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <PieChart
                        title="Distribuição de Versões por Produto"
                        data={versionDistributionData}
                        height={300}
                        isLoading={isLoadingVersionStatistics}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <PieChart
                        title="Tipos de Versão"
                        data={versionTypeData}
                        height={300}
                        isLoading={isLoadingVersionStatistics}
                      />
                    </Grid>
                  </Grid>
                </Box>
              )}

              {/* Storage Growth Tab */}
              {analyticsTab === 1 && (
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="h6">Tendências de Crescimento de Armazenamento</Typography>
                    <FormControl variant="outlined" size="small" sx={{ width: 120 }}>
                      <InputLabel>Período</InputLabel>
                      <Select
                        value={storageMonths}
                        onChange={(e) => setStorageMonths(Number(e.target.value))}
                        label="Período"
                      >
                        <MenuItem value={6}>6 meses</MenuItem>
                        <MenuItem value={12}>12 meses</MenuItem>
                        <MenuItem value={24}>24 meses</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                  <BarChart
                    title=""
                    data={storageGrowthData || []}
                    series={storageGrowthSeries}
                    xAxisDataKey="month"
                    height={300}
                    isLoading={isLoadingStorageGrowth}
                  />
                </Box>
              )}

              {/* Project Status Tab */}
              {analyticsTab === 2 && (
                <Box>
                  {projectStatusData && (
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Projetos sem Lotes
                      </Typography>
                      <Paper sx={{ p: 2, textAlign: 'center', maxWidth: 200 }} elevation={1}>
                        <Typography variant="h4">
                          {projectStatusData.projects_without_lots}
                        </Typography>
                      </Paper>
                    </Box>
                  )}

                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <PieChart
                        title="Status de Projetos"
                        data={projectStatusPieData}
                        height={300}
                        isLoading={isLoadingProjectStatus}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <PieChart
                        title="Status de Lotes"
                        data={lotStatusPieData}
                        height={300}
                        isLoading={isLoadingProjectStatus}
                      />
                    </Grid>
                  </Grid>
                </Box>
              )}

              {/* User Activity Tab */}
              {analyticsTab === 3 && (
                <Box>
                  <Typography variant="h6" gutterBottom>
                    Top 10 Usuários Mais Ativos
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Usuário</TableCell>
                          <TableCell>Uploads</TableCell>
                          <TableCell>Modificações</TableCell>
                          <TableCell>Downloads</TableCell>
                          <TableCell>Total</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {userActivityData?.map((user) => (
                          <TableRow key={user.usuario_login}>
                            <TableCell>{user.usuario_nome}</TableCell>
                            <TableCell>{user.uploads}</TableCell>
                            <TableCell>{user.modifications}</TableCell>
                            <TableCell>{user.downloads}</TableCell>
                            <TableCell>{user.total_activity}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};