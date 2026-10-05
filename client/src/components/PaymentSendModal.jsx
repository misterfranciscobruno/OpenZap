import { useState, useEffect, useCallback } from 'react';
import { IoClose } from 'react-icons/io5';
import { BrowserProvider } from 'ethers';
import { getEthereumProvider } from '../utils/ethereumProvider';
import {
  buildPaymentMessagePayload,
  nativeSymbolForChain,
  sendNativeCryptoPayment,
  paymentSendErrorMessagePt,
} from '../utils/cryptoPayments';
import { formatAddress } from './MessageBubble';

export default function PaymentSendModal({ open, onClose, recipientAddress, onPaymentComplete }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [chainLabel, setChainLabel] = useState('');

  useEffect(() => {
    if (!open) {
      setAmount('');
      setBusy(false);
      setError(null);
      setChainLabel('');
      return;
    }
    let cancelled = false;
    (async () => {
      const eth = getEthereumProvider();
      if (!eth || cancelled) return;
      try {
        const provider = new BrowserProvider(eth);
        const net = await provider.getNetwork();
        if (cancelled) return;
        const sym = nativeSymbolForChain(Number(net.chainId));
        setChainLabel(`Rede ${Number(net.chainId)} · ${sym}`);
      } catch {
        if (!cancelled) setChainLabel('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const submit = useCallback(async () => {
    if (!recipientAddress || busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await sendNativeCryptoPayment(recipientAddress, amount);
      const sym = nativeSymbolForChain(result.chainId);
      const payload = buildPaymentMessagePayload({
        txHash: result.hash,
        chainId: result.chainId,
        from: result.from,
        to: result.to,
        valueWei: result.value,
        nativeSymbol: sym,
      });
      onPaymentComplete?.(payload);
      onClose();
    } catch (e) {
      const c = e?.code;
      const infoCode = e?.info?.error?.code;
      if (c === 'ACTION_REJECTED' || infoCode === 4001) {
        setError(paymentSendErrorMessagePt('ACTION_REJECTED'));
      } else if (String(e?.message || '').toLowerCase().includes('insufficient funds')) {
        setError(paymentSendErrorMessagePt('INSUFFICIENT_FUNDS'));
      } else if (c === 'NO_WALLET' || c === 'INVALID_TO' || c === 'INVALID_AMOUNT' || c === 'AMOUNT_ZERO') {
        setError(paymentSendErrorMessagePt(c));
      } else {
        setError(paymentSendErrorMessagePt());
      }
    } finally {
      setBusy(false);
    }
  }, [amount, recipientAddress, busy, onPaymentComplete, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
        className="w-full max-w-md rounded-2xl border border-whatsapp-border bg-whatsapp-sidebar shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-whatsapp-border px-4 py-3">
          <h2 id="payment-modal-title" className="text-lg font-medium text-whatsapp-text">
            Enviar cripto
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full p-1 text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text disabled:opacity-40"
            aria-label="Fechar"
          >
            <IoClose className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <p className="text-sm text-whatsapp-text-secondary">
            Para{' '}
            <span className="font-mono text-xs text-whatsapp-text">
              {formatAddress(recipientAddress)}
            </span>
          </p>
          {chainLabel ? (
            <p className="text-xs text-whatsapp-green">{chainLabel}</p>
          ) : null}

          <div>
            <label htmlFor="pay-amount" className="mb-1 block text-xs text-whatsapp-text-secondary">
              Montante (moeda nativa da rede)
            </label>
            <input
              id="pay-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-whatsapp-border bg-whatsapp-dark px-3 py-2.5 text-whatsapp-text outline-none focus:border-whatsapp-green/50"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-whatsapp-text-secondary">
            A sua carteira vai pedir confirmação na blockchain. Isto não é uma transação feita pelo servidor
            OpenZap — só a carteira assina. Depois de enviado, regista-se na conversa o hash da transação
            para o destinatário confirmar no explorador.
          </p>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="flex-1 rounded-xl border border-whatsapp-border py-3 text-sm font-medium text-whatsapp-text-secondary hover:bg-whatsapp-hover disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || !amount.trim()}
              onClick={() => void submit()}
              className="flex-1 rounded-xl bg-whatsapp-green py-3 text-sm font-semibold text-whatsapp-on-primary hover:opacity-90 disabled:opacity-40"
            >
              {busy ? 'Aguardando a carteira…' : 'Confirmar na carteira'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
