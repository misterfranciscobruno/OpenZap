import { BrowserProvider, formatEther, getAddress, parseEther } from 'ethers';
import { getEthereumProvider } from './ethereumProvider';

/** @type {Record<number, string>} */
const EXPLORER_TX_PREFIX = {
  1: 'https://etherscan.io/tx/',
  11155111: 'https://sepolia.etherscan.io/tx/',
  17000: 'https://holesky.etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
  80001: 'https://amoy.polygonscan.com/tx/',
  56: 'https://bscscan.com/tx/',
  97: 'https://testnet.bscscan.com/tx/',
  42161: 'https://arbiscan.io/tx/',
  421614: 'https://sepolia.arbiscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  84532: 'https://sepolia.basescan.org/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  11155420: 'https://sepolia-optimism.etherscan.io/tx/',
  43114: 'https://snowtrace.io/tx/',
};

/** @type {Record<number, string>} */
const NATIVE_SYMBOL = {
  1: 'ETH',
  11155111: 'ETH',
  17000: 'ETH',
  137: 'MATIC',
  80001: 'MATIC',
  56: 'BNB',
  97: 'BNB',
  42161: 'ETH',
  421614: 'ETH',
  8453: 'ETH',
  84532: 'ETH',
  10: 'ETH',
  11155420: 'ETH',
  43114: 'AVAX',
};

export function nativeSymbolForChain(chainId) {
  const id = Number(chainId);
  return NATIVE_SYMBOL[id] || 'ETH';
}

export function getExplorerTxUrl(chainId, txHash) {
  const id = Number(chainId);
  const h = String(txHash || '').trim();
  if (!h) return '';
  const base = EXPLORER_TX_PREFIX[id];
  return base ? `${base}${h}` : '';
}

/**
 * Monta o JSON guardado na mensagem (tipo `payment`), encriptado como texto.
 */
export function buildPaymentMessagePayload({
  txHash,
  chainId,
  from,
  to,
  valueWei,
  nativeSymbol,
}) {
  return JSON.stringify({
    v: 1,
    kind: 'native_transfer',
    txHash: String(txHash),
    chainId: Number(chainId),
    from: String(from),
    to: String(to),
    valueWei: String(valueWei),
    nativeSymbol: nativeSymbol || nativeSymbolForChain(chainId),
    at: Date.now(),
  });
}

/**
 * @param {string} str - conteúdo já desencriptado
 * @returns {object | null}
 */
export function parsePaymentMessagePayload(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    const o = JSON.parse(str);
    if (o?.v !== 1 || o?.kind !== 'native_transfer' || !o.txHash) return null;
    return o;
  } catch {
    return null;
  }
}

export function formatPaymentAmount(valueWei) {
  try {
    return formatEther(String(valueWei || '0'));
  } catch {
    return String(valueWei ?? '');
  }
}

/**
 * Envia moeda nativa da rede atual (ETH, MATIC, BNB, etc.) para `toAddress`.
 * @returns {Promise<{ hash: string, chainId: number, from: string, to: string, value: string }>}
 */
export async function sendNativeCryptoPayment(toAddress, amountDecimalString) {
  const eth = getEthereumProvider();
  if (!eth) {
    const err = new Error('NO_WALLET');
    err.code = 'NO_WALLET';
    throw err;
  }
  let to;
  try {
    to = getAddress(String(toAddress).trim());
  } catch {
    const err = new Error('INVALID_TO');
    err.code = 'INVALID_TO';
    throw err;
  }
  const normalized = String(amountDecimalString ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  let value;
  try {
    value = parseEther(normalized === '' ? '0' : normalized);
  } catch {
    const err = new Error('INVALID_AMOUNT');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }
  if (value <= 0n) {
    const err = new Error('AMOUNT_ZERO');
    err.code = 'AMOUNT_ZERO';
    throw err;
  }

  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  const from = await signer.getAddress();
  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);

  const tx = await signer.sendTransaction({ to, value });
  return {
    hash: tx.hash,
    chainId,
    from,
    to,
    value: value.toString(),
  };
}

export function paymentSendErrorMessagePt(code) {
  switch (code) {
    case 'NO_WALLET':
      return 'Ligue uma carteira (MetaMask ou WalletConnect) para enviar.';
    case 'INVALID_TO':
      return 'Endereço do destinatário inválido.';
    case 'INVALID_AMOUNT':
      return 'Indique um montante válido (ex.: 0.01).';
    case 'AMOUNT_ZERO':
      return 'O montante tem de ser maior que zero.';
    case 'ACTION_REJECTED':
    case 4001:
      return 'Envio cancelado na carteira.';
    case 'INSUFFICIENT_FUNDS':
      return 'Saldo insuficiente para este envio e taxa de rede.';
    default:
      return 'Não foi possível enviar o pagamento. Verifique a rede e o saldo.';
  }
}
