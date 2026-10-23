// Validación del registro de clientes compartida entre el formulario (cliente)
// y POST /api/auth/register/client (servidor).
//
// Este módulo es PURO (sin imports de servidor, Prisma ni Next) para poder
// usarse en componentes "use client" y en pruebas sin levantar la aplicación.
// El servidor siempre vuelve a validar: aquí solo se evita que el cliente
// envíe peticiones que ya se sabe que serán rechazadas.

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 150;
export const USERNAME_REGEX = /^[a-z0-9_.]{3,50}$/;
export const NAME_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 7;
export const PASSWORD_MAX_LENGTH = 128; // evita contraseñas gigantes (abuso de CPU/memoria)

export const PASSWORD_POLICY_MESSAGE =
  "La contraseña debe tener mínimo 7 caracteres y contener al menos 2 números.";

export interface ClientRegistrationInput {
  name: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidPasswordPolicy(password: string): boolean {
  const numbersCount = (password.match(/\d/g) || []).length;
  return password.length >= PASSWORD_MIN_LENGTH && numbersCount >= 2;
}

/**
 * Valida los datos del registro de cliente (ya normalizados o no: se normalizan
 * aquí). Devuelve el primer mensaje de error en español, o null si todo es válido.
 * El orden y los mensajes son los mismos que aplica el servidor.
 */
export function validateClientRegistration(
  input: ClientRegistrationInput
): string | null {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  const { password, confirmPassword } = input;

  if (!name || !email || !username || !password || !confirmPassword) {
    return "Todos los campos son obligatorios.";
  }

  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_REGEX.test(email)) {
    return "Ingresa una dirección de correo electrónico válida.";
  }

  if (!USERNAME_REGEX.test(username)) {
    return "El nombre de usuario debe tener entre 3 y 50 caracteres y solo puede contener letras, números, punto o guion bajo.";
  }

  if (password.length > PASSWORD_MAX_LENGTH || !isValidPasswordPolicy(password)) {
    return PASSWORD_POLICY_MESSAGE;
  }

  if (password !== confirmPassword) {
    return "Las contraseñas no coinciden.";
  }

  if (name.length > NAME_MAX_LENGTH) {
    return `El nombre no puede superar ${NAME_MAX_LENGTH} caracteres.`;
  }

  if (name.split(/\s+/).length < 2) {
    return "Ingresa el nombre completo incluyendo al menos un apellido.";
  }

  return null;
}
