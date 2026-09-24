import React, { useState, useEffect, useRef } from 'react';
import { DiagnosticEvent, EventSeverity } from '../types/robotics';
import { audioSynth } from '../utils/audioSynthesizer';
import {
  AlertTriangle,
  AlertOctagon,
  Info,
  Activity,
  Terminal,
  Filter,
  Search,
  Trash2,
  Download,
  Flame,
  BatteryLow,
  WifiOff,
  CheckCircle2,
  Play,
  Pause,
} from 'lucide-react';

interface DiagnosticEventLogPanelProps {
  events: DiagnosticEvent[];
  onClearEvents: () => void;
  onInjectEvent: (event: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'>) => void;
  audioEnabled: boolean;
}

export const DiagnosticEventLogPanel: React.FC<DiagnosticEventLogPanelProps> = ({
  events,
  onClearEvents,
  onInjectEvent,
  audioEnabled,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [filterSubsystem, setFilterSubsystem] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLiveAutoScroll, setIsLiveAutoScroll] = useState<boolean>(true);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll when new events arrive if live stream is active
  useEffect(() => {
    if (isLiveAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [events, isLiveAutoScroll]);

  // Filtered Events
  const filteredEvents = events.filter((ev) => {
    if (filterSeverity !== 'ALL' && ev.severity.toUpperCase() !== filterSeverity) return false;
    if (filterSubsystem !== 'ALL' && ev.subsystem !== filterSubsystem) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchMsg = ev.message.toLowerCase().includes(q);
      const matchCode = ev.code.toLowerCase().includes(q);
      const matchSub = ev.subsystem.toLowerCase().includes(q);
      if (!matchMsg && !matchCode && !matchSub) return false;
    }
    return true;
  });

  const criticalCount = events.filter((e) => e.severity === 'critical').length;
  const warningCount = events.filter((e) => e.severity === 'warning').length;
  const infoCount = events.filter((e) => e.severity === 'info').length;

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(events, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `cerberus04-diagnostics-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Helper trigger injections
  const triggerCanJitter = () => {
    onInjectEvent({
      severity: 'warning',
      subsystem: 'CAN-FD',
      code: 'CAN_ERR_JITTER_EXCEEDED',
      message: 'Frame propagation latency spike detected on Node 0x32 (FR Hip). Measured 3.42ms (threshold < 1.00ms). Cyclic retry recovered packet.',
      metric: 'Latency: 3.42ms | Drops: 0',
    });
    if (audioEnabled) audioSynth.playAlert(true);
  };

  const triggerThermalSpike = () => {
    onInjectEvent({
      severity: 'critical',
      subsystem: 'THERMAL',
      code: 'MTR_TEMP_SPIKE_CRIT',
      message: 'Actuator FL-KNEE core thermistor breached safety threshold: 46.8°C (limit 44.0°C). Autonomous current throttling engaged (-20%).',
      metric: 'FL-Knee: 46.8°C | Derate: -20%',
    });
    if (audioEnabled) audioSynth.playAlert(true);
  };

  const triggerBatteryDip = () => {
    onInjectEvent({
      severity: 'warning',
      subsystem: 'BMS-48V',
      code: 'BMS_LOW_PACK_CAPACITY',
      message: 'Battery state-of-charge dropped to reserve limit (18%). Cell #04 voltage delta +28mV during peak load. Homing recommended.',
      metric: 'SOC: 18% | Cell Delta: 28mV',
    });
    if (audioEnabled) audioSynth.playAlert(true);
  };

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-5 shadow-xl space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800/80 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-cyan-950/60 border border-cyan-700/60 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
                Real-Time Diagnostic Event Log
              </h3>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span>Telemetry Ring Buffer</span>
              <span aria-hidden="true">·</span>
              <span>CAN-FD & BMS Sentinel</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 font-semibold">{events.length} Events Logged</span>
            </div>
          </div>
        </div>

        {/* Status Counters */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="px-2.5 py-1 rounded bg-rose-950/60 border border-rose-800/80 text-rose-300 flex items-center gap-1.5 font-bold">
            <AlertOctagon className="w-3 h-3 text-rose-400" />
            {criticalCount} CRIT
          </span>
          <span className="px-2.5 py-1 rounded bg-amber-950/60 border border-amber-800/80 text-amber-300 flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            {warningCount} WARN
          </span>
          <span className="px-2.5 py-1 rounded bg-cyan-950/60 border border-cyan-800/80 text-cyan-300 flex items-center gap-1.5">
            <Info className="w-3 h-3 text-cyan-400" />
            {infoCount} INFO
          </span>
        </div>
      </div>

      {/* Interactive Anomaly Simulation & Filter Bar */}
      <div className="bg-[#050811] p-3 rounded-lg border border-slate-800/80 space-y-3">
        {/* Test Injection Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Simulate Fault Injections:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={triggerCanJitter}
              className="px-2.5 py-1 rounded bg-amber-950/40 hover:bg-amber-900/50 border border-amber-700/60 text-[11px] font-mono text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <WifiOff className="w-3 h-3 text-amber-400" />
              <span>+ CAN-Bus Jitter</span>
            </button>

            <button
              onClick={triggerThermalSpike}
              className="px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/50 border border-rose-700/60 text-[11px] font-mono text-rose-300 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Flame className="w-3 h-3 text-rose-400" />
              <span>+ Motor Temp Spike</span>
            </button>

            <button
              onClick={triggerBatteryDip}
              className="px-2.5 py-1 rounded bg-amber-950/40 hover:bg-amber-900/50 border border-amber-700/60 text-[11px] font-mono text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <BatteryLow className="w-3 h-3 text-amber-400" />
              <span>+ Low Battery Warning</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search error code or text..."
                className="pl-7 pr-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 w-44 sm:w-56"
              />
            </div>

            {/* Severity Filter Dropdown */}
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">Severity: ALL</option>
              <option value="CRITICAL">CRITICAL ONLY</option>
              <option value="WARNING">WARNING ONLY</option>
              <option value="INFO">INFO ONLY</option>
            </select>

            {/* Subsystem Filter Dropdown */}
            <select
              value={filterSubsystem}
              onChange={(e) => setFilterSubsystem(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">Subsystem: ALL</option>
              <option value="CAN-FD">CAN-FD Bus</option>
              <option value="BMS-48V">48V Battery BMS</option>
              <option value="THERMAL">Thermal Sentinel</option>
              <option value="ACTUATORS">Actuators</option>
              <option value="IMU-400Hz">IMU Sensor</option>
              <option value="LIDAR-SLAM">LiDAR SLAM</option>
              <option value="VLA-CORE">VLA Core</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {/* Live Auto Scroll Toggle */}
            <button
              onClick={() => setIsLiveAutoScroll(!isLiveAutoScroll)}
              className={`px-2 py-1 rounded text-xs font-mono flex items-center gap-1 cursor-pointer transition-colors border ${
                isLiveAutoScroll
                  ? 'bg-cyan-950/60 border-cyan-600 text-cyan-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
              title="Toggle Live Stream Auto-Scroll"
            >
              {isLiveAutoScroll ? <Play className="w-3 h-3 text-cyan-400" /> : <Pause className="w-3 h-3" />}
              <span>{isLiveAutoScroll ? 'LIVE' : 'PAUSED'}</span>
            </button>

            {/* Export Button */}
            <button
              onClick={handleExportJSON}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-1 cursor-pointer transition-colors"
              title="Export Events JSON"
            >
              <Download className="w-3 h-3 text-slate-400" />
              <span>EXPORT</span>
            </button>

            {/* Clear Button */}
            <button
              onClick={onClearEvents}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-rose-950/40 hover:text-rose-300 border border-slate-800 hover:border-rose-800/80 text-xs font-mono text-slate-400 flex items-center gap-1 cursor-pointer transition-colors"
              title="Clear Event Log"
            >
              <Trash2 className="w-3 h-3" />
              <span>CLEAR</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Events Feed Window */}
      <div
        ref={logContainerRef}
        className="h-64 sm:h-72 overflow-y-auto rounded-lg border border-slate-800/90 bg-[#04060d] p-3 space-y-2 font-mono text-xs select-text scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent"
      >
        {filteredEvents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs space-y-1">
            <CheckCircle2 className="w-6 h-6 text-slate-600 mb-1" />
            <span>No events found matching current criteria</span>
            <span className="text-[10px] text-slate-600">
              Try changing the filter or trigger a simulated event above
            </span>
          </div>
        ) : (
          filteredEvents.map((ev) => {
            const isCrit = ev.severity === 'critical';
            const isWarn = ev.severity === 'warning';

            return (
              <div
                key={ev.id}
                className={`p-2.5 rounded border transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-2 ${
                  isCrit
                    ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
                    : isWarn
                    ? 'bg-amber-950/30 border-amber-800/80 text-amber-200'
                    : 'bg-slate-950/60 border-slate-800/80 text-slate-300'
                }`}
              >
                <div className="space-y-1 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Timestamp */}
                    <span className="text-[10px] text-slate-500 font-mono">
                      [{ev.timestamp}]
                    </span>

                    {/* Severity Badge */}
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                        isCrit
                          ? 'bg-rose-900 text-rose-100'
                          : isWarn
                          ? 'bg-amber-900 text-amber-100'
                          : 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                      }`}
                    >
                      {ev.severity}
                    </span>

                    {/* Subsystem Badge */}
                    <span className="text-[10px] font-semibold text-slate-400 bg-slate-900 px-1.5 py-0.2 rounded border border-slate-800">
                      {ev.subsystem}
                    </span>

                    {/* Error Code */}
                    <span className="text-[10px] font-mono text-cyan-400 font-bold">
                      {ev.code}
                    </span>
                  </div>

                  {/* Message */}
                  <div className="text-xs leading-relaxed text-slate-200 pl-1">
                    {ev.message}
                  </div>
                </div>

                {/* Metric Readout if provided */}
                {ev.metric && (
                  <div className="sm:self-center shrink-0 px-2 py-1 rounded bg-black/40 border border-slate-800 text-[10px] font-mono text-cyan-300">
                    {ev.metric}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
        <span>Sentinel Monitor: CAN 1.0kHz · BMS 50Hz · IMU 400Hz</span>
        <span>Buffer limit: 200 FIFO records</span>
      </div>
    </div>
  );
};
