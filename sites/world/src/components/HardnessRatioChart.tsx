import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// One row from hardness-ratio-daily.json: [date, ratio_all_gold, ratio_monetary_gold_only].
type Raw = { data: [string, number, number][] };
type Row = { day: string; all: number; monetary: number };

type Lens = "all" | "monetary";

const MILESTONES = [1, 5, 10, 25, 50]; // percent reference lines
const DATA_URL = "/data/hardness-ratio-daily.json";

export default function HardnessRatioChart() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("all");
  const [logScale, setLogScale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: Raw) => {
        if (cancelled) return;
        // Values are stored as fractions; show them as percentages.
        const arr: Row[] = j.data.map(([day, all, monetary]) => ({
          day,
          all: all * 100,
          monetary: monetary * 100,
        }));
        setRows(arr);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  // The series already begins at the first real Bitcoin price, so we never
  // trim to a more flattering later start date.
  const view = useMemo(
    () => (rows ?? []).map((r) => ({ day: r.day, pct: lens === "all" ? r.all : r.monetary })),
    [rows, lens],
  );
  const latest = view.length > 0 ? view[view.length - 1] : null;
  const start = view.length > 0 ? view[0] : null;

  if (error) {
    return <div className="text-sm text-slate-500">Chart unavailable ({error}).</div>;
  }

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="text-sm text-slate-500">
            Bitcoin is now this share of all the {lens === "all" ? "gold ever mined" : "monetary gold"}
          </div>
          {latest && (
            <div className="text-3xl font-bold text-slate-900">
              {latest.pct.toFixed(2)}%
              <span className="ml-2 text-sm font-normal text-slate-500">as of {latest.day}</span>
            </div>
          )}
          {start && (
            <div className="mt-1 text-sm text-slate-500">
              Series begins {start.day}, the first day Bitcoin had a market price.
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1 text-xs">
            <button
              onClick={() => setLens("all")}
              className={
                "px-3 py-1 rounded-md border " +
                (lens === "all"
                  ? "bg-orange text-white border-orange"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50")
              }
            >
              All above-ground gold
            </button>
            <button
              onClick={() => setLens("monetary")}
              className={
                "px-3 py-1 rounded-md border " +
                (lens === "monetary"
                  ? "bg-orange text-white border-orange"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50")
              }
            >
              Monetary gold only
            </button>
          </div>
          <div className="flex gap-1 text-xs">
            <button
              onClick={() => setLogScale(false)}
              className={
                "px-3 py-1 rounded-md border " +
                (!logScale
                  ? "bg-orange text-white border-orange"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50")
              }
            >
              Linear
            </button>
            <button
              onClick={() => setLogScale(true)}
              className={
                "px-3 py-1 rounded-md border " +
                (logScale
                  ? "bg-orange text-white border-orange"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50")
              }
            >
              Log
            </button>
          </div>
        </div>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={view} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <defs>
              <linearGradient id="hardnessFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickFormatter={(d: string) => d.slice(0, 4)}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickFormatter={(v: number) => `${v}%`}
              width={48}
              scale={logScale ? "log" : "auto"}
              domain={logScale ? [0.001, 100] : [0, "auto"]}
              allowDataOverflow
            />
            {MILESTONES.map((m) => (
              <ReferenceLine
                key={m}
                y={m}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                label={{
                  value: `${m}%`,
                  position: "right",
                  fontSize: 10,
                  fill: "#94a3b8",
                }}
              />
            ))}
            <Tooltip
              formatter={(v: number) => `${v.toFixed(3)}%`}
              labelFormatter={(d: string) => d}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Area
              type="monotone"
              dataKey="pct"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#hardnessFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 leading-relaxed">
        <p>
          <span className="font-semibold text-slate-700">How to read this honestly.</span> This
          treats gold and Bitcoin purely as monetary assets. It ignores gold's industrial and
          jewellery demand, and it ignores lost or unspendable supply on both sides, including
          coins locked out of reach forever. The toggle above lets you swap the denominator:{" "}
          <span className="font-medium">all above-ground gold</span> (every ounce ever mined) versus{" "}
          <span className="font-medium">monetary gold only</span>, the roughly 18 percent held as
          official reserves by central banks (World Gold Council end-2025 breakdown). Watch the
          headline number move with that one assumption.
        </p>
        <p className="mt-2">
          Formula: (Bitcoin circulating supply x BTC/USD) divided by (above-ground gold in troy
          ounces x XAU/USD). Bitcoin supply is computed from the protocol halving schedule;
          above-ground gold is from World Gold Council year-end estimates. Prices are joined only on
          days both markets set a price.
        </p>
      </div>

      <div className="mt-2 text-xs text-slate-400">
        Source: ORBI BTC/USD, LBMA gold fix, World Gold Council. CC-BY 4.0. {view.length} joined
        days.{" "}
        <a href={DATA_URL} className="text-orange hover:underline">
          Replay the arithmetic from the exact JSON this chart drew.
        </a>
      </div>
    </div>
  );
}
