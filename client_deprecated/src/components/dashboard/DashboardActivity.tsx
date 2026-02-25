import { Grid, Box, Typography, Card, CardContent, Tab, Tabs } from '@mui/material';
import { useState } from 'react';
import { BarChart } from '@/components/charts/BarChart';
import { FileActivityTable } from './FileActivityTable';
import {
  useFilesByDay,
  useDownloadsByDay,
  useRecentUploads,
  useRecentModifications,
  useRecentDeletions,
  useDownloadHistory,
} from '@/hooks/useDashboard';

export const DashboardActivity = () => {
  const { data: filesByDayData, isLoading: isLoadingFilesByDay } = useFilesByDay();
  const { data: downloadsByDayData, isLoading: isLoadingDownloadsByDay } = useDownloadsByDay();
  const { data: recentUploadsData, isLoading: isLoadingRecentUploads } = useRecentUploads();
  const { data: recentModificationsData, isLoading: isLoadingRecentModifications } = useRecentModifications();
  const { data: recentDeletionsData, isLoading: isLoadingRecentDeletions } = useRecentDeletions();
  const { data: downloadHistoryData, isLoading: isLoadingDownloadHistory } = useDownloadHistory();

  // State for activity tabs
  const [activityTab, setActivityTab] = useState(0);

  // Prepare combined chart data for uploads and downloads
  const dailyActivityData = [];
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);

  // Create a map of dates for the last 30 days
  const dateMap: Record<string, { dia: string; uploads: number; downloads: number }> = {};
  for (let i = 0; i < 30; i++) {
    const date = new Date(thirtyDaysAgo);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    dateMap[dateStr] = { dia: dateStr, uploads: 0, downloads: 0 };
  }

  // Fill in the map with actual data
  filesByDayData?.forEach(item => {
    if (dateMap[item.dia]) {
      dateMap[item.dia].uploads = item.quantidade;
    }
  });

  downloadsByDayData?.forEach(item => {
    if (dateMap[item.dia]) {
      dateMap[item.dia].downloads = item.quantidade;
    }
  });

  // Convert map to array and sort by date
  Object.values(dateMap).forEach(item => {
    dailyActivityData.push(item);
  });
  dailyActivityData.sort((a, b) => a.dia.localeCompare(b.dia));

  // Chart series definition
  const dailyActivitySeries = [
    { dataKey: 'uploads', name: 'Uploads', color: '#4caf50' },
    { dataKey: 'downloads', name: 'Downloads', color: '#2196f3' },
  ];

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" gutterBottom>
        Atividade
      </Typography>
      <Grid container spacing={3}>
        {/* Daily Activity Chart */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <BarChart
                title="Atividade Diária (Últimos 30 dias)"
                data={dailyActivityData}
                series={dailyActivitySeries}
                xAxisDataKey="dia"
                height={300}
                isLoading={isLoadingFilesByDay || isLoadingDownloadsByDay}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Activity Tabs */}
        <Grid item xs={12}>
          <Card>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={activityTab}
                onChange={(e, newValue) => setActivityTab(newValue)}
                aria-label="activity tabs"
              >
                <Tab label="Uploads Recentes" />
                <Tab label="Modificações Recentes" />
                <Tab label="Exclusões Recentes" />
                <Tab label="Histórico de Downloads" />
              </Tabs>
            </Box>
            <CardContent>
              {activityTab === 0 && (
                <FileActivityTable
                  data={recentUploadsData || []}
                  isLoading={isLoadingRecentUploads}
                  title="Uploads Recentes"
                  emptyMessage="Nenhum upload recente"
                />
              )}
              {activityTab === 1 && (
                <FileActivityTable
                  data={recentModificationsData || []}
                  isLoading={isLoadingRecentModifications}
                  title="Modificações Recentes"
                  emptyMessage="Nenhuma modificação recente"
                />
              )}
              {activityTab === 2 && (
                <FileActivityTable
                  data={recentDeletionsData || []}
                  isLoading={isLoadingRecentDeletions}
                  title="Exclusões Recentes"
                  emptyMessage="Nenhuma exclusão recente"
                  isDeleted
                />
              )}
              {activityTab === 3 && (
                <FileActivityTable
                  data={downloadHistoryData || []}
                  isLoading={isLoadingDownloadHistory}
                  title="Histórico de Downloads"
                  emptyMessage="Nenhum download registrado"
                  isDownload
                />
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};