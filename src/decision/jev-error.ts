const messages = {
  'missing-credentials': 'Defina TYPESAFE_API_KEY para consultar o Jev.',
  'invalid-credentials-config': 'Não foi possível ler uma configuração de credenciais segura.',
  'invalid-credentials-format': 'Formato inválido para TYPESAFE_API_KEY.',
  'authentication-failed': 'A API TypeSafe rejeitou a autenticação.',
  'access-denied': 'A API TypeSafe negou acesso ao julgamento.',
  'network-blocked': 'O sistema ou a política de rede bloqueou a conexão à API TypeSafe.',
  'network-unavailable': 'API TypeSafe indisponível.',
  timeout: 'Tempo limite da API TypeSafe excedido.',
  'invalid-response': 'Resposta de julgamento inválida da API TypeSafe.',
  'rate-limited': 'A API TypeSafe atingiu o limite de requisições.',
  'http-error': 'A API TypeSafe retornou um erro HTTP.',
};

export class JevError extends Error {
  constructor(readonly code: keyof typeof messages, readonly httpStatus?: number) {
    super(httpStatus === undefined ? messages[code] : `HTTP ${httpStatus}: ${messages[code]}`);
  }
}

export function jevTransportError(error: unknown, timedOut: boolean) {
  const cause = error instanceof Error ? error.cause : undefined;
  const hasCode = (value: unknown, ...codes: string[]) =>
    typeof value === 'object' && value !== null && 'code' in value
    && typeof value.code === 'string' && codes.includes(value.code);

  if (timedOut || hasCode(cause, 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT') || hasCode(error, 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT')) {
    return new JevError('timeout');
  }
  if (hasCode(cause, 'EPERM', 'EACCES') || hasCode(error, 'EPERM', 'EACCES')) {
    return new JevError('network-blocked');
  }
  return new JevError('network-unavailable');
}

export function jevHttpError(status: number) {
  switch (status) {
    case 401: return new JevError('authentication-failed', status);
    case 403: return new JevError('access-denied', status);
    case 429: return new JevError('rate-limited', status);
    default: return new JevError('http-error', status);
  }
}
