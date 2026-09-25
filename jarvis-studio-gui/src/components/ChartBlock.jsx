/* The [CHART] block renderer - and the ONLY module that touches recharts.
 *
 * recharts and its d3/lodash dependencies are ~390 kB of the bundle, all of
 * it parsed at startup on a phone that may never render a chart. Keeping it
 * in a separate module lets ResponseRenderer import it lazily, so the cost is
 * paid the first time a chart actually appears instead of on every cold boot.
 */

import StateMessage from "./StateMessage";
import { parseJSON } from "./jsonRepair";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = ["#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];
const TOOLTIP_STYLE = {
  background: "#171723",
  border: "1px solid #2d2d3d",
  borderRadius: 10,
  fontSize: 12,
};
const AXIS_STYLE = { fill: "#9ca3af", fontSize: 11 };
const GRID_STYLE = { stroke: "#262633", strokeDasharray: "3 3" };

export default function ChartBlock({ tagHead, body }) {
  const kind = tagHead.match(/type="([^"]+)"/)?.[1] ?? "bar";
  const [data, err] = parseJSON(body);
  // The JSON can parse fine yet have the wrong shape (model emits labels as a
  // string, values as an object, …). Without the Array checks, .map throws and
  // takes the whole chat bubble down with it.
  if (err || !Array.isArray(data?.labels) || !Array.isArray(data?.values)) {
    return (
      <StateMessage variant="error">{err ?? "Missing or malformed labels/values"}</StateMessage>
    );
  }
  const rows = data.labels.map((name, i) => ({ name, value: data.values[i] }));

  return (
    <div className="card chart-block">
      {data.title && <div className="card-title">{data.title}</div>}
      <ResponsiveContainer width="100%" height={240}>
        {kind === "pie" ? (
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={88}
              paddingAngle={2}
              label
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        ) : kind === "line" ? (
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" tick={AXIS_STYLE} />
            <YAxis tick={AXIS_STYLE} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#8b5cf6"
              strokeWidth={2.5}
              dot={{ fill: "#8b5cf6", r: 3 }}
            />
          </LineChart>
        ) : kind === "area" ? (
          <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
            <defs>
              <linearGradient id="jarvisArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.7} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" tick={AXIS_STYLE} />
            <YAxis tick={AXIS_STYLE} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#8b5cf6"
              strokeWidth={2.5}
              fill="url(#jarvisArea)"
            />
          </AreaChart>
        ) : (
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" tick={AXIS_STYLE} />
            <YAxis tick={AXIS_STYLE} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(139,92,246,.08)" }} />
            <Bar dataKey="value" radius={[5, 5, 0, 0]}>
              {rows.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
