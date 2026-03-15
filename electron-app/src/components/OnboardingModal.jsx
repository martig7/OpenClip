import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import api from '../api';
import {
  Status,
  StepWelcome,
  StepOBSPath,
  StepOBSInstall,
  StepOBSPlugin,
  StepOrganizeDestination,
  STEP_TITLES,
  TOTAL_STEPS,
} from './OnboardingSteps';

/* ══════════════════════════════════════════════════════════
   MAIN MODAL
══════════════════════════════════════════════════════════ */
export default function OnboardingModal({ open, onClose }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(null);
  const [obsInstallPath, setObsInstallPath] = useState('');

  // Gated step state
  const [pluginStatus, setPluginStatus] = useState(null); // null | 'checking' | 'success' | 'error'
  const [pluginInstallMsg, setPluginInstallMsg] = useState('');
  const reinstallingRef = useRef(false);

  // Load settings on open
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setPluginStatus(null);
    setPluginInstallMsg('');
    api.getStore('settings').then(s => setSettings(s ?? {})).catch(() => setSettings({}));
    api.getOBSInstallPath?.().then(p => setObsInstallPath(p || '')).catch(() => {});
  }, [open]);

  // Auto-detect OBS recording path when landing on step 1
  useEffect(() => {
    if (step !== 1) return;
    api.detectOBSPath().then(p => { if (p) updateSetting('obsRecordingPath', p); }).catch(() => {});
  }, [step]);

  // Auto-detect OBS install path when landing on step 2
  useEffect(() => {
    if (step !== 2) return;
    api.detectOBSInstallPath?.().then(p => { if (p) handleInstallPathChange(p); }).catch(() => {});
  }, [step]);

  // When landing on step 3 (plugin), auto-check if plugin is already installed.
  // Skipped when the user has explicitly clicked Reinstall (reinstallingRef = true).
  useEffect(() => {
    if (step !== 3 || pluginStatus) return;
    if (reinstallingRef.current) return;
    api.isOBSPluginRegistered?.().then(installed => {
      if (installed) setPluginStatus('success');
    }).catch(() => {});
  }, [step, pluginStatus]);

  const updateSetting = useCallback((path, value) => {
    setSettings(prev => {
      const keys = path.split('.');
      const updated = { ...prev };
      let obj = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return updated;
    });
  }, []);

  function handleInstallPathChange(p) {
    setObsInstallPath(p);
    api.setOBSInstallPath?.(p).catch(() => {});
  }

  // Whether Next is enabled for the current step
  function canAdvance() {
    if (step === 1) return !!(settings?.obsRecordingPath?.trim());
    if (step === 2) return !!(obsInstallPath?.trim());
    if (step === 3) return pluginStatus === 'success';
    if (step === 4) return !!(settings?.destinationPath?.trim());
    return true;
  }

  async function handleInstallPlugin() {
    setPluginStatus('checking');
    setPluginInstallMsg('');
    const result = await api.installOBSPlugin?.(obsInstallPath).catch(err => ({ success: false, message: err.message }));
    if (result?.success) {
      setPluginStatus('success');
    } else {
      setPluginStatus('error');
      setPluginInstallMsg(result?.message || 'Installation failed');
    }
    reinstallingRef.current = false;
  }

  async function handleVerifyPlugin() {
    setPluginStatus('checking');
    const installed = await api.isOBSPluginRegistered?.().catch(() => false);
    if (installed) {
      setPluginStatus('success');
      setPluginInstallMsg('');
    } else {
      setPluginStatus('error');
      setPluginInstallMsg('Plugin not found — click Install Plugin to try again');
    }
  }

  async function finishOrSkip(saveSettings = true) {
    if (saveSettings && settings) {
      await api.setStore('settings', settings).catch(() => {});
      await api.registerHotkey().catch(() => {});
    }
    await api.setOnboardingComplete(true).catch(() => {});
    onClose();
  }

  function goNext() {
    if (step < TOTAL_STEPS - 1) setStep(s => s + 1);
    else finishOrSkip(true);
  }

  if (!open || !settings) return null;

  const isLast = step === TOTAL_STEPS - 1;
  const nextDisabled = !canAdvance();

  // Tooltip for gated steps
  const gateHint = nextDisabled ? (
    step === 1 ? 'Enter or detect your OBS recording folder to continue' :
    step === 2 ? 'Enter or detect your OBS install location to continue' :
    step === 3 ? 'Click Install Plugin to install the OBS plugin' :
    step === 4 ? 'Choose a destination folder to continue' : undefined
  ) : undefined;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        {/* Header */}
        <div className="onboarding-header">
          <div className="onboarding-header-left">
            <h2>Setup Wizard</h2>
            <span>Step {step + 1} of {TOTAL_STEPS} — {STEP_TITLES[step]}</span>
          </div>
        </div>

        {/* Progress dots */}
        <div className="onboarding-progress">
          {STEP_TITLES.map((_, i) => (
            <div
              key={i}
              className={`onboarding-dot ${i === step ? 'active' : i < step ? 'done' : ''}`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="onboarding-body">
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepOBSPath settings={settings} onChange={updateSetting} />}
          {step === 2 && (
            <StepOBSInstall
              obsInstallPath={obsInstallPath}
              onChangeInstallPath={handleInstallPathChange}
            />
          )}
          {step === 3 && (
            <StepOBSPlugin
              pluginStatus={pluginStatus}
              pluginInstallMsg={pluginInstallMsg}
              onInstall={handleInstallPlugin}
              onReinstall={() => { reinstallingRef.current = true; handleInstallPlugin(); }}
              onVerify={handleVerifyPlugin}
            />
          )}
          {step === 4 && <StepOrganizeDestination settings={settings} onChange={updateSetting} />}
          <div className="onboarding-footer">
            <div className="onboarding-footer-right">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setStep(s => s - 1)}
                disabled={step === 0}
                style={{ opacity: step === 0 ? 0.4 : 1 }}
              >
                <ChevronLeft size={14} /> Back
              </button>
              
              <button
                className="btn btn-primary btn-sm"
                onClick={goNext}
                disabled={nextDisabled}
                style={{ opacity: nextDisabled ? 0.4 : 1 }}
                title={gateHint}
              >
                {isLast ? 'Finish' : 'Next'} {!isLast && <ChevronRight size={14} />}
              </button>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => finishOrSkip(false)}
              style={{ color: 'var(--text-muted)', fontSize: 12 }}
            >
              Skip setup
            </button>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
