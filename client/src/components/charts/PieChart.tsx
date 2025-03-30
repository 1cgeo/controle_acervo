import React, { useMemo } from 'react';
import {
  PieChart as RechartsPie,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Label,
  Sector,
} from 'recharts';
import {
  Typography,
  Box,
  useTheme,
  useMediaQuery,
  CircularProgress,
} from '@mui/material';

interface PieChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

interface PieChartProps {
  title: string;
  data: PieChartDataPoint[];
  height?: number;
  showLegend?: boolean;
  showLabels?: boolean;
  isLoading?: boolean;
}

export const PieChart = ({
  title,
  data,
  height = 300,
  showLegend = true,
  showLabels = true,
  isLoading = false,
}: PieChartProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.down('md'));

  // Calculate responsive height - memoized
  const responsiveHeight = useMemo(
    () =>
      isMobile
        ? Math.min(250, height)
        : isTablet
          ? Math.min(280, height)
          : height,
    [isMobile, isTablet, height],
  );

  // Check if a single segment takes up almost all the chart (>95%)
  const hasDominantSegment = useMemo(() => {
    if (data.length === 0) return false;
    const total = data.reduce((sum, item) => sum + item.value, 0);
    return data.some(item => item.value / total > 0.95);
  }, [data]);

  // Default chart colors from theme
  const colors = useMemo(() => {
    return [
      theme.palette.primary.main,
      theme.palette.secondary.main,
      theme.palette.error.main,
      theme.palette.warning.main,
      theme.palette.info.main,
      theme.palette.success.main,
      theme.palette.primary.light,
      theme.palette.secondary.light,
      theme.palette.error.light,
      theme.palette.warning.light,
    ];
  }, [theme]);

  // Transform data for Recharts format - memoized
  const chartData = useMemo(
    () =>
      data.map(item => ({
        name: item.label,
        value: item.value,
      })),
    [data],
  );

  // Find the dominant segment if it exists
  const dominantSegment = useMemo(() => {
    if (!hasDominantSegment || data.length === 0) return null;

    const total = data.reduce((sum, item) => sum + item.value, 0);
    return data.find(item => item.value / total > 0.95);
  }, [data, hasDominantSegment]);

  if (isLoading) {
    return (
      <Box sx={{ width: '100%', height: responsiveHeight }}>
        <Typography variant="h6" align="center" gutterBottom>
          {title}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '80%',
          }}
        >
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
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '80%',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Sem dados disponíveis
          </Typography>
        </Box>
      </Box>
    );
  }

  // Custom label renderer for pie slices
  const renderCustomizedLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
    name,
  }: any) => {
    if (!showLabels) return null;

    // Don't show labels on mobile if too small
    if (isMobile && percent < 0.1) return null;

    // If we have a dominant segment, use a centered label instead of positioned labels
    if (hasDominantSegment && percent > 0.95) {
      return null; // We'll use a centered <Label> component instead
    }

    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={isMobile ? 10 : 12}
      >
        {isMobile
          ? `${(percent * 100).toFixed(0)}%`
          : `${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <Box sx={{ width: '100%', height: responsiveHeight }}>
      <Typography
        variant={isMobile ? 'subtitle1' : 'h6'}
        align="center"
        gutterBottom
      >
        {title}
      </Typography>

      <Box sx={{ width: '100%', height: '90%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartsPie>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={showLabels && !isMobile && !hasDominantSegment}
              label={hasDominantSegment ? false : renderCustomizedLabel}
              outerRadius={isMobile ? '60%' : '70%'}
              fill="#8884d8"
              dataKey="value"
              nameKey="name"
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={data[index].color || colors[index % colors.length]}
                />
              ))}

              {/* Special centered label for dominant segment case */}
              {hasDominantSegment && dominantSegment && (
                <Label
                  position="center"
                  content={props => {
                    const { viewBox } = props;
                    const { cx, cy } = viewBox as { cx: number; cy: number };
                    return (
                      <g>
                        <text
                          x={cx}
                          y={cy - 15}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={16}
                          fill={theme.palette.text.primary}
                        >
                          {dominantSegment.label}
                        </text>
                        <text
                          x={cx}
                          y={cy + 15}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={18}
                          fontWeight="bold"
                          fill={theme.palette.text.primary}
                        >
                          {`100%`}
                        </text>
                      </g>
                    );
                  }}
                />
              )}
            </Pie>
            {showLegend && (
              <Legend
                verticalAlign={isMobile ? 'bottom' : 'middle'}
                align={isMobile ? 'center' : 'right'}
                layout={isMobile ? 'horizontal' : 'vertical'}
                iconType="circle"
                wrapperStyle={{
                  fontSize: isMobile ? 10 : 12,
                  padding: 10,
                }}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                color: theme.palette.text.primary,
              }}
              formatter={(value: number) => [
                `${value.toLocaleString()}`,
                'Valor',
              ]}
            />
          </RechartsPie>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
};