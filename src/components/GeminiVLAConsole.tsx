import React, { useState } from 'react';
import { TelemetryState, VLAResponse, GaitType } from '../types/robotics';
import { Sparkles, Send, ShieldAlert, Cpu, Terminal, Compass, CheckCircle2, ArrowRight } from 'lucide-react';

interface GeminiVLAConsoleProps {
  telemetry: TelemetryState;
  updateTelemetry: (partial: Partial<TelemetryState>) => void;
}

export const GeminiVLAConsole: React.FC<GeminiVLAConsoleProps> = ({
  telemetry,
  updateTelemetry,
}) => {
  const [inputCommand, setInputCommand] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [vlaResult, setVlaResult] = useState<VLAResponse | null>({
    missionSummary:
      'Autonomous system standing by. Gemini Embedded Vision-Language-Action (VLA) engine ready for operational dispatch.',
    recommendedGait: telemetry.gait,
    targetVelocity: {
      linearX: telemetry.linearVelocity,
      angularZ: telemetry.angularVelocity,
      stanceHeight: telemetry.stanceHeight,
    },
    spatialAssessment:
      'Research laboratory perimeter verified. Dual-depth LiDAR scanning nominal at 25m envelope with 400Hz sensor fusion confidence.',
    tacticalActions: [
      'Initialize 400Hz LiDAR & IMU sensor pipeline',
      'Verify CAN-FD actuator telemetry at 1kHz',
      'Maintain adaptive compliance on all 12 joints',
    ],
    jointTorqueBias: 'compliant',
    safetyLockout: false,
  });

  const presetCommands = [
    { label: 'Obstacle Crawl', cmd: 'Engage low-clearance crawl mode to navigate under low barrier' },
    { label: 'Sprint Sprint', cmd: 'Execute high-velocity gallop sprint across open laboratory floor' },
    { label: 'Perimeter Scan', cmd: 'Sweep 360° LiDAR point-cloud and map perimeter obstacles' },
    { label: 'Auto-Dock Base', cmd: 'Navigate to charging station and engage 80A magnetic docking' },
    { label: 'Dynamic Bound', cmd: 'Prepare bound gait to clear 25cm terrain elevation hurdle' },
  ];

  const handleSubmit = async (commandToRun?: string) => {
    const cmd = commandToRun || inputCommand;
    if (!cmd.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/gemini/vla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: cmd,
          telemetry: {
            voltage: 48.24,
            batteryPercent: telemetry.batteryPercent,
            gait: telemetry.gait,
            velocity: telemetry.linearVelocity,
            heading: telemetry.heading,
            pitch: telemetry.bodyPitch,
            roll: telemetry.bodyRoll,
            nearestObstacleDist: '2.4m at 15° north-east',
          },
          environment: 'Robotics testing facility with concrete surface and docking beacon in range',
        }),
      });

      const data: VLAResponse = await res.json();
      setVlaResult(data);

      // Apply tactical directives to live simulator
      if (data.recommendedGait) {
        updateTelemetry({
          gait: data.recommendedGait,
          linearVelocity: data.targetVelocity?.linearX ?? telemetry.linearVelocity,
          angularVelocity: data.targetVelocity?.angularZ ?? telemetry.angularVelocity,
          stanceHeight: data.targetVelocity?.stanceHeight ?? telemetry.stanceHeight,
          controlMode: 'autonomous_vla',
          emergencyStop: data.safetyLockout,
        });
      }
    } catch (e) {
      console.error('VLA dispatch error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-6 shadow-xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Autonomous Intelligence & Cognitive Robotics</span>
          </div>
          <h2 className="font-['Chakra_Petch'] text-2xl font-bold text-slate-100">
            GEMINI EMBEDDED VISION (VLA) TASK PLANNER
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1">
            <span>Vision-Language-Action Pipeline</span>
            <span aria-hidden="true">·</span>
            <span>TensorRT-Edge Acceleration</span>
            <span aria-hidden="true">·</span>
            <span>400Hz Adaptive Kinematics</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>ONBOARD INFERENCE: INT8 QUANTIZED</span>
        </div>
      </div>

      {/* Preset Command Chips */}
      <div>
        <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
          Tactical Mission Presets:
        </span>
        <div className="flex flex-wrap gap-2">
          {presetCommands.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => {
                setInputCommand(preset.cmd);
                handleSubmit(preset.cmd);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-cyan-950/60 border border-slate-800 hover:border-cyan-600/70 text-xs font-mono text-slate-300 hover:text-cyan-200 cursor-pointer transition-colors flex items-center gap-1.5"
            >
              <span>{preset.label}</span>
              <ArrowRight className="w-3 h-3 text-cyan-400" />
            </button>
          ))}
        </div>
      </div>

      {/* Mission Input Field */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <input
            type="text"
            value={inputCommand}
            onChange={(e) => setInputCommand(e.target.value)}
            placeholder="Issue natural language tactical command (e.g. 'Crawl slowly under low obstacle and hold position')..."
            className="w-full bg-[#050812] border border-slate-800 rounded-lg px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 font-mono focus:outline-none focus:border-cyan-500/80 transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !inputCommand.trim()}
          className="px-5 py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold text-xs font-mono flex items-center gap-2 cursor-pointer transition-colors shadow-[0_0_15px_rgba(6,182,212,0.3)]"
        >
          {isLoading ? (
            <span>COMPUTING...</span>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>DISPATCH VLA</span>
            </>
          )}
        </button>
      </form>

      {/* VLA AI Output Telemetry Board */}
      {vlaResult && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2">
          {/* Mission & Spatial Assessment */}
          <div className="lg:col-span-8 bg-[#050811] rounded-lg border border-slate-800/80 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
                VLA Executive Decision
              </span>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-slate-400">Selected Gait:</span>
                <span className="text-cyan-300 font-bold px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800">
                  {vlaResult.recommendedGait.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded bg-slate-950/80 border border-slate-800/80 text-sm text-slate-200 leading-relaxed font-sans">
              {vlaResult.missionSummary}
            </div>

            <div>
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-1.5">
                Spatial Perception & LiDAR Assessment:
              </span>
              <p className="text-xs text-slate-400 leading-relaxed font-mono bg-slate-950/40 p-3 rounded border border-slate-900">
                {vlaResult.spatialAssessment}
              </p>
            </div>

            {/* Tactical Actions List */}
            <div>
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                Kinematic Execution Pipeline:
              </span>
              <div className="space-y-1.5">
                {vlaResult.tacticalActions.map((action, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 text-xs font-mono text-slate-300 p-2 rounded bg-slate-950 border border-slate-900"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Motor Vectors & Safety Panel */}
          <div className="lg:col-span-4 bg-[#050811] rounded-lg border border-slate-800/80 p-5 flex flex-col justify-between space-y-4">
            <div>
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-3">
                Calculated Actuator Directives
              </span>

              <div className="space-y-3 text-xs font-mono">
                <div className="p-2.5 rounded bg-slate-950 border border-slate-900 flex justify-between">
                  <span className="text-slate-400">Target Linear Velocity</span>
                  <span className="text-cyan-300 font-bold tabular-nums">
                    {vlaResult.targetVelocity.linearX.toFixed(2)} m/s
                  </span>
                </div>

                <div className="p-2.5 rounded bg-slate-950 border border-slate-900 flex justify-between">
                  <span className="text-slate-400">Yaw Rate (Angular Z)</span>
                  <span className="text-cyan-300 font-bold tabular-nums">
                    {vlaResult.targetVelocity.angularZ.toFixed(2)} rad/s
                  </span>
                </div>

                <div className="p-2.5 rounded bg-slate-950 border border-slate-900 flex justify-between">
                  <span className="text-slate-400">Stance Ground Clearance</span>
                  <span className="text-cyan-300 font-bold tabular-nums">
                    {vlaResult.targetVelocity.stanceHeight} mm
                  </span>
                </div>

                <div className="p-2.5 rounded bg-slate-950 border border-slate-900 flex justify-between">
                  <span className="text-slate-400">Joint Torque Profile</span>
                  <span className="text-amber-300 font-bold uppercase">
                    {vlaResult.jointTorqueBias}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Safety State:</span>
                <span className={vlaResult.safetyLockout ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                  {vlaResult.safetyLockout ? 'OVERRIDE ENGAGED' : 'CLEAR (AUTO-APPLIED)'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-1">
                Directives dispatched to BARK-CORE v3.1 via dual CAN-FD at 1.0 kHz.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
