import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TelemetryState } from '../types/robotics';
import { audioSynth } from '../utils/audioSynthesizer';
import {
  Battery,
  Zap,
  ShieldCheck,
  Thermometer,
  Radio,
  CheckCircle,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Activity,
  Clock,
  Gauge,
  Flame,
  AlertTriangle,
  MapPin,
  Sliders,
  Timer,
  ChevronRight,
  Info,
  Sparkles,
  Layers,
} from 'lucide-react';

interface ElectricalBmsViewProps {
  telemetry: TelemetryState;
  updateTelemetry: (partial: Partial<TelemetryState>) => void;
}

interface BatterySoCHistoryPoint {
  timeOffsetMin: number;
  percent: number;
  powerWatts: number;
  voltage: number;
}

interface DischargeSample {
  second: number;      // 0 to 60 (relative seconds)
  currentAmps: number; // positive = charging, negative = discharging
  powerWatts: number;  // instantaneous Watts
  percent: number;     // state of charge %
}

export const ElectricalBmsView: React.FC<ElectricalBmsViewProps> = ({
  telemetry,
  updateTelemetry,
}) => {
  const [isDockingRoutine, setIsDockingRoutine] = useState(false);
  const [dockingStep, setDockingStep] = useState<string>('IDLE');
  const [hoveredSampleIndex, setHoveredSampleIndex] = useState<number | null>(null);
  const [simulationPowerOverride, setSimulationPowerOverride] = useState<number | null>(null);
  const [targetReservePercent, setTargetReservePercent] = useState<number>(20);
  const [forecastHorizon, setForecastHorizon] = useState<'30m' | '60m' | '120m' | 'deplete'>('60m');
  const [showGaitSlopes, setShowGaitSlopes] = useState<boolean>(true);
  const [showConfidenceFan, setShowConfidenceFan] = useState<boolean>(true);
  const [hoveredSocData, setHoveredSocData] = useState<{
    timeMin: number;
    percent: number;
    power: number;
    isProjected: boolean;
    x: number;
    y: number;
  } | null>(null);

  // Initialize 30 minutes of historical battery percentage data points leading up to NOW (T=0)
  const [socHistory, setSocHistory] = useState<BatterySoCHistoryPoint[]>(() => {
    const points: BatterySoCHistoryPoint[] = [];
    const currentPercent = telemetry.batteryPercent;
    const basePwr = telemetry.power || 234;
    // Over the past 30 minutes, battery drained at ~(basePwr / 720) * 100 / 60 % per min
    const drainPerMin = (basePwr / 720) * (100 / 60);
    for (let m = 30; m >= 0; m -= 2) {
      const historicalDrain = drainPerMin * m;
      const noise = Math.sin(m * 0.4) * 0.4 + Math.cos(m * 0.7) * 0.3;
      const pct = Math.min(100, Math.max(10, currentPercent + historicalDrain + noise));
      points.push({
        timeOffsetMin: -m,
        percent: parseFloat(pct.toFixed(2)),
        powerWatts: Math.round(basePwr + Math.sin(m * 0.5) * 18),
        voltage: parseFloat((48.24 + (pct - currentPercent) * 0.025).toFixed(2)),
      });
    }
    return points;
  });

  // Initialize 60 seconds of realistic historical discharge rate data
  const [dischargeHistory, setDischargeHistory] = useState<DischargeSample[]>(() => {
    const samples: DischargeSample[] = [];
    const basePwr = telemetry.power || 234;
    const baseCurrent = telemetry.chargingState === 'docked_charging' ? 78.4 : -(basePwr / 48.24);

    for (let i = 59; i >= 0; i--) {
      // Natural slight fluctuation
      const noise = (Math.sin(i * 0.3) * 0.4) + (Math.cos(i * 0.7) * 0.3);
      const cur = parseFloat((baseCurrent + noise).toFixed(2));
      const pwr = Math.round(Math.abs(cur) * 48.24);
      samples.push({
        second: 60 - i,
        currentAmps: cur,
        powerWatts: pwr,
        percent: Math.max(10, Math.min(100, telemetry.batteryPercent + (i * 0.005))),
      });
    }
    return samples;
  });

  // 1-second interval to push new discharge telemetry sample into the 60-second rolling buffer
  useEffect(() => {
    const timer = setInterval(() => {
      const isCharging = telemetry.chargingState === 'docked_charging';
      const busVoltage = telemetry.voltage || 48.24;
      const effectivePower = telemetry.power || (isCharging ? 3780 : 234);

      // Negative when discharging, positive when fast-charging
      const rawCurrent = isCharging ? 78.4 : -(effectivePower / busVoltage);
      const jitter = (Math.random() - 0.5) * 0.3;
      const currentAmps = parseFloat((rawCurrent + jitter).toFixed(2));
      const powerWatts = Math.round(Math.abs(currentAmps) * busVoltage);

      setDischargeHistory((prev) => {
        const next = [...prev.slice(1)];
        const lastSec = prev[prev.length - 1]?.second || 60;
        next.push({
          second: lastSec + 1,
          currentAmps,
          powerWatts,
          percent: telemetry.batteryPercent,
        });
        return next;
      });

      // Maintain latest real-time battery percentage point at T=0 in SoC history
      setSocHistory((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        updated[updated.length - 1] = {
          timeOffsetMin: 0,
          percent: telemetry.batteryPercent,
          powerWatts: effectivePower,
          voltage: busVoltage,
        };
        return updated;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [telemetry.chargingState, telemetry.power, telemetry.voltage, telemetry.batteryPercent]);

  // Derived 60-Second Discharge Analytics
  const analytics = useMemo(() => {
    if (dischargeHistory.length === 0) {
      return {
        avgCurrent: 4.85,
        avgPower: 234,
        peakCurrent: 5.4,
        minCurrent: 4.2,
        depletionRatePctPerMin: 0.28,
        projectedRemainingMin: 180,
      };
    }

    const currents = dischargeHistory.map((s) => Math.abs(s.currentAmps));
    const powers = dischargeHistory.map((s) => s.powerWatts);

    const avgCurrent = currents.reduce((a, b) => a + b, 0) / currents.length;
    const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;
    const peakCurrent = Math.max(...currents);
    const minCurrent = Math.min(...currents);

    // Energy remaining: (SoC % / 100) * 720 Wh
    const remainingWh = (telemetry.batteryPercent / 100) * 720;
    const projectedRemainingHours = avgPower > 10 ? remainingWh / avgPower : 10;
    const projectedRemainingMin = Math.round(projectedRemainingHours * 60);

    // Depletion rate in % per minute: (avgPower / 720Wh) * 100 * (1/60)
    const depletionRatePctPerMin = parseFloat(((avgPower / 720) * 100 / 60).toFixed(2));

    return {
      avgCurrent: parseFloat(avgCurrent.toFixed(2)),
      avgPower: Math.round(avgPower),
      peakCurrent: parseFloat(peakCurrent.toFixed(2)),
      minCurrent: parseFloat(minCurrent.toFixed(2)),
      depletionRatePctPerMin,
      projectedRemainingMin,
    };
  }, [dischargeHistory, telemetry.batteryPercent]);

  // Dynamic Operational Autonomy & Remaining Runtime Calculations
  const totalCapacityWh = 720; // 48V * 15Ah Li-Ion Core
  const currentSoC = Math.max(0, Math.min(100, telemetry.batteryPercent));
  const isCharging = telemetry.chargingState === 'docked_charging';
  const effectivePower = simulationPowerOverride !== null
    ? simulationPowerOverride
    : (isCharging ? 3780 : Math.max(15, analytics.avgPower));

  const totalRemainingWh = (currentSoC / 100) * totalCapacityWh;
  const reserveEnergyWh = (targetReservePercent / 100) * totalCapacityWh;
  const usableEnergyToReserveWh = Math.max(0, totalRemainingWh - reserveEnergyWh);

  // Time to empty (0% cutoff) and time to reserve (e.g. 20% Return-to-Home)
  const timeToEmptySeconds = !isCharging && effectivePower > 5
    ? Math.round((totalRemainingWh / effectivePower) * 3600)
    : 0;

  const timeToReserveSeconds = !isCharging && effectivePower > 5
    ? Math.round((usableEnergyToReserveWh / effectivePower) * 3600)
    : 0;

  // Charging projections (80A constant current to 80%, then CV tapering)
  const chargeNeededTo80 = Math.max(0, 80 - currentSoC);
  const timeTo80Min = Math.round((chargeNeededTo80 / 4.44));
  const chargeNeededTo100 = Math.max(0, 100 - currentSoC);
  const timeTo100Min = Math.round((chargeNeededTo80 / 4.44) + (chargeNeededTo100 > 20 ? 8 : 4));

  // Time formatter helpers
  const formatHMS = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return {
      hours: h,
      minutes: m,
      seconds: s,
      digital: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`,
      short: h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`,
    };
  };

  const emptyHMS = formatHMS(timeToEmptySeconds);
  const reserveHMS = formatHMS(timeToReserveSeconds);

  // Locomotion range projections
  const currentSpeed = telemetry.emergencyStop ? 0 : Math.max(0.1, telemetry.linearVelocity);
  const projectedRangeKm = ((currentSpeed * timeToEmptySeconds) / 1000).toFixed(1);
  const safeSortieRadiusKm = ((currentSpeed * (timeToReserveSeconds / 2)) / 1000).toFixed(1);

  // Gait power profiles for comparative autonomy forecasting
  const gaitEnduranceProfiles = [
    { id: 'stand', label: 'Stand / Idle', power: 42, speed: 0.0, desc: 'Perception & Comms Only' },
    { id: 'creep', label: 'Creep', power: 95, speed: 0.35, desc: 'Stealth & Close Inspection' },
    { id: 'walk', label: 'Walk', power: 145, speed: 0.75, desc: 'Rough Terrain Traversal' },
    { id: 'trot', label: 'Trot', power: 234, speed: 1.20, desc: 'Nominal Cruising Gait' },
    { id: 'pace', label: 'Pace', power: 260, speed: 1.10, desc: 'Lateral Weight Shifting' },
    { id: 'gallop', label: 'Gallop', power: 480, speed: 2.40, desc: 'High-Velocity Pursuit' },
    { id: 'bound', label: 'Bound', power: 690, speed: 3.10, desc: 'Peak Obstacle Clearance' },
  ];

  // Trigger interactive docking sequence
  const startDockingSequence = () => {
    setIsDockingRoutine(true);
    setDockingStep('OPTICAL BEACON ACQUISITION');
    updateTelemetry({ controlMode: 'docking', gait: 'crawl', linearVelocity: 0.3 });

    setTimeout(() => {
      setDockingStep('MAGNETIC COLLAR ALIGNMENT (±1.5mm)');
    }, 1500);

    setTimeout(() => {
      setDockingStep('ENGAGING 80A SOLID COPPER TERMINALS');
      audioSynth.playDockingLatch(telemetry.audioEnabled);
    }, 3000);

    setTimeout(() => {
      setDockingStep('CHARGING: 80A CONTINUOUS CURRENT (0-80% in 18 min)');
      updateTelemetry({
        chargingState: 'docked_charging',
        linearVelocity: 0,
        gait: 'stand',
        batteryPercent: Math.min(100, telemetry.batteryPercent + 12),
      });
      setIsDockingRoutine(false);
    }, 4500);
  };

  const undock = () => {
    updateTelemetry({ chargingState: 'disconnected', controlMode: 'manual' });
    setDockingStep('IDLE');
  };

  // 12 cell voltages in 48V pack (nominally 4.01V each)
  const cellVoltages = [
    4.02, 4.01, 4.03, 4.02, 4.01, 4.04, 4.02, 4.01, 4.03, 4.02, 4.01, 4.02,
  ];

  // SVG Sparkline path generation
  const svgWidth = 640;
  const svgHeight = 110;
  const pad = { top: 12, right: 16, bottom: 22, left: 16 };
  const graphW = svgWidth - pad.left - pad.right;
  const graphH = svgHeight - pad.top - pad.bottom;

  // Find min and max for scaling
  const values = dischargeHistory.map((s) => (isCharging ? s.currentAmps : Math.abs(s.currentAmps)));
  const minVal = Math.min(...values, 0);
  const maxVal = Math.max(...values, isCharging ? 85 : 12);
  const range = maxVal - minVal || 1;

  const points = dischargeHistory.map((s, idx) => {
    const val = isCharging ? s.currentAmps : Math.abs(s.currentAmps);
    const x = pad.left + (idx / Math.max(1, dischargeHistory.length - 1)) * graphW;
    const y = pad.top + graphH - ((val - minVal) / range) * graphH;
    return { x, y, sample: s, val };
  });

  const pathD = points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`, '');
  const areaD = points.length > 0
    ? `${pathD} L ${points[points.length - 1].x},${pad.top + graphH} L ${points[0].x},${pad.top + graphH} Z`
    : '';

  const activeHoverSample =
    hoveredSampleIndex !== null && points[hoveredSampleIndex]
      ? points[hoveredSampleIndex]
      : points[points.length - 1];

  // =========================================================================
  // Historical Battery SoC Line Chart & Projected Depletion Slope Modeling
  // =========================================================================
  const futureMinutes = useMemo(() => {
    if (forecastHorizon === '30m') return 30;
    if (forecastHorizon === '60m') return 60;
    if (forecastHorizon === '120m') return 120;
    return Math.min(240, Math.max(35, Math.ceil(timeToEmptySeconds / 60)));
  }, [forecastHorizon, timeToEmptySeconds]);

  // Depletion slope: % per minute
  // When discharging, effectivePower (W) is positive, slope is negative: -(effectivePower / 720) * (100 / 60)
  // When charging, slope is positive: +(3780 / 720) * (100 / 60) * 0.85
  const slopePerMin = isCharging
    ? +((3780 / 720) * (100 / 60) * 0.85)
    : -((effectivePower / 720) * (100 / 60));

  const slopePerHour = slopePerMin * 60;

  // Key Intercept Event Timelines (in minutes from NOW)
  const rthInterceptMin = !isCharging && slopePerMin < 0 && currentSoC > targetReservePercent
    ? (currentSoC - targetReservePercent) / Math.abs(slopePerMin)
    : null;

  const cutoffInterceptMin = !isCharging && slopePerMin < 0 && currentSoC > 10
    ? (currentSoC - 10) / Math.abs(slopePerMin)
    : null;

  const emptyInterceptMin = !isCharging && slopePerMin < 0 && currentSoC > 0
    ? currentSoC / Math.abs(slopePerMin)
    : null;

  const chargeFullInterceptMin = isCharging && slopePerMin > 0
    ? (100 - currentSoC) / slopePerMin
    : null;

  const socSvgW = 860;
  const socSvgH = 260;
  const socPad = { top: 32, right: 30, bottom: 32, left: 46 };
  const socPlotW = socSvgW - socPad.left - socPad.right;
  const socPlotH = socSvgH - socPad.top - socPad.bottom;

  const pastMin = 30;
  const tMin = -pastMin;
  const tMax = futureMinutes;
  const tRange = tMax - tMin;

  const getSocX = useCallback((t: number) => {
    return socPad.left + ((t - tMin) / tRange) * socPlotW;
  }, [tMin, tRange, socPlotW, socPad.left]);

  const getSocY = useCallback((pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    return socPad.top + socPlotH - (clamped / 100) * socPlotH;
  }, [socPad.top, socPlotH]);

  const socXNow = getSocX(0);
  const socYNow = getSocY(currentSoC);

  // Historical points and paths
  const socHistPoints = socHistory.map((pt) => ({
    x: getSocX(pt.timeOffsetMin),
    y: getSocY(pt.percent),
    ...pt,
  }));

  const socHistPathD = socHistPoints.reduce(
    (acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
    ''
  );

  const socHistAreaD = socHistPoints.length > 0
    ? `${socHistPathD} L ${socXNow.toFixed(1)},${(socPad.top + socPlotH).toFixed(1)} L ${socHistPoints[0].x.toFixed(1)},${(socPad.top + socPlotH).toFixed(1)} Z`
    : '';

  // Projected slope steps
  const socProjSteps: { t: number; x: number; y: number; pct: number }[] = [];
  const projStepCount = 30;
  for (let i = 0; i <= projStepCount; i++) {
    const t = (i / projStepCount) * futureMinutes;
    const pct = Math.max(0, Math.min(100, currentSoC + slopePerMin * t));
    socProjSteps.push({
      t,
      x: getSocX(t),
      y: getSocY(pct),
      pct,
    });
  }

  const socProjPathD = socProjSteps.reduce(
    (acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
    ''
  );

  const socProjAreaD = socProjSteps.length > 0
    ? `${socProjPathD} L ${socProjSteps[socProjSteps.length - 1].x.toFixed(1)},${(socPad.top + socPlotH).toFixed(1)} L ${socXNow.toFixed(1)},${(socPad.top + socPlotH).toFixed(1)} Z`
    : '';

  // Confidence Fan Cone (±18% Load Tolerance)
  const optSlope = slopePerMin * 0.82;
  const pessSlope = slopePerMin * 1.18;

  const fanUpper = socProjSteps.map((p) => {
    const pct = Math.max(0, Math.min(100, currentSoC + optSlope * p.t));
    return { x: p.x, y: getSocY(pct) };
  });
  const fanLower = socProjSteps.map((p) => {
    const pct = Math.max(0, Math.min(100, currentSoC + pessSlope * p.t));
    return { x: p.x, y: getSocY(pct) };
  });

  const fanConePathD = `M ${socXNow.toFixed(1)},${socYNow.toFixed(1)} ` +
    fanUpper.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ' ' +
    [...fanLower].reverse().map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ' Z';

  // Comparative Gait Slopes
  const gaitSlopeCurves = useMemo(() => {
    const sampleGaits = [
      { id: 'stand', label: 'Stand (42W)', power: 42, color: '#34d399' },
      { id: 'walk', label: 'Walk (145W)', power: 145, color: '#38bdf8' },
      { id: 'trot', label: 'Trot (234W)', power: 234, color: '#f59e0b' },
      { id: 'gallop', label: 'Gallop (480W)', power: 480, color: '#f43f5e' },
    ];
    return sampleGaits.map((g) => {
      const gSlope = -((g.power / 720) * (100 / 60));
      const gEndX = getSocX(futureMinutes);
      const gEndPct = Math.max(0, Math.min(100, currentSoC + gSlope * futureMinutes));
      const gEndY = getSocY(gEndPct);
      return {
        ...g,
        slope: gSlope,
        d: `M ${socXNow.toFixed(1)},${socYNow.toFixed(1)} L ${gEndX.toFixed(1)},${gEndY.toFixed(1)}`,
        endX: gEndX,
        endY: gEndY,
        endPct: gEndPct,
      };
    });
  }, [currentSoC, futureMinutes, socXNow, socYNow, getSocX, getSocY]);

  // Handle SVG Mouse Move for Scrubber Tooltip
  const handleSocChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - svgRect.left;
    const relX = (mouseX / svgRect.width) * socSvgW;
    const clampedRelX = Math.max(socPad.left, Math.min(socPad.left + socPlotW, relX));
    const t = tMin + ((clampedRelX - socPad.left) / socPlotW) * tRange;

    if (t <= 0) {
      let closest = socHistPoints[0];
      let minDist = Math.abs(closest.timeOffsetMin - t);
      for (const pt of socHistPoints) {
        const d = Math.abs(pt.timeOffsetMin - t);
        if (d < minDist) {
          minDist = d;
          closest = pt;
        }
      }
      setHoveredSocData({
        timeMin: closest.timeOffsetMin,
        percent: closest.percent,
        power: closest.powerWatts,
        isProjected: false,
        x: closest.x,
        y: closest.y,
      });
    } else {
      const pct = Math.max(0, Math.min(100, currentSoC + slopePerMin * t));
      setHoveredSocData({
        timeMin: parseFloat(t.toFixed(1)),
        percent: parseFloat(pct.toFixed(2)),
        power: effectivePower,
        isProjected: true,
        x: clampedRelX,
        y: getSocY(pct),
      });
    }
  };

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-6 shadow-xl space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1">
            Electrical Architecture & Energy Storage
          </div>
          <h2 className="font-['Chakra_Petch'] text-2xl font-bold text-slate-100">
            48V SMART BMS & HIGH-CURRENT DOCKING INTERFACE
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1">
            <span>48V 15Ah Li-Ion Core (720 Wh)</span>
            <span aria-hidden="true">·</span>
            <span>Liquid Cooling Thermal Manifold</span>
            <span aria-hidden="true">·</span>
            <span>80A Ultra-Fast Charging Port</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {telemetry.chargingState === 'docked_charging' ? (
            <button
              onClick={undock}
              className="px-4 py-2 rounded bg-amber-950/60 hover:bg-amber-900/60 border border-amber-600/80 text-xs font-mono text-amber-200 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>DISENGAGE DOCK</span>
            </button>
          ) : (
            <button
              onClick={startDockingSequence}
              disabled={isDockingRoutine}
              className="px-4 py-2 rounded bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-600/80 text-xs font-mono text-cyan-200 flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isDockingRoutine ? 'animate-spin' : ''}`} />
              <span>{isDockingRoutine ? dockingStep : 'TRIGGER AUTO-DOCKING'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid: Pack Gauges, 12-Cell Monitor, Docking Terminal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Battery Pack Overall Telemetry */}
        <div className="lg:col-span-4 bg-[#050811] rounded-lg border border-slate-800/80 p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400 uppercase">State of Charge</span>
              <span className="text-xs font-mono text-cyan-400">
                {telemetry.chargingState === 'docked_charging' ? 'FAST CHARGING' : 'DISCHARGING'}
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-3">
              <span className="font-['Chakra_Petch'] text-5xl font-bold text-slate-100 tabular-nums">
                {telemetry.batteryPercent}
              </span>
              <span className="text-xl font-mono text-cyan-400">%</span>
            </div>

            {/* Visual charge bar */}
            <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden mt-3 p-0.5 border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${telemetry.batteryPercent}%` }}
              />
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-800/80 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Pack Voltage</span>
              <span className="text-slate-200 font-bold tabular-nums">48.24 V</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Discharge / Charge Current</span>
              <span className="text-cyan-300 font-bold tabular-nums">
                {telemetry.chargingState === 'docked_charging' ? '+78.4 A (FAST CHARGE)' : `-${analytics.avgCurrent} A`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Active Power Consumption</span>
              <span className="text-slate-200 font-bold tabular-nums">
                {telemetry.chargingState === 'docked_charging' ? '3,780 W (Input)' : `${analytics.avgPower} W`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Thermal Manifold (Liquid-Cooled)</span>
              <span className="text-emerald-400 font-bold tabular-nums">31.6°C (Optimal)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">CAN-FD BMS Telemetry</span>
              <span className="text-emerald-400 font-bold">DUAL REDUNDANT</span>
            </div>
          </div>
        </div>

        {/* Center: 12-Cell Series Balance Matrix */}
        <div className="lg:col-span-5 bg-[#050811] rounded-lg border border-slate-800/80 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-200 uppercase tracking-wider">
                12S Li-Ion Cell Balance Matrix
              </h4>
              <span className="text-[11px] font-mono text-emerald-400">Delta: ±4 mV</span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Real-time per-cell voltage monitoring via Smart BMS with passive shunt dissipation and dynamic balance equalization.
            </p>

            <div className="grid grid-cols-4 gap-2.5">
              {cellVoltages.map((v, i) => (
                <div
                  key={i}
                  className="p-2.5 bg-slate-950 rounded border border-slate-800/80 text-center"
                >
                  <div className="text-[10px] font-mono text-slate-500 uppercase">C{i + 1}</div>
                  <div className="font-mono text-xs font-bold text-cyan-300 tabular-nums mt-1">
                    {v.toFixed(3)}V
                  </div>
                  <div className="w-full h-1 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                    <div className="h-full bg-cyan-400" style={{ width: '92%' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>Liquid Coolant Temp: 28.4°C</span>
            <span>Pump Flow Rate: 1.8 L/min</span>
          </div>
        </div>

        {/* Right: Magnetic Docking & 80A Fast Charging Hardware */}
        <div className="lg:col-span-3 bg-[#050811] rounded-lg border border-slate-800/80 p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="text-xs font-mono text-amber-400 uppercase tracking-wider mb-1">
              Docking Hardware
            </div>
            <h4 className="font-['Chakra_Petch'] text-base font-bold text-slate-100">
              80A Rapid Interface
            </h4>

            <div className="mt-4 space-y-3 text-xs text-slate-400">
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <div className="text-slate-300 font-semibold font-['Chakra_Petch'] mb-1">
                  Magnetic Alignment Port
                </div>
                <div className="text-[11px] leading-relaxed">
                  Self-mating electromagnetic guidance collar that dynamically pulls and locks the robot's underbelly port into contact.
                </div>
              </div>

              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <div className="text-slate-300 font-semibold font-['Chakra_Petch'] mb-1">
                  Solid Copper Contact Pins
                </div>
                <div className="text-[11px] leading-relaxed">
                  Heavy-duty copper terminals supporting up to 80A continuous, achieving 0-80% charge in under 18 minutes.
                </div>
              </div>

              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <div className="text-slate-300 font-semibold font-['Chakra_Petch'] mb-1">
                  Optical Homing Beacon
                </div>
                <div className="text-[11px] leading-relaxed">
                  Dual pulsed IR lasers emit localized structured beams assisting robodog vision for millimeter precision docking.
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/80 text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Status:</span>
            <span
              className={`font-semibold ${
                telemetry.chargingState === 'docked_charging' ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              {telemetry.chargingState === 'docked_charging' ? 'DOCKED & CHARGING' : 'STANDBY'}
            </span>
          </div>
        </div>
      </div>

      {/* HISTORICAL BATTERY STATE OF CHARGE & PROJECTED DEPLETION SLOPE CHART */}
      <div className="bg-[#050811] rounded-lg border border-slate-800/90 p-5 space-y-4 shadow-xl">
        {/* Header & Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-['Chakra_Petch'] text-base font-bold text-slate-100 uppercase tracking-wider">
                  Battery SoC History & Projected Depletion Slope
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-700/60">
                  {isCharging ? '80A RAPID CHARGE' : 'DYNAMIC POWER MODEL'}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Past 30-minute state-of-charge curve with continuous telemetry history and forward-looking depletion slope based on {effectivePower}W current load.
              </p>
            </div>
          </div>

          {/* Forecast Range & Display Toggles */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Horizon Selector */}
            <div className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-xs font-mono">
              <span className="text-slate-400 text-[11px] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Forecast:</span>
              </span>
              {(['30m', '60m', '120m', 'deplete'] as const).map((hz) => (
                <button
                  key={hz}
                  onClick={() => setForecastHorizon(hz)}
                  className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                    forecastHorizon === hz
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {hz === 'deplete' ? 'To 0%' : `+${hz}`}
                </button>
              ))}
            </div>

            {/* Confidence Fan Toggle */}
            <button
              onClick={() => setShowConfidenceFan((prev) => !prev)}
              className={`px-2.5 py-1 rounded border text-[11px] font-mono flex items-center gap-1.5 cursor-pointer transition-colors ${
                showConfidenceFan
                  ? 'bg-amber-950/50 border-amber-600/70 text-amber-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
              }`}
              title="Toggle ±18% power variance confidence cone"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>±18% Cone</span>
            </button>

            {/* Gait Comparison Slopes Toggle */}
            <button
              onClick={() => setShowGaitSlopes((prev) => !prev)}
              className={`px-2.5 py-1 rounded border text-[11px] font-mono flex items-center gap-1.5 cursor-pointer transition-colors ${
                showGaitSlopes
                  ? 'bg-cyan-950/50 border-cyan-600/70 text-cyan-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
              }`}
              title="Show comparative depletion slopes for Stand, Walk, Trot, and Gallop"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gait Slopes</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Stat Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 uppercase">Current SoC (T=0)</div>
            <div className="text-lg font-bold font-['Chakra_Petch'] text-cyan-300 mt-0.5">
              {currentSoC}% <span className="text-xs font-mono text-slate-400 font-normal">({totalRemainingWh.toFixed(0)} Wh)</span>
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">Bus Voltage: 48.24 V</div>
          </div>

          <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 uppercase">Depletion Gradient</div>
            <div className={`text-lg font-bold font-['Chakra_Petch'] mt-0.5 ${isCharging ? 'text-emerald-400' : 'text-amber-300'}`}>
              {isCharging ? `+${slopePerMin.toFixed(2)}% / min` : `${slopePerMin.toFixed(2)}% / min`}
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              {isCharging ? 'Tapering CV Phase' : `${Math.abs(slopePerHour).toFixed(1)}% / hour @ ${effectivePower}W`}
            </div>
          </div>

          <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
              <span>RTH Trigger Reserve</span>
              <span className="text-amber-400 font-bold">{targetReservePercent}%</span>
            </div>
            <div className="text-lg font-bold font-['Chakra_Petch'] text-amber-300 mt-0.5">
              {isCharging ? 'N/A' : rthInterceptMin !== null ? `+${Math.round(rthInterceptMin)} min` : 'REACHED'}
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Usable mission window remaining
            </div>
          </div>

          <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 uppercase">Full Depletion (0%)</div>
            <div className="text-lg font-bold font-['Chakra_Petch'] text-rose-300 mt-0.5">
              {isCharging
                ? chargeFullInterceptMin !== null ? `+${Math.round(chargeFullInterceptMin)}m (100%)` : 'FULL'
                : emptyInterceptMin !== null ? `+${Math.round(emptyInterceptMin)} min` : 'EMPTY'}
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Critical 10% cutoff: {cutoffInterceptMin !== null ? `+${Math.round(cutoffInterceptMin)}m` : 'EXCEEDED'}
            </div>
          </div>
        </div>

        {/* The SVG Line Chart */}
        <div className="relative bg-[#03060f] rounded-lg border border-slate-800/90 p-3 select-none">
          {/* Chart Header Tag and Live Status */}
          <div className="flex flex-wrap items-center justify-between text-[11px] font-mono mb-2 text-slate-400 px-1">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-cyan-300">
                <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
                <strong className="text-slate-200">Historical Measured SoC (Past 30m)</strong>
              </span>
              <span className="text-slate-700">|</span>
              <span className="flex items-center gap-1.5 text-amber-300">
                <span className="w-2.5 h-0.5 border-t border-dashed border-amber-400 inline-block" />
                <strong className="text-slate-200">Projected Depletion Slope ({effectivePower}W)</strong>
              </span>
            </div>

            {/* Live Hover Scrubber Readout Badge */}
            {hoveredSocData ? (
              <div className="px-2 py-0.5 rounded bg-cyan-950/90 border border-cyan-500/80 text-cyan-200 flex items-center gap-2">
                <span>
                  {hoveredSocData.isProjected ? `T+${hoveredSocData.timeMin}m (Projected)` : `T${hoveredSocData.timeMin}m (Historical)`}
                </span>
                <span className="font-bold text-white">{hoveredSocData.percent.toFixed(1)}% SoC</span>
                <span className="text-slate-400">({((hoveredSocData.percent / 100) * 720).toFixed(0)} Wh)</span>
                <span className="text-amber-300">{hoveredSocData.power} W</span>
              </div>
            ) : (
              <span className="text-slate-500 text-[10px]">
                Hover to scrub historical telemetry & projected slope
              </span>
            )}
          </div>

          <svg
            viewBox={`0 0 ${socSvgW} ${socSvgH}`}
            className="w-full h-64 overflow-visible cursor-crosshair"
            onMouseMove={handleSocChartMouseMove}
            onMouseLeave={() => setHoveredSocData(null)}
          >
            <defs>
              {/* Historical Area Gradient */}
              <linearGradient id="socHistGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.01" />
              </linearGradient>

              {/* Projected Area Gradient */}
              <linearGradient id="socProjGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
              </linearGradient>

              {/* Confidence Fan Cone Gradient */}
              <linearGradient id="socFanGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.04" />
              </linearGradient>
            </defs>

            {/* Background Shading for Historical vs Future Forecast Regions */}
            {/* Historical Past Background */}
            <rect
              x={socPad.left}
              y={socPad.top}
              width={Math.max(0, socXNow - socPad.left)}
              height={socPlotH}
              fill="rgba(6, 182, 212, 0.02)"
            />

            {/* Future Forecast Background */}
            <rect
              x={socXNow}
              y={socPad.top}
              width={Math.max(0, socPad.left + socPlotW - socXNow)}
              height={socPlotH}
              fill="rgba(245, 158, 11, 0.02)"
            />

            {/* Horizontal Gridlines & Y-Axis Labels (0%, 20%, 40%, 60%, 80%, 100%) */}
            {[0, 20, 40, 60, 80, 100].map((pct) => {
              const y = getSocY(pct);
              return (
                <g key={pct}>
                  <line
                    x1={socPad.left}
                    y1={y}
                    x2={socPad.left + socPlotW}
                    y2={y}
                    stroke="rgba(51, 65, 85, 0.35)"
                    strokeDasharray={pct === 0 || pct === 100 ? undefined : '3 3'}
                    strokeWidth={pct === 0 || pct === 100 ? 1.2 : 0.8}
                  />
                  <text
                    x={socPad.left - 6}
                    y={y + 3}
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    {pct}%
                  </text>
                </g>
              );
            })}

            {/* 10% BMS Critical Cutoff Reference Line */}
            <g>
              <line
                x1={socPad.left}
                y1={getSocY(10)}
                x2={socPad.left + socPlotW}
                y2={getSocY(10)}
                stroke="rgba(244, 63, 94, 0.55)"
                strokeDasharray="4 3"
                strokeWidth="1.2"
              />
              <text
                x={socPad.left + socPlotW - 4}
                y={getSocY(10) - 4}
                fill="#f43f5e"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="end"
              >
                10% BMS CUTOFF
              </text>
            </g>

            {/* RTH Reserve Reference Line */}
            <g>
              <line
                x1={socPad.left}
                y1={getSocY(targetReservePercent)}
                x2={socPad.left + socPlotW}
                y2={getSocY(targetReservePercent)}
                stroke="rgba(245, 158, 11, 0.55)"
                strokeDasharray="4 3"
                strokeWidth="1.2"
              />
              <text
                x={socPad.left + socPlotW - 4}
                y={getSocY(targetReservePercent) - 4}
                fill="#f59e0b"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="end"
              >
                {targetReservePercent}% RTH RESERVE
              </text>
            </g>

            {/* Vertical NOW Divider Line (T=0) */}
            <line
              x1={socXNow}
              y1={socPad.top}
              x2={socXNow}
              y2={socPad.top + socPlotH}
              stroke="#06b6d4"
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />
            <rect
              x={socXNow - 24}
              y={socPad.top - 18}
              width={48}
              height={14}
              rx={3}
              fill="rgba(6, 182, 212, 0.2)"
              stroke="#06b6d4"
              strokeWidth="1"
            />
            <text
              x={socXNow}
              y={socPad.top - 8}
              fill="#22d3ee"
              fontSize="8"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              NOW (T=0)
            </text>

            {/* Shaded Area Under Historical Curve */}
            {socHistAreaD && <path d={socHistAreaD} fill="url(#socHistGrad)" />}

            {/* Shaded Area Under Projected Slope */}
            {socProjAreaD && <path d={socProjAreaD} fill="url(#socProjGrad)" />}

            {/* Confidence Fan Cone (±18% Load Variance) */}
            {showConfidenceFan && fanConePathD && (
              <g>
                <path d={fanConePathD} fill="url(#socFanGrad)" />
                <path
                  d={`M ${socXNow.toFixed(1)},${socYNow.toFixed(1)} ` + fanUpper.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke="rgba(245, 158, 11, 0.3)"
                  strokeDasharray="2 3"
                  strokeWidth="1"
                />
                <path
                  d={`M ${socXNow.toFixed(1)},${socYNow.toFixed(1)} ` + fanLower.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke="rgba(245, 158, 11, 0.3)"
                  strokeDasharray="2 3"
                  strokeWidth="1"
                />
              </g>
            )}

            {/* Optional Comparative Gait Slopes (Stand, Walk, Trot, Gallop) */}
            {showGaitSlopes &&
              gaitSlopeCurves.map((gc) => (
                <g key={gc.id}>
                  <path
                    d={gc.d}
                    fill="none"
                    stroke={gc.color}
                    strokeDasharray="2 4"
                    strokeWidth="1.2"
                    opacity="0.65"
                  />
                  <text
                    x={gc.endX - 2}
                    y={Math.min(socPad.top + socPlotH - 4, Math.max(socPad.top + 10, gc.endY - 3))}
                    fill={gc.color}
                    fontSize="7.5"
                    fontFamily="monospace"
                    textAnchor="end"
                    opacity="0.85"
                  >
                    {gc.label}
                  </text>
                </g>
              ))}

            {/* Solid Historical SoC Line */}
            {socHistPathD && (
              <path
                d={socHistPathD}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Projected Depletion Slope Line */}
            {socProjPathD && (
              <path
                d={socProjPathD}
                fill="none"
                stroke={isCharging ? '#10b981' : effectivePower > 350 ? '#f43f5e' : '#f59e0b'}
                strokeWidth="2.4"
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Historical Data Sample Dots */}
            {socHistPoints.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r="2.5"
                fill="#080d1a"
                stroke="#06b6d4"
                strokeWidth="1.5"
              />
            ))}

            {/* Intercept Event Markers on the Projected Slope */}
            {/* RTH Reserve Intercept Marker */}
            {rthInterceptMin !== null && rthInterceptMin <= futureMinutes && (
              <g>
                <circle
                  cx={getSocX(rthInterceptMin)}
                  cy={getSocY(targetReservePercent)}
                  r="5"
                  fill="#f59e0b"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                <rect
                  x={getSocX(rthInterceptMin) - 28}
                  y={getSocY(targetReservePercent) - 18}
                  width={56}
                  height={13}
                  rx={2}
                  fill="rgba(15, 23, 42, 0.9)"
                  stroke="#f59e0b"
                  strokeWidth="1"
                />
                <text
                  x={getSocX(rthInterceptMin)}
                  y={getSocY(targetReservePercent) - 9}
                  fill="#f59e0b"
                  fontSize="7.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  RTH +{Math.round(rthInterceptMin)}m
                </text>
              </g>
            )}

            {/* 10% Cutoff Intercept Marker */}
            {cutoffInterceptMin !== null && cutoffInterceptMin <= futureMinutes && (
              <g>
                <circle
                  cx={getSocX(cutoffInterceptMin)}
                  cy={getSocY(10)}
                  r="5"
                  fill="#f43f5e"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                <rect
                  x={getSocX(cutoffInterceptMin) - 30}
                  y={getSocY(10) + 6}
                  width={60}
                  height={13}
                  rx={2}
                  fill="rgba(15, 23, 42, 0.9)"
                  stroke="#f43f5e"
                  strokeWidth="1"
                />
                <text
                  x={getSocX(cutoffInterceptMin)}
                  y={getSocY(10) + 15}
                  fill="#f43f5e"
                  fontSize="7.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  CUTOFF +{Math.round(cutoffInterceptMin)}m
                </text>
              </g>
            )}

            {/* 0% Empty Intercept Marker */}
            {emptyInterceptMin !== null && emptyInterceptMin <= futureMinutes && (
              <g>
                <circle
                  cx={getSocX(emptyInterceptMin)}
                  cy={getSocY(0)}
                  r="5"
                  fill="#f43f5e"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                <text
                  x={getSocX(emptyInterceptMin)}
                  y={getSocY(0) - 8}
                  fill="#f43f5e"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  EMPTY +{Math.round(emptyInterceptMin)}m
                </text>
              </g>
            )}

            {/* Current SoC Node at T=0 (NOW) with Pulsing Halo */}
            <circle
              cx={socXNow}
              cy={socYNow}
              r="8"
              fill="none"
              stroke="#06b6d4"
              strokeWidth="1.5"
              className="animate-ping"
            />
            <circle
              cx={socXNow}
              cy={socYNow}
              r="5.5"
              fill="#06b6d4"
              stroke="#ffffff"
              strokeWidth="2"
            />

            {/* Active Hover Crosshair Line & Point */}
            {hoveredSocData && (
              <g>
                <line
                  x1={hoveredSocData.x}
                  y1={socPad.top}
                  x2={hoveredSocData.x}
                  y2={socPad.top + socPlotH}
                  stroke="#22d3ee"
                  strokeDasharray="2 2"
                  strokeWidth="1.2"
                />
                <circle
                  cx={hoveredSocData.x}
                  cy={hoveredSocData.y}
                  r="5.5"
                  fill="#22d3ee"
                  stroke="#ffffff"
                  strokeWidth="1.8"
                />
              </g>
            )}

            {/* X-Axis Time Markers */}
            <text x={getSocX(-30)} y={socSvgH - 8} fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
              -30m
            </text>
            <text x={getSocX(-20)} y={socSvgH - 8} fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
              -20m
            </text>
            <text x={getSocX(-10)} y={socSvgH - 8} fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
              -10m
            </text>
            <text x={socXNow} y={socSvgH - 8} fill="#22d3ee" fontSize="9" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
              NOW
            </text>
            {futureMinutes >= 30 && (
              <text x={getSocX(15)} y={socSvgH - 8} fill="#94a3b8" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
                +15m
              </text>
            )}
            {futureMinutes >= 45 && (
              <text x={getSocX(30)} y={socSvgH - 8} fill="#94a3b8" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
                +30m
              </text>
            )}
            {futureMinutes >= 75 && (
              <text x={getSocX(60)} y={socSvgH - 8} fill="#94a3b8" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
                +60m
              </text>
            )}
            {futureMinutes >= 110 && (
              <text x={getSocX(90)} y={socSvgH - 8} fill="#94a3b8" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
                +90m
              </text>
            )}
            <text x={getSocX(futureMinutes)} y={socSvgH - 8} fill="#f59e0b" fontSize="8.5" fontFamily="monospace" fontWeight="bold" textAnchor="end">
              +{futureMinutes}m
            </text>
          </svg>
        </div>

        {/* Dynamic Depletion Slope Insight Legend Footer */}
        <div className="pt-1 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-slate-400 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
              <span>Historical SoC</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 border-t border-dashed border-amber-400 inline-block" />
              <span>Active Depletion Slope</span>
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
              <span>RTH Intercept ({targetReservePercent}%)</span>
            </span>
            <span className="flex items-center gap-1.5 text-rose-400">
              <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
              <span>BMS Cutoff (10%)</span>
            </span>
          </div>

          <div className="text-slate-400">
            Current Drain Formula: <code className="text-slate-200">ΔSoC = -({effectivePower}W / 720Wh) × 100%</code>
          </div>
        </div>
      </div>

      {/* PROJECTED OPERATIONAL AUTONOMY & REMAINING RUNTIME SUMMARY PANEL */}
      <div className="bg-[#050811] rounded-lg border border-slate-800/90 p-5 space-y-5 shadow-xl">
        {/* Panel Header & Interactive Load Simulator Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-['Chakra_Petch'] text-base font-bold text-slate-100 uppercase tracking-wider">
                  Projected Operational Autonomy & Runtime Summary
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-700/60">
                  {isCharging ? '80A FAST CHARGING' : simulationPowerOverride !== null ? 'SIMULATED LOAD' : 'LIVE 60S ROLLING'}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Dynamic projection derived from current Battery SoC (<strong className="text-cyan-300">{currentSoC}%</strong> / {totalRemainingWh.toFixed(0)} Wh) and average consumption (<strong className="text-amber-300">{effectivePower} W</strong>).
              </p>
            </div>
          </div>

          {/* Simulation & Reserve Threshold Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-xs font-mono">
              <span className="text-slate-400 text-[11px] flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>RTH Reserve:</span>
              </span>
              {[15, 20, 25, 30].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setTargetReservePercent(pct)}
                  className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                    targetReservePercent === pct
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-xs font-mono">
              <span className="text-slate-400 text-[11px] flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>Load Model:</span>
              </span>
              <button
                onClick={() => setSimulationPowerOverride(null)}
                className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                  simulationPowerOverride === null
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Use real-time rolling average power"
              >
                Live ({analytics.avgPower}W)
              </button>
              <button
                onClick={() => setSimulationPowerOverride(42)}
                className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                  simulationPowerOverride === 42
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Idle Stand (Perception only)"
              >
                Idle (42W)
              </button>
              <button
                onClick={() => setSimulationPowerOverride(234)}
                className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                  simulationPowerOverride === 234
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Nominal Trot"
              >
                Trot (234W)
              </button>
              <button
                onClick={() => setSimulationPowerOverride(480)}
                className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                  simulationPowerOverride === 480
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="High-Speed Gallop"
              >
                Gallop (480W)
              </button>
              <button
                onClick={() => setSimulationPowerOverride(690)}
                className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                  simulationPowerOverride === 690
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Sprint / Max Obstacle Draw"
              >
                Sprint (690W)
              </button>
            </div>
          </div>
        </div>

        {/* 4 Hero Autonomy Telemetry Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Projected Remaining Time (To Empty) */}
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800/90 relative overflow-hidden flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
              <span className="flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isCharging ? 'Charge Time to Full' : 'Projected Operational Time'}</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 font-bold">
                {isCharging ? 'TO 100%' : 'TO 0% EMPTY'}
              </span>
            </div>

            <div className="my-2">
              <div className="font-['Chakra_Petch'] text-3xl font-bold text-emerald-300 tracking-tight tabular-nums">
                {isCharging ? `${timeTo100Min} min` : emptyHMS.digital}
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1 flex items-center justify-between">
                <span>Equivalent:</span>
                <strong className="text-slate-200">{isCharging ? `~${(timeTo100Min / 60).toFixed(1)} hrs` : emptyHMS.short}</strong>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center justify-between">
              <span>Remaining Pack Energy:</span>
              <span className="text-cyan-300 font-bold">{totalRemainingWh.toFixed(1)} Wh</span>
            </div>
          </div>

          {/* Card 2: Return-To-Home (RTH) Safe Mission Window */}
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800/90 relative overflow-hidden flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isCharging ? 'Rapid Charge (to 80%)' : `Safe RTH Mission Window`}</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/50 font-bold">
                {isCharging ? '0-80% SPEC' : `TO ${targetReservePercent}% SoC`}
              </span>
            </div>

            <div className="my-2">
              <div className="font-['Chakra_Petch'] text-3xl font-bold text-cyan-300 tracking-tight tabular-nums">
                {isCharging ? `${timeTo80Min} min` : reserveHMS.digital}
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1 flex items-center justify-between">
                <span>{isCharging ? 'Fast Charge Target:' : 'Usable Before RTH:'}</span>
                <strong className={currentSoC <= targetReservePercent ? 'text-rose-400 font-bold' : 'text-slate-200'}>
                  {isCharging ? '80% State of Charge' : currentSoC <= targetReservePercent ? 'RESERVE BREACHED' : reserveHMS.short}
                </strong>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center justify-between">
              <span>Usable Energy to Reserve:</span>
              <span className="text-cyan-300 font-bold">{usableEnergyToReserveWh.toFixed(1)} Wh</span>
            </div>
          </div>

          {/* Card 3: Projected Operational Distance Reach */}
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800/90 relative overflow-hidden flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                <span>Autonomous Range Reach</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800/50 font-bold">
                {currentSpeed.toFixed(2)} m/s
              </span>
            </div>

            <div className="my-2">
              <div className="font-['Chakra_Petch'] text-3xl font-bold text-amber-300 tracking-tight tabular-nums">
                {isCharging ? '0.0 km' : `${projectedRangeKm} km`}
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1 flex items-center justify-between">
                <span>Safe Sortie Radius:</span>
                <strong className="text-amber-200">±{isCharging ? '0.0' : safeSortieRadiusKm} km</strong>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center justify-between">
              <span>Locomotion Velocity:</span>
              <span className="text-slate-300 font-bold">{(currentSpeed * 3.6).toFixed(1)} km/h</span>
            </div>
          </div>

          {/* Card 4: Energy Depletion Gradient */}
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800/90 relative overflow-hidden flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
              <span className="flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                <span>Energy Drain Velocity</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-950/80 text-rose-300 border border-rose-800/50 font-bold">
                {isCharging ? '+3,780 W' : `${effectivePower} W`}
              </span>
            </div>

            <div className="my-2">
              <div className="font-['Chakra_Petch'] text-3xl font-bold text-rose-300 tracking-tight tabular-nums">
                {isCharging ? '+4.44%' : `-${((effectivePower / 720) * 100 / 60).toFixed(2)}%`}
                <span className="text-sm font-mono text-slate-400 font-normal"> / min</span>
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1 flex items-center justify-between">
                <span>Hourly Consumption:</span>
                <strong className="text-slate-200">
                  {isCharging ? '+266% (Max)' : `~${((effectivePower / 720) * 100).toFixed(1)}% / hr`}
                </strong>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center justify-between">
              <span>Bus Current Equivalent:</span>
              <span className="text-cyan-300 font-bold">{(effectivePower / 48.24).toFixed(2)} A</span>
            </div>
          </div>
        </div>

        {/* Multi-Segment Energy Reserve & Battery Budget Bar */}
        <div className="p-4 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between text-xs font-mono">
            <span className="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-2">
              <span>Battery Energy Budget & Safety Allocation</span>
              <span className="text-slate-500 font-normal">({totalCapacityWh} Wh Li-Ion Architecture)</span>
            </span>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                <span>Usable Mission: <strong>{Math.max(0, currentSoC - targetReservePercent).toFixed(1)}% ({usableEnergyToReserveWh.toFixed(0)} Wh)</strong></span>
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                <span>RTH Safety Reserve: <strong>{targetReservePercent - 10}% ({(((targetReservePercent - 10) / 100) * totalCapacityWh).toFixed(0)} Wh)</strong></span>
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                <span>BMS Cutoff Floor: <strong>10% (72 Wh)</strong></span>
              </span>
            </div>
          </div>

          {/* Visual Segmented Progress Bar */}
          <div className="relative w-full h-4 bg-slate-900 rounded-md overflow-hidden border border-slate-800 flex">
            {/* Cutoff Floor: 0-10% */}
            <div
              className="h-full bg-rose-600/70 border-r border-rose-500/40 relative"
              style={{ width: '10%' }}
              title="Critical Hardware Cutoff (0-10%)"
            />
            {/* RTH Reserve: 10% to targetReservePercent */}
            <div
              className="h-full bg-amber-600/60 border-r border-amber-500/40 relative"
              style={{ width: `${Math.max(0, targetReservePercent - 10)}%` }}
              title={`Return-To-Home Safe Reserve (10% to ${targetReservePercent}%)`}
            />
            {/* Active Usable Budget: targetReservePercent to 100% */}
            <div
              className="h-full bg-gradient-to-r from-emerald-600/80 to-cyan-600/80 relative"
              style={{ width: `${100 - targetReservePercent}%` }}
              title={`Active Mission Operating Window (${targetReservePercent}% to 100%)`}
            />

            {/* Current State-of-Charge Needle Indicator */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_8px_#ffffff] z-10 transition-all duration-300"
              style={{ left: `calc(${currentSoC}% - 2px)` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-0.5">
            <span>0% (Empty Cutoff)</span>
            <span>10% (BMS Critical Floor)</span>
            <span>{targetReservePercent}% (RTH Autonomous Trigger)</span>
            <span>Current SoC: <strong className="text-white">{currentSoC}%</strong></span>
            <span>100% (Fully Saturated)</span>
          </div>
        </div>

        {/* Comparative Locomotion Gait Autonomy Forecasting Matrix */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
              <span>Locomotion Gait Autonomy Forecast Matrix (At Current {currentSoC}% SoC)</span>
            </span>
            <span className="text-[11px] text-slate-400">
              Active Gait: <strong className="text-cyan-300 uppercase">{telemetry.gait}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {gaitEnduranceProfiles.map((gp) => {
              const gaitSec = Math.round((totalRemainingWh / gp.power) * 3600);
              const gaitH = Math.floor(gaitSec / 3600);
              const gaitM = Math.floor((gaitSec % 3600) / 60);
              const gaitDistKm = ((gp.speed * gaitSec) / 1000).toFixed(1);
              const isActive = telemetry.gait === gp.id;

              return (
                <div
                  key={gp.id}
                  className={`p-2.5 rounded-lg border transition-all ${
                    isActive
                      ? 'bg-cyan-950/50 border-cyan-500/80 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                      : 'bg-slate-950/70 border-slate-800/70 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className={`font-bold uppercase ${isActive ? 'text-cyan-300' : 'text-slate-300'}`}>
                      {gp.label}
                    </span>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                    )}
                  </div>

                  <div className="mt-1.5">
                    <div className="text-base font-bold font-['Chakra_Petch'] text-slate-100 tabular-nums">
                      {gaitH > 0 ? `${gaitH}h ${gaitM}m` : `${gaitM}m`}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {gp.power} Watts Draw
                    </div>
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500">Reach:</span>
                    <span className="text-amber-300 font-bold">{gp.speed > 0 ? `${gaitDistKm} km` : 'Stationary'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* DEDICATED 60-SECOND BATTERY DISCHARGE RATE SPARKLINE & ENERGY DEPLETION MONITOR */}
      <div className="bg-[#050811] rounded-lg border border-slate-800/90 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/70">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <TrendingDown className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <span>Battery Discharge Rate & Energy Depletion Trend</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60 font-mono font-normal">
                  LAST 60 SECONDS
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Real-time moving window tracking instantaneous power draw and energy drain velocity.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-slate-400">Sampling Rate: <strong className="text-slate-200">1.0 Hz</strong></span>
            <span aria-hidden="true" className="text-slate-700">|</span>
            <span className="text-slate-400">Buffer: <strong className="text-cyan-300">60 Samples</strong></span>
            <span aria-hidden="true" className="text-slate-700">|</span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE</span>
            </span>
          </div>
        </div>

        {/* Real-time SVG Sparkline Visualization */}
        <div className="relative bg-[#03060f] rounded-lg border border-slate-800/90 p-3 overflow-hidden select-none">
          <div className="flex items-center justify-between text-[11px] font-mono mb-1 text-slate-400">
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 inline-block" />
              <strong className="text-slate-200">
                {isCharging ? 'Charge Absorption Rate (Amperes)' : 'Discharge Drain Current (Amperes)'}
              </strong>
            </span>
            {activeHoverSample && (
              <span className="text-cyan-300 font-bold">
                T-{60 - (hoveredSampleIndex !== null ? hoveredSampleIndex : 59)}s : {activeHoverSample.val.toFixed(2)} A ({activeHoverSample.sample.powerWatts} W)
              </span>
            )}
          </div>

          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-28 overflow-visible cursor-crosshair"
            onMouseLeave={() => setHoveredSampleIndex(null)}
          >
            <defs>
              <linearGradient id="dischargeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isCharging ? '#10b981' : '#f59e0b'} stopOpacity="0.4" />
                <stop offset="100%" stopColor={isCharging ? '#10b981' : '#f59e0b'} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Reference Lines */}
            <line
              x1={pad.left}
              y1={pad.top}
              x2={pad.left + graphW}
              y2={pad.top}
              stroke="rgba(51, 65, 85, 0.4)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <line
              x1={pad.left}
              y1={pad.top + graphH / 2}
              x2={pad.left + graphW}
              y2={pad.top + graphH / 2}
              stroke="rgba(51, 65, 85, 0.3)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <line
              x1={pad.left}
              y1={pad.top + graphH}
              x2={pad.left + graphW}
              y2={pad.top + graphH}
              stroke="rgba(51, 65, 85, 0.5)"
              strokeWidth="1"
            />

            {/* Shaded Area under Curve */}
            {areaD && <path d={areaD} fill="url(#dischargeGrad)" />}

            {/* Sparkline Stroke */}
            {pathD && (
              <path
                d={pathD}
                fill="none"
                stroke={isCharging ? '#10b981' : '#f59e0b'}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Pulsing Head Dot */}
            {points.length > 0 && (
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="4.5"
                fill={isCharging ? '#10b981' : '#f59e0b'}
                className="animate-pulse"
              />
            )}

            {/* Interactive hover scrub target bars */}
            {points.map((pt, i) => (
              <rect
                key={i}
                x={pt.x - graphW / points.length / 2}
                y={pad.top}
                width={graphW / points.length}
                height={graphH}
                fill="transparent"
                onMouseEnter={() => setHoveredSampleIndex(i)}
              />
            ))}

            {/* Active Hover Crosshair Line */}
            {hoveredSampleIndex !== null && points[hoveredSampleIndex] && (
              <g>
                <line
                  x1={points[hoveredSampleIndex].x}
                  y1={pad.top}
                  x2={points[hoveredSampleIndex].x}
                  y2={pad.top + graphH}
                  stroke="#22d3ee"
                  strokeWidth="1.2"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={points[hoveredSampleIndex].x}
                  cy={points[hoveredSampleIndex].y}
                  r="5"
                  fill="#22d3ee"
                />
              </g>
            )}

            {/* X-Axis Time Markers */}
            <text x={pad.left} y={svgHeight - 4} fill="#64748b" fontSize="9" fontFamily="monospace">
              -60s
            </text>
            <text x={pad.left + graphW * 0.25} y={svgHeight - 4} fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="middle">
              -45s
            </text>
            <text x={pad.left + graphW * 0.5} y={svgHeight - 4} fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="middle">
              -30s
            </text>
            <text x={pad.left + graphW * 0.75} y={svgHeight - 4} fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="middle">
              -15s
            </text>
            <text x={pad.left + graphW} y={svgHeight - 4} fill="#22d3ee" fontSize="9" fontFamily="monospace" textAnchor="end">
              NOW
            </text>
          </svg>
        </div>

        {/* 4 Quantitative Depletion Trend Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* 1. Instantaneous Discharge Rate */}
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
              <span>Instantaneous Drain</span>
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-amber-300 tabular-nums">
                {isCharging ? `+${activeHoverSample.val.toFixed(2)}` : `-${activeHoverSample.val.toFixed(2)}`}
              </span>
              <span className="text-xs font-mono text-slate-400">A</span>
              <span className="text-[10px] font-mono text-slate-500 ml-auto">
                {activeHoverSample.sample.powerWatts} W
              </span>
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-400">
              Active C-Rate: <strong className="text-slate-200">{(activeHoverSample.val / 15).toFixed(2)}C</strong>
            </div>
          </div>

          {/* 2. 60-Second Moving Average Power */}
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
              <span>60s Average Power</span>
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-cyan-300 tabular-nums">
                {analytics.avgPower}
              </span>
              <span className="text-xs font-mono text-slate-400">Watts</span>
              <span className="text-[10px] font-mono text-slate-500 ml-auto">
                Avg: {analytics.avgCurrent} A
              </span>
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-400">
              Peak: {analytics.peakCurrent} A · Min: {analytics.minCurrent} A
            </div>
          </div>

          {/* 3. Depletion Gradient */}
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
              <span>Depletion Gradient</span>
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-rose-300 tabular-nums">
                {isCharging ? '+4.4%' : `-${analytics.depletionRatePctPerMin}%`}
              </span>
              <span className="text-xs font-mono text-slate-400">/ min</span>
              <span className="text-[10px] font-mono text-emerald-400 ml-auto font-semibold">
                {isCharging ? 'CHARGING' : analytics.avgPower > 300 ? 'HIGH DRAW' : 'NOMINAL'}
              </span>
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-400">
              Loss per Hour: ~{(analytics.depletionRatePctPerMin * 60).toFixed(1)}%
            </div>
          </div>

          {/* 4. Projected Autonomy (Time-to-Empty) */}
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
              <span>Projected Autonomy</span>
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono text-emerald-300 tabular-nums">
                {isCharging
                  ? '18 min'
                  : `${Math.floor(analytics.projectedRemainingMin / 60)}h ${analytics.projectedRemainingMin % 60}m`}
              </span>
              <span className="text-[10px] font-mono text-slate-500 ml-auto">
                {isCharging ? 'TO 80%' : 'TO EMPTY'}
              </span>
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-400">
              Remaining Pack: ~{Math.round((telemetry.batteryPercent / 100) * 720)} Wh
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
