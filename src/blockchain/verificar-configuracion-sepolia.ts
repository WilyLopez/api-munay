import { formatEther } from 'viem';
import { configurarSepolia } from './red-sepolia.js';

const variables = [
  'BLOCKCHAIN_RPC_URL',
  'BLOCKCHAIN_CLAVE_FIRMANTE',
  'BLOCKCHAIN_CONTRATO',
];

async function verificarConfiguracion() {
  const faltantes = variables.filter((nombre) => !process.env[nombre]?.trim());
  if (faltantes.length) {
    console.error(`Configura estas variables: ${faltantes.join(', ')}.`);
    return 1;
  }
  const red = configurarSepolia();
  if (!red) {
    console.error(
      'Revisa el formato de la URL RPC, la clave y la dirección del contrato.',
    );
    return 1;
  }
  try {
    const resultado = await red.diagnosticar();
    switch (resultado.estado) {
      case 'red-incorrecta':
        console.error(
          `El RPC respondió con chain ID ${resultado.red}. Se esperaba Sepolia (11155111).`,
        );
        return 1;
      case 'firmante-incorrecto':
        console.error('El contrato tiene autorizado a otro firmante.');
        return 1;
      case 'sin-saldo':
        console.error('El firmante necesita ETH de prueba en Sepolia.');
        return 1;
      case 'lista':
        console.log(
          `Sepolia responde y el firmante coincide. Saldo disponible: ${formatEther(resultado.saldo)} ETH de prueba.`,
        );
        return 0;
    }
  } catch {
    console.error(
      'No pudimos consultar el RPC o leer el firmante del contrato.',
    );
    return 1;
  }
}

process.exitCode = await verificarConfiguracion();
