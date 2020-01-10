import React from 'react'
import Card from '@material-ui/core/Card'
import Paper from '@material-ui/core/Paper'
import CardContent from '@material-ui/core/CardContent'
import { BarChart, Bar, ResponsiveContainer, Legend, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import Typography from '@material-ui/core/Typography'
import clsx from 'clsx'

import styles from './styles'

// http://colorbrewer2.org/#type=qualitative&scheme=Set3&n=12
const colors = ['#8dd3c7', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5']

const CustomTooltip = ({ type, payload, label, active }) => {
  const classes = styles()
  return (
    active ? (
      <Paper className={classes.paper}>
        <Typography variant='subtitle1' component='p' gutterBottom>{label}</Typography>
        {payload.map((p, i) => (
          <Typography key={i} variant='body2' component='p' color='textSecondary'>{`${payload[i].name} : ${payload[i].value}`}</Typography>
        ))}
        <Typography variant='subtitle2' component='p' className={classes.total}>{`Total: ${payload.reduce((a, b) => a + b.value, 0)}`}</Typography>
      </Paper>
    ) : null
  )
}

const CustomizedAxisTick = (props) => {
  const { x, y, payload } = props

  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={16} textAnchor='middle' fill='#666'>{payload.value}</text>
    </g>
  )
}

const prepareData = (series, dataKey) => {
  return Object.keys(series[0]).filter(v => v !== dataKey)
}

export default ({ title, series, dataKey }) => {
  const classes = styles()
  const fixedHeightPaper = clsx(classes.paper, classes.fixedHeight)

  return (
    <Card className={fixedHeightPaper}>
      <Typography variant='h6' gutterBottom>{title}</Typography>
      <CardContent className={classes.content}>
        {series.length > 0 ? (
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart
              margin={{ top: 20, right: 0, left: 0, bottom: 10 }}
              data={series}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis dataKey={dataKey} height={60} tick={<CustomizedAxisTick />} />
              <YAxis />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              {prepareData(series, dataKey).map((s, i) => (
                <Bar key={i} dataKey={s} stackId='1' fill={colors[i]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )
          : (
            <Typography variant='h5' gutterBottom>Sem dados para exibir</Typography>
          )}
      </CardContent>
    </Card>
  )
}
