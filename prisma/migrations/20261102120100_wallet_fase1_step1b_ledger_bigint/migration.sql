-- Migration 2: Step 1b - Fixi Wallet Phase 1 Financial Core & BigInt Ledger
-- Tables, Expand Phase, Deterministic Backfill, Composite Foreign Keys, and Strict CHECK Constraints

-- ============================================================================
-- 1. DROP OBSOLETE FOREIGN KEYS & INDEXES
-- ============================================================================
ALTER TABLE "fixi_wallets" DROP CONSTRAINT IF EXISTS "fixi_wallets_usuarioId_fkey";

ALTER TABLE "transacciones_wallet" DROP CONSTRAINT IF EXISTS "transacciones_wallet_walletId_fkey";
ALTER TABLE "transacciones_wallet" DROP CONSTRAINT IF EXISTS "transacciones_wallet_ordenId_fkey";

ALTER TABLE "reembolsos_transacciones" DROP CONSTRAINT IF EXISTS "reembolsos_transacciones_autorizadoPorUsuarioId_fkey";
ALTER TABLE "reembolsos_transacciones" DROP CONSTRAINT IF EXISTS "reembolsos_transacciones_segundoAutorizadorId_fkey";
ALTER TABLE "reembolsos_transacciones" DROP CONSTRAINT IF EXISTS "reembolsos_transacciones_ordenId_fkey";
ALTER TABLE "reembolsos_transacciones" DROP CONSTRAINT IF EXISTS "reembolsos_transacciones_ticketId_fkey";

DROP INDEX IF EXISTS "reembolsos_transacciones_autorizadoPorUsuarioId_idx";
DROP INDEX IF EXISTS "reembolsos_transacciones_segundoAutorizadorId_idx";

-- ============================================================================
-- 2. EXPAND TABLA ordenes_servicio (Composite Unique Target)
-- ============================================================================
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ordenes_servicio_id_clienteId_key'
    ) THEN
        ALTER TABLE "ordenes_servicio" ADD CONSTRAINT "ordenes_servicio_id_clienteId_key" UNIQUE ("id", "clienteId");
    END IF;
END $$;

-- ============================================================================
-- 3. EXPAND TABLA fixi_wallets
-- ============================================================================
ALTER TABLE "fixi_wallets" 
    ADD COLUMN IF NOT EXISTS "alias" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "saldoDisponibleCentavos" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "saldoRetenidoCentavos" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "bloqueadaParaDebito" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "requiereReconciliacion" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "fixi_wallets" ALTER COLUMN "saldoDisponible" DROP NOT NULL;
ALTER TABLE "fixi_wallets" ALTER COLUMN "saldoRetenido" DROP NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fixi_wallets_id_usuarioId_key'
    ) THEN
        ALTER TABLE "fixi_wallets" ADD CONSTRAINT "fixi_wallets_id_usuarioId_key" UNIQUE ("id", "usuarioId");
    END IF;
END $$;

-- ============================================================================
-- 4. CREATE TABLA recargas_wallet
-- ============================================================================
CREATE TABLE IF NOT EXISTS "recargas_wallet" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "montoEnCentavos" BIGINT NOT NULL,
    "montoEnDisputaCentavos" BIGINT NOT NULL DEFAULT 0,
    "estado" "estado_recarga_wallet" NOT NULL DEFAULT 'PENDIENTE',
    "estadoConciliacion" "estado_conciliacion_recarga" NOT NULL DEFAULT 'CONCILIADO',
    "intentoGanadorId" UUID,
    "ticketSoporteId" UUID,
    "claveIdempotencia" VARCHAR(100) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesadoEn" TIMESTAMP(3),

    CONSTRAINT "recargas_wallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "recargas_wallet_intentoGanadorId_key" ON "recargas_wallet"("intentoGanadorId");
