import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  keccak256,
  parseAbi,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type TransactionSerialized,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const abi = parseAbi([
  'function firmante() view returns (address)',
  'function registrada(bytes32 huella) view returns (bool)',
  'function registrar(bytes32 huella)',
]);

function conexionSepolia() {
  const rpc = process.env.BLOCKCHAIN_RPC_URL;
  if (!rpc) return null;
  try {
    if (!['http:', 'https:'].includes(new URL(rpc).protocol)) return null;
    return http(rpc, { timeout: 6000, retryCount: 0 });
  } catch {
    return null;
  }
}

export async function verificarRegistroSepolia(
  hash: Hex,
  huella: Hex,
  contrato: Address,
) {
  const transport = conexionSepolia();
  if (!transport) throw new Error('Falta configurar la red.');
  const lectura = createPublicClient({ chain: sepolia, transport });
  if ((await lectura.getChainId()) !== sepolia.id)
    throw new Error('Red incorrecta.');

  const [recibo, transaccion, bloque] = await Promise.all([
    lectura.getTransactionReceipt({ hash }).catch((error: unknown) => {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }),
    lectura.getTransaction({ hash }).catch((error: unknown) => {
      if (error instanceof TransactionNotFoundError) return null;
      throw error;
    }),
    lectura.getBlockNumber(),
  ]);
  if (
    !recibo ||
    !transaccion ||
    transaccion.blockHash !== recibo.blockHash ||
    bloque < recibo.blockNumber + 1n
  )
    return 'pendiente';
  const entrada = encodeFunctionData({
    abi,
    functionName: 'registrar',
    args: [huella],
  });
  if (
    recibo.status !== 'success' ||
    recibo.to?.toLowerCase() !== contrato.toLowerCase() ||
    transaccion.input.toLowerCase() !== entrada.toLowerCase()
  )
    return 'no-coincide';

  const registrada = await lectura.readContract({
    address: contrato,
    abi,
    functionName: 'registrada',
    args: [huella],
    blockNumber: recibo.blockNumber,
  });
  return registrada ? 'confirmado' : 'no-coincide';
}

export function configurarSepolia() {
  const { BLOCKCHAIN_CLAVE_FIRMANTE: clave, BLOCKCHAIN_CONTRATO: contrato } =
    process.env;
  if (
    !clave ||
    !/^0x[\da-f]{64}$/i.test(clave) ||
    !contrato ||
    !isAddress(contrato)
  )
    return null;
  const transport = conexionSepolia();
  if (!transport) return null;
  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    account = privateKeyToAccount(clave as Hex);
  } catch {
    return null;
  }
  const lectura = createPublicClient({ chain: sepolia, transport });
  const escritura = createWalletClient({ account, chain: sepolia, transport });

  return {
    contrato,
    async comprobarRed() {
      if ((await lectura.getChainId()) !== sepolia.id)
        throw new Error('Red incorrecta.');
    },
    async firmar(huella: Hex) {
      const autorizado = await lectura.readContract({
        address: contrato,
        abi,
        functionName: 'firmante',
      });
      if (autorizado.toLowerCase() !== account.address.toLowerCase())
        throw new Error('Firmante incorrecto.');
      const solicitud = await escritura.prepareTransactionRequest({
        to: contrato,
        data: encodeFunctionData({
          abi,
          functionName: 'registrar',
          args: [huella],
        }),
      });
      const firmada = await escritura.signTransaction(solicitud);
      return { firmada, transaccion: keccak256(firmada) };
    },
    async propagar(firmada: string, hash: Hex) {
      try {
        await lectura.getTransaction({ hash });
      } catch (error) {
        if (!(error instanceof TransactionNotFoundError)) throw error;
        await escritura.sendRawTransaction({
          serializedTransaction: firmada as TransactionSerialized,
        });
      }
    },
    async consultar(hash: Hex, huella: Hex, direccion: Address) {
      const recibo = await lectura
        .getTransactionReceipt({ hash })
        .catch((error: unknown) => {
          if (error instanceof TransactionReceiptNotFoundError) return null;
          throw error;
        });
      if (!recibo) return { estado: 'sin-recibo' } as const;
      if ((await lectura.getBlockNumber()) < recibo.blockNumber + 1n)
        return { estado: 'confirmando' } as const;
      const registrada =
        recibo.status === 'success' &&
        recibo.to?.toLowerCase() === direccion.toLowerCase() &&
        (await lectura.readContract({
          address: direccion,
          abi,
          functionName: 'registrada',
          args: [huella],
          blockNumber: recibo.blockNumber,
        }));
      return {
        estado: registrada ? 'confirmado' : 'fallido',
        bloque: recibo.blockNumber.toString(),
        costoWei: (recibo.gasUsed * recibo.effectiveGasPrice).toString(),
      } as const;
    },
  };
}
