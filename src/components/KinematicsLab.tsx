import React from 'react';
import { TelemetryState } from '../types/robotics';
import { Activity, Gauge, Thermometer, ShieldAlert } from 'lucide-react';
import { PayloadStabilityWidget } from './PayloadStabilityWidget';

interface KinematicsLabProps {
  telemetry: TelemetryState;
  updateTelemetry: (partial: Partial<TelemetryState>) => void;
}

export const KinematicsLab: React.FC<KinematicsLabProps> = ({
  telemetry,
  updateTelemetry,
}) => {
  const limbs = [
    { key: 'fl', name: 'Front-Left (FL)', pos: 'Forward Port' },
    { key: 'fr', name: 'Front-Right (FR)', pos: 'Forward Starboard' },
    { key: 'rl', name: 'Rear-Left (RL)', pos: 'Aft Port' },
    { key: 'rr', name: 'Rear-Right (RR)', pos: 'Aft Starboard' },
  ];

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-6 shadow-xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1">
            Quadruped Kinematics & Strain Gauges
          </div>
          <h2 className="font-['Chakra_Petch'] text-2xl font-bold text-slate-100">
            12-DOF ACTUATOR TELEMETRY & INVERSE KINEMATICS
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1">
            <span>Coreless Motor Planetary Gearboxes</span>
            <span aria-hidden="true">·</span>
            <span>Strain Gauge Torque Sensors</span>
            <span aria-hidden="true">·</span>
            <span>1kHz Closed Feedback Loop</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs font-mono">
            <span className="text-slate-400">Total Output: </span>
            <span className="text-cyan-300 font-bold tabular-nums">
              {(18.4 + Math.abs(telemetry.linearVelocity) * 14.2).toFixed(1)} N·m
            </span>
          </div>
          <div className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs font-mono">
            <span className="text-slate-400">Avg Temp: </span>
            <span className="text-emerald-400 font-bold tabular-nums">38.2°C</span>
          </div>
        </div>
      </div>

      {/* 4 Limbs Grid (FL, FR, RL, RR) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {limbs.map((limb) => {
          const leg = (telemetry.legs as any)?.[limb.key] || {
            hipAbduction: 0,
            hipPitch: 25,
            kneePitch: 48,
            torque: 14.2,
            temperature: 38.0,
          };

          return (
            <div
              key={limb.key}
              className="bg-[#050811] rounded-lg border border-slate-800/80 p-4 flex flex-col justify-between space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
                <div>
                  <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-200">
                    {limb.name}
                  </h4>
                  <div className="text-[10px] text-slate-500 font-mono">{limb.pos}</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
              </div>

              {/* 3 DOF Joints */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs font-mono mb-1">
                    <span className="text-slate-400">J1: Hip Abduction</span>
                    <span className="text-cyan-300 font-bold tabular-nums">{leg.hipAbduction}°</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${Math.min(100, Math.max(10, leg.hipAbduction + 50))}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-mono mb-1">
                    <span className="text-slate-400">J2: Hip Pitch</span>
                    <span className="text-cyan-300 font-bold tabular-nums">{leg.hipPitch}°</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${Math.min(100, Math.max(10, (leg.hipPitch / 90) * 100))}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-mono mb-1">
                    <span className="text-slate-400">J3: Knee Pitch</span>
                    <span className="text-cyan-300 font-bold tabular-nums">{leg.kneePitch}°</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${Math.min(100, Math.max(10, (leg.kneePitch / 140) * 100))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Strain Gauge & Temp */}
              <div className="pt-3 border-t border-slate-800/60 grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2 rounded bg-slate-950 border border-slate-900">
                  <div className="text-slate-500 text-[9px] uppercase">Torque Load</div>
                  <div className="text-amber-300 font-semibold tabular-nums mt-0.5">
                    {leg.torque.toFixed(1)} N·m
                  </div>
                </div>
                <div className="p-2 rounded bg-slate-950 border border-slate-900">
                  <div className="text-slate-500 text-[9px] uppercase">Thermistor</div>
                  <div className="text-emerald-400 font-semibold tabular-nums mt-0.5">
                    {leg.temperature.toFixed(1)}°C
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* PAYLOAD DYNAMICS & CENTER OF MASS STABILITY WIDGET */}
      <PayloadStabilityWidget telemetry={telemetry} updateTelemetry={updateTelemetry} />

      {/* Kinematics Formula & Diagram Notes (Directly aligned with video presentation) */}
      <div className="p-4 bg-[#050811] rounded-lg border border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div>
          <div className="font-['Chakra_Petch'] font-bold text-slate-200 uppercase mb-1">
            01. Planetary Reduction
          </div>
          <p className="text-slate-400 leading-relaxed">
            Ultra-compact 1:9 planetary gearboxes deliver rapid angular acceleration and exceptional torque-to-weight ratio for athletic leaping and compliant contact.
          </p>
        </div>
        <div>
          <div className="font-['Chakra_Petch'] font-bold text-slate-200 uppercase mb-1">
            02. Strain Gauge Telemetry
          </div>
          <p className="text-slate-400 leading-relaxed">
            Integrated multi-axis strain gauges in each joint hub calculate ground reaction forces at 400Hz, enabling dynamic foot compliance over uneven terrain.
          </p>
        </div>
        <div>
          <div className="font-['Chakra_Petch'] font-bold text-slate-200 uppercase mb-1">
            03. Co-axial Joint Wiring
          </div>
          <p className="text-slate-400 leading-relaxed">
            High-flex shielded silicone cables routed directly through hollow articulating pivot joints to prevent cable fatigue and eliminate external wire snagging.
          </p>
        </div>
      </div>
    </div>
  );
};