CREATE UNIQUE INDEX IF NOT EXISTS "recargas_wallet_claveIdempotencia_key" ON "recargas_wallet"("claveIdempotencia");
CREATE UNIQUE INDEX IF NOT EXISTS "recargas_wallet_id_walletId_usuarioId_key" ON "recargas_wallet"("id", "walletId", "usuarioId");
CREATE INDEX IF NOT EXISTS "recargas_wallet_walletId_idx" ON "recargas_wallet"("walletId");
CREATE INDEX IF NOT EXISTS "recargas_wallet_usuarioId_idx" ON "recargas_wallet"("usuarioId");
CREATE INDEX IF NOT EXISTS "recargas_wallet_estado_creadoEn_idx" ON "recargas_wallet"("estado", "creadoEn");
CREATE INDEX IF NOT EXISTS "recargas_wallet_ticketSoporteId_idx" ON "recargas_wallet"("ticketSoporteId");

-- ============================================================================
-- 5. EXPAND TABLA intentos_pago_wompi
-- ============================================================================
ALTER TABLE "intentos_pago_wompi" 
    ADD COLUMN IF NOT EXISTS "recargaId" UUID,
    ALTER COLUMN "ordenId" DROP NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'intentos_pago_wompi_id_recargaId_key'
    ) THEN
        ALTER TABLE "intentos_pago_wompi" ADD CONSTRAINT "intentos_pago_wompi_id_recargaId_key" UNIQUE ("id", "recargaId");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "intentos_pago_wompi_ordenId_idx" ON "intentos_pago_wompi"("ordenId");
CREATE INDEX IF NOT EXISTS "intentos_pago_wompi_recargaId_idx" ON "intentos_pago_wompi"("recargaId");
CREATE INDEX IF NOT EXISTS "intentos_pago_wompi_estado_creadoEn_idx" ON "intentos_pago_wompi"("estado", "creadoEn");

-- ============================================================================
-- 6. EXPAND & BACKFILL TABLA reembolsos_transacciones
-- ============================================================================
ALTER TABLE "reembolsos_transacciones" 
    ADD COLUMN IF NOT EXISTS "clienteBeneficiarioId" UUID,
    ADD COLUMN IF NOT EXISTS "montoEnCentavos" BIGINT,
    ADD COLUMN IF NOT EXISTS "solicitanteId" UUID,
    ADD COLUMN IF NOT EXISTS "esLegadoSinSolicitante" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "rolSolicitante" "rol_usuario",
    ADD COLUMN IF NOT EXISTS "autorizador1Id" UUID,
    ADD COLUMN IF NOT EXISTS "rolAutorizador1" "rol_usuario",
    ADD COLUMN IF NOT EXISTS "permisoAutorizador1" "permiso_interno",
    ADD COLUMN IF NOT EXISTS "fechaAutorizacion1" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "autorizador2Id" UUID,
    ADD COLUMN IF NOT EXISTS "rolAutorizador2" "rol_usuario",
    ADD COLUMN IF NOT EXISTS "permisoAutorizador2" "permiso_interno",
    ADD COLUMN IF NOT EXISTS "fechaAutorizacion2" TIMESTAMP(3);

-- Backfill legacy columns if they exist
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'reembolsos_transacciones' AND column_name = 'autorizadoPorUsuarioId'
    ) THEN
        UPDATE "reembolsos_transacciones"
        SET "autorizador1Id" = "autorizadoPorUsuarioId",
            "autorizador2Id" = "segundoAutorizadorId",
            "fechaAutorizacion1" = "fechaAutorizacion",
            "fechaAutorizacion2" = "fechaSegundaAutorizacion"
        WHERE "autorizador1Id" IS NULL;

        ALTER TABLE "reembolsos_transacciones" DROP COLUMN "autorizadoPorUsuarioId";
        ALTER TABLE "reembolsos_transacciones" DROP COLUMN "segundoAutorizadorId";
        ALTER TABLE "reembolsos_transacciones" DROP COLUMN "fechaAutorizacion";
        ALTER TABLE "reembolsos_transacciones" DROP COLUMN "fechaSegundaAutorizacion";
    END IF;
