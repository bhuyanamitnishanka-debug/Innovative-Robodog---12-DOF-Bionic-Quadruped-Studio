import React from 'react';
import { Volume2, VolumeX, AlertTriangle, ShieldCheck, Sparkles, Heart } from 'lucide-react';

interface NavigationHeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  audioEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => void;
  emergencyStop: boolean;
  toggleEmergencyStop: () => void;
}

export const NavigationHeader: React.FC<NavigationHeaderProps> = ({
  activeTab,
  setActiveTab,
  audioEnabled,
  setAudioEnabled,
  emergencyStop,
  toggleEmergencyStop,
}) => {
  const navItems = [
    { id: 'simulator', label: 'Simulator' },
    { id: 'diagnostics', label: 'Event Log' },
    { id: 'theater', label: 'Video Theater' },
    { id: 'companion', label: 'Companion Lab' },
    { id: 'blueprints', label: 'Blueprints' },
    { id: 'kinematics', label: 'Kinematics' },
    { id: 'electrical', label: 'Power & BMS' },
    { id: 'mcu', label: 'Core MCU' },
    { id: 'vla', label: 'Gemini VLA' },
    { id: 'guide', label: 'Engagement Guide' },
  ];

  return (
    <header className="h-16 px-4 sm:px-6 bg-[#080d1a] border-b border-slate-800/80 flex items-center justify-between sticky top-0 z-50 select-none">
      {/* Zone 1: Single text element wordmark */}
      <div className="flex items-center gap-2">
        <span className="font-['Chakra_Petch'] text-base sm:text-lg font-bold tracking-wider text-slate-100 flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 bg-cyan-400 rounded-xs animate-pulse"></span>
          CERBERUS-04 ALPHA
        </span>
      </div>

      {/* Zone 2: Clean navigation links */}
      <nav className="hidden xl:flex items-center gap-5 text-xs font-medium">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`transition-colors relative py-1 cursor-pointer whitespace-nowrap ${
                isActive ? 'text-cyan-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Dropdown for intermediate viewports */}
      <div className="xl:hidden flex items-center">
        <select
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value)}
          className="bg-slate-900 border border-slate-800 text-cyan-300 text-xs font-mono rounded px-2.5 py-1.5 focus:outline-none"
        >
          {navItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {/* Zone 3: Primary actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => setAudioEnabled(!audioEnabled)}
          title={audioEnabled ? 'Mute Telemetry Audio' : 'Enable Telemetry Audio'}
          className={`px-2.5 sm:px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer border ${
            audioEnabled
              ? 'bg-cyan-950/50 text-cyan-300 border-cyan-700/60 hover:bg-cyan-900/60'
              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
          }`}
        >
          {audioEnabled ? <Volume2 className="w-3.5 h-3.5 text-cyan-400" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{audioEnabled ? 'AUDIO ON' : 'AUDIO OFF'}</span>
        </button>

        <button
          onClick={toggleEmergencyStop}
          className={`px-2.5 sm:px-3.5 py-1.5 rounded text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border ${
            emergencyStop
              ? 'bg-rose-950/80 text-rose-200 border-rose-600 animate-pulse'
              : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-600/70 hover:text-amber-300'
          }`}
        >
          {emergencyStop ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">LOCKED (E-STOP)</span>
              <span className="sm:hidden">E-STOP</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">ARMED</span>
              <span className="sm:hidden">ARMED</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};
