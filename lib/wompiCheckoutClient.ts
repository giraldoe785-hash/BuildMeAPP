import type {
  PreparedWompiWebCheckout,
  WompiWebCheckoutFormParams,
} from "./wompiService";

const ALLOWED_WOMPI_CHECKOUT_ACTION = "https://checkout.wompi.co/p/";

const REQUIRED_CHECKOUT_PARAM_KEYS: ReadonlyArray<
  keyof Omit<WompiWebCheckoutFormParams, "redirect-url">
> = [
  "public-key",
  "currency",
  "amount-in-cents",
  "reference",
  "signature:integrity",
  "expiration-time",
];

export class WompiCheckoutClientError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(
    message: string,
    code = "CHECKOUT_CLIENT_ERROR",
    status = 400,
    retryable = false
  ) {
    super(message);
    this.name = "WompiCheckoutClientError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export async function requestWompiCheckoutParams(
  orderId: string
): Promise<PreparedWompiWebCheckout> {
  const cleanOrderId = typeof orderId === "string" ? orderId.trim() : "";
  if (!cleanOrderId) {
    throw new WompiCheckoutClientError(
      "No se encontró el identificador interno de la orden para iniciar el pago.",
      "MISSING_ORDER_ID",
      400,
      false
    );
  }

  let response: Response;
  try {
    response = await fetch("/api/payments/wompi/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ orderId: cleanOrderId }),
    });
  } catch {
    throw new WompiCheckoutClientError(
      "Error de conexión al preparar el pago con Wompi. Verifica tu red e inténtalo de nuevo.",
      "NETWORK_ERROR",
      0,
      true
    );
  }

  const data: unknown = await response.json().catch(() => null);
  const bodyObj =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  if (!response.ok || !bodyObj || bodyObj.success !== true || !bodyObj.checkout) {
    const code =
      bodyObj && typeof bodyObj.code === "string"
        ? bodyObj.code
        : "CHECKOUT_PREP_FAILED";
    const message =
      bodyObj && typeof bodyObj.message === "string"
        ? bodyObj.message
        : "No fue posible preparar el formulario de pago con Wompi.";
    const retryable = Boolean(bodyObj?.retryable) || response.status >= 500;
    throw new WompiCheckoutClientError(message, code, response.status, retryable);
  }

  const checkout = bodyObj.checkout as PreparedWompiWebCheckout;
  if (
    checkout.checkoutUrl !== ALLOWED_WOMPI_CHECKOUT_ACTION ||
    checkout.method !== "GET" ||
    !checkout.params
  ) {
    throw new WompiCheckoutClientError(
      "Los parámetros de redirección devueltos para Wompi Web Checkout no son válidos.",
      "INVALID_CHECKOUT_PARAMS",
      500,
      false
    );
  }

  for (const key of REQUIRED_CHECKOUT_PARAM_KEYS) {
    const val = checkout.params[key];
    if (typeof val !== "string" || !val.trim()) {
      throw new WompiCheckoutClientError(
        `Falta el parámetro obligatorio de checkout "${key}".`,
        "MISSING_CHECKOUT_FIELD",
        500,
        false
      );
    }
  }

  return checkout;
}

export function submitWompiCheckoutForm(
  checkout: PreparedWompiWebCheckout
): void {
  if (typeof document === "undefined") {
    throw new WompiCheckoutClientError(
      "La redirección al checkout solo puede ejecutarse en el navegador.",
      "SSR_NOT_SUPPORTED",
      500,
      false
    );
  }

  if (checkout.checkoutUrl !== ALLOWED_WOMPI_CHECKOUT_ACTION) {
    throw new WompiCheckoutClientError(
      "Destino de Web Checkout no permitido.",
      "UNTRUSTED_CHECKOUT_URL",
      400,
      false
    );
  }

  const form = document.createElement("form");
  form.method = "GET";
  form.action = ALLOWED_WOMPI_CHECKOUT_ACTION;
  form.style.display = "none";

  for (const key of REQUIRED_CHECKOUT_PARAM_KEYS) {
    const val = checkout.params[key];
    if (typeof val === "string" && val.trim()) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = val;
      form.appendChild(input);
    }
  }

  // redirect-url es opcional según la especificación oficial de Wompi
  if (checkout.params["redirect-url"]) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "redirect-url";
    input.value = checkout.params["redirect-url"];
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

export async function redirectOrderToWompiCheckout(
  orderId: string
): Promise<PreparedWompiWebCheckout> {
  const checkout = await requestWompiCheckoutParams(orderId);
  submitWompiCheckoutForm(checkout);
  return checkout;
}