END $$;

-- Backfill clienteBeneficiarioId and montoEnCentavos
UPDATE "reembolsos_transacciones" rt
SET "clienteBeneficiarioId" = o."clienteId"
FROM "ordenes_servicio" o
WHERE rt."ordenId" = o."id" AND rt."clienteBeneficiarioId" IS NULL;

UPDATE "reembolsos_transacciones"
SET "montoEnCentavos" = ROUND("monto" * 100)::BIGINT
WHERE "montoEnCentavos" IS NULL AND "monto" IS NOT NULL;

-- If any legacy records, mark as legacy without applicant
UPDATE "reembolsos_transacciones"
SET "esLegadoSinSolicitante" = TRUE
WHERE "solicitanteId" IS NULL;

-- Set NOT NULL and nullability adjustments
ALTER TABLE "reembolsos_transacciones" ALTER COLUMN "clienteBeneficiarioId" SET NOT NULL;
ALTER TABLE "reembolsos_transacciones" ALTER COLUMN "montoEnCentavos" SET NOT NULL;
ALTER TABLE "reembolsos_transacciones" ALTER COLUMN "monto" DROP NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reembolsos_transacciones_id_clienteBeneficiarioId_key'
    ) THEN
        ALTER TABLE "reembolsos_transacciones" ADD CONSTRAINT "reembolsos_transacciones_id_clienteBeneficiarioId_key" UNIQUE ("id", "clienteBeneficiarioId");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_ordenId_idx" ON "reembolsos_transacciones"("ordenId");
CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_clienteBeneficiarioId_idx" ON "reembolsos_transacciones"("clienteBeneficiarioId");
CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_ticketId_idx" ON "reembolsos_transacciones"("ticketId");
CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_estado_idx" ON "reembolsos_transacciones"("estado");
CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_solicitanteId_idx" ON "reembolsos_transacciones"("solicitanteId");
CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_autorizador1Id_idx" ON "reembolsos_transacciones"("autorizador1Id");
CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_autorizador2Id_idx" ON "reembolsos_transacciones"("autorizador2Id");
CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_wompiTransactionId_idx" ON "reembolsos_transacciones"("wompiTransactionId");
CREATE INDEX IF NOT EXISTS "reembolsos_transacciones_intentoPagoWompiId_idx" ON "reembolsos_transacciones"("intentoPagoWompiId");

-- ============================================================================
-- 7. EXPAND & BACKFILL TABLA transacciones_wallet
-- ============================================================================
ALTER TABLE "transacciones_wallet"
    ADD COLUMN IF NOT EXISTS "usuarioId" UUID,
    ADD COLUMN IF NOT EXISTS "naturaleza" "naturaleza_movimiento_wallet",
    ADD COLUMN IF NOT EXISTS "montoEnCentavos" BIGINT,
    ADD COLUMN IF NOT EXISTS "saldoAnteriorCentavos" BIGINT,
    ADD COLUMN IF NOT EXISTS "saldoPosteriorCentavos" BIGINT,
    ADD COLUMN IF NOT EXISTS "esLegadoSinSnapshots" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "esMovimientoEnCuarentena" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "claveIdempotencia" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "recargaId" UUID,
    ADD COLUMN IF NOT EXISTS "reembolsoId" UUID,
    ADD COLUMN IF NOT EXISTS "ticketId" UUID;

-- B2: Backfill legacy transacciones_wallet
UPDATE "transacciones_wallet" tw
SET "usuarioId" = w."usuarioId"
FROM "fixi_wallets" w
WHERE tw."walletId" = w."id" AND tw."usuarioId" IS NULL;

UPDATE "transacciones_wallet"
SET "montoEnCentavos" = ROUND("monto" * 100)::BIGINT,
    "esLegadoSinSnapshots" = TRUE
WHERE "montoEnCentavos" IS NULL AND "monto" IS NOT NULL;

