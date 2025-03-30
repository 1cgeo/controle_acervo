import React, { useMemo } from 'react';
import {
  BarChart as RechartsBar,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { 
  Typography, 
  Box, 
  useTheme, 
  useMediaQuery, 
  CircularProgress,
  Skeleton 
} from '@mui/material';

interface BarChartSeries {
  dataKey: string;
  name: string;
  color?: string;
}

interface BarChartProps {
  title: string;
  data: Array<Record<string, any>>;
  series: BarChartSeries[];
  xAxisDataKey: string;
  height?: number;
  stacked?: boolean;
  isLoading?: boolean;
}

export const BarChart = ({
  title,
  data,
  series,
  xAxisDataKey,
  height = 300,
  stacked = false,
  isLoading = false,
}: BarChartProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.down('md'));

  const displayData = useMemo(
    () =>
      isMobile && data.length > 10
        ? data.slice(Math.max(0, data.length - 6), data.length) // Show only last 6 items on mobile
        : data,
    [isMobile, data],
  );

  const displaySeries = useMemo(
    () =>
      isMobile && series.length > 3
        ? series.slice(0, 3) // Show only first 3 series on mobile
        : series,
    [isMobile, series],
  );

  const responsiveHeight = useMemo(
    () =>
      isMobile
        ? Math.min(250, height)
        : isTablet
          ? Math.min(280, height)
          : height,
    [isMobile, isTablet, height],
  );

  const chartMargins = useMemo(
    () => ({
      top: 20,
      right: isMobile ? 10 : 30,
      left: isMobile ? 0 : 20,
      bottom: 10,
    }),
    [isMobile],
  );

  const barSize = useMemo(() => (isMobile ? 10 : 20), [isMobile]);

  const truncatedDataMessage = useMemo(() => {
    if (isMobile && data.length > 10) {
      return (
        <Typography variant="caption" align="center" color="text.secondary">
          Mostrando os últimos 6 itens
        </Typography>
      );
    }
    return null;
  }, [isMobile, data.length]);

  if (isLoading) {
    return (
      <Box sx={{ width: '100%', height: responsiveHeight }}>
        <Typography variant="h6" align="center" gutterBottom>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80%' }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Box sx={{ width: '100%', height: responsiveHeight }}>
        <Typography variant="h6" align="center" gutterBottom>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80%' }}>
          <Typography variant="body2" color="text.secondary">
            Sem dados disponíveis
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: responsiveHeight }}>
      <Typography
        variant={isMobile ? 'subtitle1' : 'h6'}
        align="center"
        gutterBottom
      >
        {title}
      </Typography>

      {truncatedDataMessage}

      <Box sx={{ width: '100%', height: '90%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBar
            data={displayData}
            margin={chartMargins}
            barSize={barSize}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke={theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'} 
            />
            <XAxis
              dataKey={xAxisDataKey}
              tick={{
                fontSize: isMobile ? 10 : 12,
                fill: theme.palette.text.primary,
              }}
              interval={isMobile ? 1 : 0}
              stroke={theme.palette.text.secondary}
            />
            <YAxis
              tick={{
                fontSize: isMobile ? 10 : 12,
                fill: theme.palette.text.primary,
              }}
              width={isMobile ? 30 : 40}
              stroke={theme.palette.text.secondary}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                color: theme.palette.text.primary,
              }}
            />
            <Legend
              wrapperStyle={{ 
                fontSize: isMobile ? 10 : 12,
                marginTop: 10
              }}
              verticalAlign="bottom"
              height={36}
            />

            {displaySeries.map(s => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.name}
                fill={s.color || theme.palette.primary.main}
                stackId={stacked ? 'stack' : undefined}
              />
            ))}
          </RechartsBar>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
};