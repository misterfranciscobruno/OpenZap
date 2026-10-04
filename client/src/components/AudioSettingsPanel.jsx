import { useCallback, useEffect, useState } from 'react';
import { IoVolumeHigh, IoMic, IoHeadset } from 'react-icons/io5';
import {
  applyOutputSinkId,
  ensureAudioPermission,
  listAudioDevices,
} from '../utils/audioPreferences';

/**
 * Painel de configuração de áudio (perfil + chamada).
 * @param {{
 *   prefs: {
 *     inputDeviceId: string,
 *     outputDeviceId: string,
 *     inputVolume: number,
 *     outputVolume: number,
 *     echoCancellation: boolean,
 *     noiseSuppression: boolean,
 *     autoGainControl: boolean,
 *   },
 *   onChange: (partial: object) => void | Promise<void>,
 *   compact?: boolean,
 *   busy?: boolean,
 * }} props
 */
export default function AudioSettingsPanel({ prefs, onChange, compact = false, busy = false }) {
  const [inputs, setInputs] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [permHint, setPermHint] = useState('');
  const [listing, setListing] = useState(false);
  const sinkSupported =
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function';

  const refreshDevices = useCallback(async () => {
    setListing(true);
    try {
      const { inputs: ins, outputs: outs } = await listAudioDevices();
      setInputs(ins);
      setOutputs(outs);
      const unlabeled = ins.some((d) => !d.label) || outs.some((d) => !d.label);
      if (unlabeled) {
        setPermHint('Autorize o microfone para ver os nomes dos dispositivos.');
      } else {
        setPermHint('');
      }
    } catch {
      setPermHint('Não foi possível listar os dispositivos de áudio.');
    } finally {
      setListing(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return undefined;
    const onChangeDev = () => void refreshDevices();
    md.addEventListener('devicechange', onChangeDev);
    return () => md.removeEventListener('devicechange', onChangeDev);
  }, [refreshDevices]);

  const requestPermission = async () => {
    setPermHint('');
    try {
      await ensureAudioPermission();
      await refreshDevices();
    } catch {
      setPermHint('Permissão de microfone negada ou indisponível neste navegador.');
    }
  };

  const patch = (partial) => {
    void onChange?.(partial);
  };

  const labelCls = compact
    ? 'text-[11px] font-medium text-whatsapp-text-secondary'
    : 'text-xs text-whatsapp-text-secondary';
  const selectCls =
    'w-full rounded-lg border border-whatsapp-border bg-whatsapp-input px-3 py-2 text-sm text-whatsapp-text outline-none focus:border-whatsapp-green/60 disabled:opacity-50';
  const rangeCls = 'w-full accent-whatsapp-green disabled:opacity-50';

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {permHint ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-[12px] text-amber-200/95 leading-relaxed">{permHint}</p>
          <button
            type="button"
            onClick={() => void requestPermission()}
            className="mt-2 text-[12px] font-semibold text-whatsapp-green hover:underline"
          >
            Autorizar microfone
          </button>
        </div>
      ) : null}

      <div>
        <p className={`${labelCls} mb-1.5 flex items-center gap-1.5`}>
          <IoMic className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Microfone
        </p>
        <select
          className={selectCls}
          disabled={busy || listing}
          value={prefs.inputDeviceId || ''}
          onChange={(e) => patch({ inputDeviceId: e.target.value })}
        >
          <option value="">Padrão do sistema</option>
          {inputs.map((d, i) => (
            <option key={d.deviceId || `in-${i}`} value={d.deviceId}>
              {d.label || `Microfone ${i + 1}`}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className={`${labelCls} mb-1.5 flex items-center gap-1.5`}>
          <IoHeadset className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Saída de áudio
        </p>
        <select
          className={selectCls}
          disabled={busy || listing || !sinkSupported}
          value={prefs.outputDeviceId || ''}
          onChange={(e) => {
            const id = e.target.value;
            patch({ outputDeviceId: id });
            // Pré-aplica em um audio silencioso ajuda alguns browsers a “lembrar” o sink.
            try {
              const a = new Audio();
              void applyOutputSinkId(a, id);
            } catch {
              /* ignore */
            }
          }}
        >
          <option value="">Padrão do sistema</option>
          {outputs.map((d, i) => (
            <option key={d.deviceId || `out-${i}`} value={d.deviceId}>
              {d.label || `Saída ${i + 1}`}
            </option>
          ))}
        </select>
        {!sinkSupported ? (
          <p className="mt-1 text-[11px] text-whatsapp-text-secondary">
            Este navegador não permite escolher a saída de áudio (use Chrome ou Edge no computador).
          </p>
        ) : null}
      </div>

      <div>
        <p className={`${labelCls} mb-1.5 flex items-center justify-between gap-2`}>
          <span className="inline-flex items-center gap-1.5">
            <IoMic className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Volume de entrada
          </span>
          <span className="tabular-nums text-whatsapp-text">{Math.round(prefs.inputVolume * 100)}%</span>
        </p>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          className={rangeCls}
          disabled={busy}
          value={Math.round(prefs.inputVolume * 100)}
          onChange={(e) => patch({ inputVolume: Number(e.target.value) / 100 })}
          aria-label="Volume de entrada"
        />
      </div>

      <div>
        <p className={`${labelCls} mb-1.5 flex items-center justify-between gap-2`}>
          <span className="inline-flex items-center gap-1.5">
            <IoVolumeHigh className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Volume de saída
          </span>
          <span className="tabular-nums text-whatsapp-text">{Math.round(prefs.outputVolume * 100)}%</span>
        </p>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          className={rangeCls}
          disabled={busy}
          value={Math.round(prefs.outputVolume * 100)}
          onChange={(e) => patch({ outputVolume: Number(e.target.value) / 100 })}
          aria-label="Volume de saída"
        />
      </div>

      <div className="space-y-2 rounded-xl border border-whatsapp-border/40 bg-whatsapp-input/30 p-3">
        <p className={`${labelCls} mb-1`}>Processamento do microfone</p>
        {[
          { key: 'echoCancellation', label: 'Cancelamento de eco' },
          { key: 'noiseSuppression', label: 'Supressão de ruído' },
          { key: 'autoGainControl', label: 'Controle automático de ganho' },
        ].map((opt) => (
          <label
            key={opt.key}
            className="flex cursor-pointer items-center justify-between gap-3 text-[13px] text-whatsapp-text"
          >
            <span>{opt.label}</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-whatsapp-green"
              disabled={busy}
              checked={prefs[opt.key] !== false}
              onChange={(e) => patch({ [opt.key]: e.target.checked })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