UPDATE "transacciones_wallet"
SET "claveIdempotencia" = 'legacy-' || "id"::text
WHERE "claveIdempotencia" IS NULL;

UPDATE "transacciones_wallet"
SET "naturaleza" = CASE
    WHEN "tipo" IN ('RECARGA', 'REEMBOLSO_GARANTIA') THEN 'CREDITO'::"naturaleza_movimiento_wallet"
    WHEN "tipo" = 'PAGO_SERVICIO' THEN 'DEBITO'::"naturaleza_movimiento_wallet"
    ELSE NULL
END
WHERE "naturaleza" IS NULL;

-- B2. Quarantine ambiguous movements
UPDATE "transacciones_wallet"
SET "esMovimientoEnCuarentena" = TRUE
WHERE "tipo" NOT IN ('RECARGA', 'REEMBOLSO_GARANTIA', 'PAGO_SERVICIO');

-- Set NOT NULLs on transacciones_wallet
ALTER TABLE "transacciones_wallet" ALTER COLUMN "usuarioId" SET NOT NULL;
ALTER TABLE "transacciones_wallet" ALTER COLUMN "montoEnCentavos" SET NOT NULL;
ALTER TABLE "transacciones_wallet" ALTER COLUMN "claveIdempotencia" SET NOT NULL;
ALTER TABLE "transacciones_wallet" ALTER COLUMN "monto" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "transacciones_wallet_claveIdempotencia_key" ON "transacciones_wallet"("claveIdempotencia");
CREATE INDEX IF NOT EXISTS "transacciones_wallet_walletId_creadoEn_idx" ON "transacciones_wallet"("walletId", "creadoEn");
CREATE INDEX IF NOT EXISTS "transacciones_wallet_usuarioId_idx" ON "transacciones_wallet"("usuarioId");
CREATE INDEX IF NOT EXISTS "transacciones_wallet_recargaId_idx" ON "transacciones_wallet"("recargaId");
CREATE INDEX IF NOT EXISTS "transacciones_wallet_ordenId_idx" ON "transacciones_wallet"("ordenId");
CREATE INDEX IF NOT EXISTS "transacciones_wallet_reembolsoId_idx" ON "transacciones_wallet"("reembolsoId");
CREATE INDEX IF NOT EXISTS "transacciones_wallet_ticketId_idx" ON "transacciones_wallet"("ticketId");

-- ============================================================================
-- 8. BACKFILL B1: FIXI WALLETS & ENFORCE QUARANTINE / DISCREPANCY BLOCK
-- ============================================================================
UPDATE "fixi_wallets"
SET "saldoDisponibleCentavos" = ROUND("saldoDisponible" * 100)::BIGINT,
    "saldoRetenidoCentavos" = ROUND("saldoRetenido" * 100)::BIGINT
WHERE "saldoDisponible" IS NOT NULL AND "saldoDisponibleCentavos" = 0;

-- Block wallets containing quarantine transactions
UPDATE "fixi_wallets" w
SET "bloqueadaParaDebito" = TRUE,
    "requiereReconciliacion" = TRUE
FROM "transacciones_wallet" tw
WHERE tw."walletId" = w."id" AND tw."esMovimientoEnCuarentena" = TRUE;

-- Block wallets where known movements sum does not match saldoDisponibleCentavos
WITH balance_calc AS (
    SELECT 
        tw."walletId",
        COALESCE(SUM(
            CASE 
                WHEN tw."naturaleza" = 'CREDITO' THEN tw."montoEnCentavos"
                WHEN tw."naturaleza" = 'DEBITO' THEN -tw."montoEnCentavos"
                ELSE 0
            END
        ), 0) AS suma_movimientos
    FROM "transacciones_wallet" tw
    WHERE tw."esMovimientoEnCuarentena" = FALSE
    GROUP BY tw."walletId"
)
UPDATE "fixi_wallets" w
SET "bloqueadaParaDebito" = TRUE,
    "requiereReconciliacion" = TRUE
