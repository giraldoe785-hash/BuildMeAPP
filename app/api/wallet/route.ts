import { getCurrentUser } from "@/lib/auth";
import { formatWompiCentsToCop } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";
import { getWalletBalance, getWalletHistory } from "@/lib/walletService";

const NO_STORE = { "Cache-Control": "no-store" };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Inicia sesión para consultar tu Fixi Wallet.",
        },
        401
      );
    }

    const wallet = await getWalletBalance(prisma, user.id);
    const history = await getWalletHistory(prisma, {
      usuarioId: user.id,
      limit: 50,
      offset: 0,
    });

    return jsonResponse({
      success: true,
      wallet: {
        id: wallet.walletId,
        usuarioId: wallet.usuarioId,
        saldoDisponibleCentavos: wallet.saldoDisponibleCentavos.toString(),
        saldoRetenidoCentavos: wallet.saldoRetenidoCentavos.toString(),
        formattedSaldoCop: formatWompiCentsToCop(wallet.saldoDisponibleCentavos),
        bloqueadaParaDebito: wallet.bloqueadaParaDebito,
        requiereReconciliacion: wallet.requiereReconciliacion,
      },
      movimientos: history.movimientos.map((m) => ({
        ...m,
        formattedMontoCop: formatWompiCentsToCop(m.montoEnCentavos),
        formattedSaldoAnteriorCop: m.saldoAnteriorCentavos
          ? formatWompiCentsToCop(m.saldoAnteriorCentavos)
          : null,
        formattedSaldoPosteriorCop: m.saldoPosteriorCentavos
          ? formatWompiCentsToCop(m.saldoPosteriorCentavos)
          : null,
      })),
    });
  } catch (error) {
    console.error("[WalletAPI][GET] Error al consultar billetera:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible consultar tu Fixi Wallet.",
      },
      500
    );
  }
}
