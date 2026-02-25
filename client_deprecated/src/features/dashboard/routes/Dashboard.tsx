import { useState } from 'react';
import {
  Container,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Paper,
} from '@mui/material';
import { DashboardOverview } from '../components/DashboardOverview';
import { DashboardDistribution } from '../components/DashboardDistribution';
import { DashboardActivity } from '../components/DashboardActivity';
import { DashboardAdvancedAnalytics } from '../components/DashboardAdvancedAnalytics';
import Page from '@/components/Page/Page';

export const Dashboard = () => {
  const [selectedTab, setSelectedTab] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setSelectedTab(newValue);
  };

  return (
    <Page title="Dashboard | Sistema de Controle do Acervo">
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
          <Typography variant="h4">Dashboard</Typography>
        </Box>

        <Paper sx={{ mb: 4 }}>
          <Tabs
            value={selectedTab}
            onChange={handleTabChange}
            indicatorColor="primary"
            textColor="primary"
            variant="fullWidth"
          >
            <Tab label="Visão Geral" />
            <Tab label="Distribuição" />
            <Tab label="Atividade" />
            <Tab label="Análises Avançadas" />
          </Tabs>
        </Paper>

        {selectedTab === 0 && <DashboardOverview />}
        {selectedTab === 1 && <DashboardDistribution />}
        {selectedTab === 2 && <DashboardActivity />}
        {selectedTab === 3 && <DashboardAdvancedAnalytics />}
      </Container>
    </Page>
  );
};

export default Dashboard;