FROM balance_calc bc
WHERE bc."walletId" = w."id" AND bc.suma_movimientos <> w."saldoDisponibleCentavos";

-- ============================================================================
-- 9. FOREIGN KEYS (COMPOSITE OWNERSHIP & ON DELETE RESTRICT)
-- ============================================================================
ALTER TABLE "fixi_wallets" 
    ADD CONSTRAINT "fixi_wallets_usuarioId_fkey" 
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recargas_wallet" 
    ADD CONSTRAINT "recargas_wallet_walletId_usuarioId_fkey" 
    FOREIGN KEY ("walletId", "usuarioId") REFERENCES "fixi_wallets"("id", "usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "recargas_wallet_usuarioId_fkey" 
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "recargas_wallet_intentoGanadorId_fkey" 
    FOREIGN KEY ("intentoGanadorId") REFERENCES "intentos_pago_wompi"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "recargas_wallet_ticketSoporteId_fkey" 
    FOREIGN KEY ("ticketSoporteId") REFERENCES "tickets_soporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intentos_pago_wompi" 
    ADD CONSTRAINT "intentos_pago_wompi_recargaId_fkey" 
    FOREIGN KEY ("recargaId") REFERENCES "recargas_wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transacciones_wallet" 
    ADD CONSTRAINT "transacciones_wallet_walletId_usuarioId_fkey" 
    FOREIGN KEY ("walletId", "usuarioId") REFERENCES "fixi_wallets"("id", "usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "transacciones_wallet_usuarioId_fkey" 
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "transacciones_wallet_recargaId_walletId_usuarioId_fkey" 
    FOREIGN KEY ("recargaId", "walletId", "usuarioId") REFERENCES "recargas_wallet"("id", "walletId", "usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "transacciones_wallet_ordenId_usuarioId_fkey" 
    FOREIGN KEY ("ordenId", "usuarioId") REFERENCES "ordenes_servicio"("id", "clienteId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "transacciones_wallet_reembolsoId_usuarioId_fkey" 
    FOREIGN KEY ("reembolsoId", "usuarioId") REFERENCES "reembolsos_transacciones"("id", "clienteBeneficiarioId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "transacciones_wallet_ticketId_fkey" 
    FOREIGN KEY ("ticketId") REFERENCES "tickets_soporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reembolsos_transacciones" 
    ADD CONSTRAINT "reembolsos_transacciones_ordenId_clienteBeneficiarioId_fkey" 
    FOREIGN KEY ("ordenId", "clienteBeneficiarioId") REFERENCES "ordenes_servicio"("id", "clienteId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "reembolsos_transacciones_clienteBeneficiarioId_fkey" 
    FOREIGN KEY ("clienteBeneficiarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "reembolsos_transacciones_ticketId_fkey" 
    FOREIGN KEY ("ticketId") REFERENCES "tickets_soporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "reembolsos_transacciones_solicitanteId_fkey" 
    FOREIGN KEY ("solicitanteId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "reembolsos_transacciones_autorizador1Id_fkey" 
    FOREIGN KEY ("autorizador1Id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "reembolsos_transacciones_autorizador2Id_fkey" 
    FOREIGN KEY ("autorizador2Id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 10. STRICT FINANCIAL CHECK CONSTRAINTS
-- ============================================================================

-- 10.1 FIXI WALLETS
ALTER TABLE "fixi_wallets" 
    ADD CONSTRAINT "chk_fixi_wallet_saldos_no_negativos" 
    CHECK ("saldoDisponibleCentavos" >= 0 AND "saldoRetenidoCentavos" >= 0);

ALTER TABLE "fixi_wallets" 
    ADD CONSTRAINT "chk_fixi_wallet_cuarentena_bloqueo" 
    CHECK (NOT ("requiereReconciliacion" = TRUE AND "bloqueadaParaDebito" = FALSE));

-- 10.2 TRANSACCIONES WALLET
ALTER TABLE "transacciones_wallet" 
    ADD CONSTRAINT "chk_transaccion_monto_positivo" 
    CHECK ("montoEnCentavos" > 0);

ALTER TABLE "transacciones_wallet" 
    ADD CONSTRAINT "chk_transaccion_naturaleza_coherente" 
    CHECK (
        ("naturaleza" = 'CREDITO' AND "saldoPosteriorCentavos" = "saldoAnteriorCentavos" + "montoEnCentavos") OR
        ("naturaleza" = 'DEBITO' AND "saldoPosteriorCentavos" = "saldoAnteriorCentavos" - "montoEnCentavos") OR
        "esLegadoSinSnapshots" = TRUE
    );

ALTER TABLE "transacciones_wallet" 
    ADD CONSTRAINT "chk_transaccion_tipo_naturaleza" 
    CHECK (
        ("tipo" IN ('RECARGA', 'REEMBOLSO_GARANTIA') AND "naturaleza" = 'CREDITO') OR
        ("tipo" = 'PAGO_SERVICIO' AND "naturaleza" = 'DEBITO') OR
        ("tipo" IN ('TRANSFERENCIA_PROPINA', 'AJUSTE_COMPENSATORIO') AND "naturaleza" IN ('CREDITO', 'DEBITO')) OR
        "naturaleza" IS NULL
    );

ALTER TABLE "transacciones_wallet" 
    ADD CONSTRAINT "chk_transaccion_snapshots_integridad" 
    CHECK (
        "esLegadoSinSnapshots" = TRUE OR (
            "saldoAnteriorCentavos" IS NOT NULL AND
            "saldoPosteriorCentavos" IS NOT NULL AND
            "saldoAnteriorCentavos" >= 0 AND
            "saldoPosteriorCentavos" >= 0
        )
    );

ALTER TABLE "transacciones_wallet" 
    ADD CONSTRAINT "chk_transaccion_parent_exclusivity" 
    CHECK (
        (CASE WHEN "recargaId" IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN "ordenId" IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN "reembolsoId" IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN "ticketId" IS NOT NULL THEN 1 ELSE 0 END) <= 1
    );

-- 10.3 RECARGAS WALLET
ALTER TABLE "recargas_wallet" 
    ADD CONSTRAINT "chk_recarga_monto_positivo" 
    CHECK ("montoEnCentavos" > 0 AND "montoEnDisputaCentavos" >= 0 AND "montoEnDisputaCentavos" <= "montoEnCentavos");

-- 10.4 REEMBOLSOS TRANSACCIONES
ALTER TABLE "reembolsos_transacciones" 
    ADD CONSTRAINT "chk_reembolso_monto_positivo" 
    CHECK ("montoEnCentavos" > 0);

ALTER TABLE "reembolsos_transacciones" 
    ADD CONSTRAINT "chk_reembolso_dual_approval_logic" 
    CHECK (
        NOT ("montoEnCentavos" > 15000000 AND "estado" = 'procesado' AND ("autorizador2Id" IS NULL OR "fechaAutorizacion2" IS NULL))
    );

ALTER TABLE "reembolsos_transacciones" 
    ADD CONSTRAINT "chk_reembolso_autorizadores_distintos" 
    CHECK ("autorizador1Id" IS NULL OR "autorizador2Id" IS NULL OR "autorizador1Id" <> "autorizador2Id");

ALTER TABLE "reembolsos_transacciones" 
    ADD CONSTRAINT "chk_reembolso_solicitante_no_autoriza" 
    CHECK (
        "solicitanteId" IS NULL OR (
            ("autorizador1Id" IS NULL OR "solicitanteId" <> "autorizador1Id") AND
            ("autorizador2Id" IS NULL OR "solicitanteId" <> "autorizador2Id")
        )
    );

-- 10.5 INTENTOS PAGO WOMPI
ALTER TABLE "intentos_pago_wompi" 
    ADD CONSTRAINT "chk_intento_pago_parent_exclusivity" 
    CHECK (NOT ("ordenId" IS NOT NULL AND "recargaId" IS NOT NULL));
