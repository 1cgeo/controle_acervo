import React, { useState, useEffect } from 'react'
import Card from '@material-ui/core/Card'
import CardContent from '@material-ui/core/CardContent'
import { PieChart, Pie, ResponsiveContainer, Sector, Cell } from 'recharts'
import Typography from '@material-ui/core/Typography'
import clsx from 'clsx'
import { makeStyles } from '@material-ui/core/styles'

// http://colorbrewer2.org/#type=qualitative&scheme=Set3&n=12
const colors = ['#8dd3c7', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5']

const styles = makeStyles(theme => ({
  paper: {
    padding: theme.spacing(2),
    display: 'flex',
    overflow: 'auto',
    flexDirection: 'column'
  },
  fixedHeight: {
    height: 500
  },
  content: {
    flex: '1 0 auto',
    textAlign: 'center',
    alignItems: 'center',
    position: 'relative'
  }
}))

// From Recharts documentation
const renderActiveShape = (props) => {
  const RADIAN = Math.PI / 180
  const {
    cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle,
    fill, payload, percent, value
  } = props
  const sin = Math.sin(-RADIAN * midAngle)
  const cos = Math.cos(-RADIAN * midAngle)
  const sx = cx + (outerRadius + 10) * cos
  const sy = cy + (outerRadius + 10) * sin
  const mx = cx + (outerRadius + 30) * cos
  const my = cy + (outerRadius + 30) * sin
  const ex = mx + (cos >= 0 ? 1 : -1) * 22
  const ey = my
  const textAnchor = cos >= 0 ? 'start' : 'end'

  return (
    <g>
      <text x={cx} y={cy} dy={8} textAnchor='middle' fill={fill}>{payload.name}</text>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={outerRadius + 6}
        outerRadius={outerRadius + 10}
        fill={fill}
      />
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill='none' />
      <circle cx={ex} cy={ey} r={2} fill={fill} stroke='none' />
      <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey} textAnchor={textAnchor} fill='#333'>{`${value}`}</text>
      <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey} dy={18} textAnchor={textAnchor} fill='#999'>
        {`(${(percent * 100).toFixed(2)}%)`}
      </text>
    </g>
  )
}

export default ({ title, data, nameKey, valueKey }) => {
  const classes = styles()
  const fixedHeightPaper = clsx(classes.paper, classes.fixedHeight)

  const [activeIndex, setActiveIndex] = useState(0)
  const [preparedData, setPreparedData] = useState(0)

  useEffect(() => {
    const aux = []
    data.forEach(d => {
      aux.push({
        name: d[nameKey],
        value: d[valueKey]
      })
    })
    setPreparedData(aux)
  }, [data, nameKey, valueKey])

  const onPieEnter = (data, index) => {
    setActiveIndex(index)
  }

  return (
    <Card className={fixedHeightPaper}>
      <Typography variant='h6' gutterBottom>{title}</Typography>
      <CardContent className={classes.content}>
        {data.length > 0 ? (
          <ResponsiveContainer width='100%' height='100%'>
            <PieChart>
              <Pie
                activeIndex={activeIndex}
                activeShape={renderActiveShape}
                data={preparedData}
                cx={300}
                cy={200}
                innerRadius={50}
                outerRadius={80}
                onMouseEnter={onPieEnter}
              >
                {preparedData.map((entry, index) => (
                  <Cell key={index} fill={colors[index % colors.length]} />
                )
                )}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )
          : (
            <Typography variant='h5' gutterBottom>Sem dados para exibir</Typography>
          )}
      </CardContent>
    </Card>
  )
}
