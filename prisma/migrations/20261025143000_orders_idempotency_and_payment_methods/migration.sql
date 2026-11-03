-- AlterEnum
ALTER TYPE "metodo_pago" ADD VALUE IF NOT EXISTS 'APPLE_PAY';
ALTER TYPE "metodo_pago" ADD VALUE IF NOT EXISTS 'CASH_POS';

-- AlterTable
ALTER TABLE "ordenes_servicio" ADD COLUMN "claveIdempotencia" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_servicio_clienteId_claveIdempotencia_key" ON "ordenes_servicio"("clienteId", "claveIdempotencia");

-- CreatePartialUniqueIndex: Garantiza a lo sumo una orden activa (no terminal) por cliente
CREATE UNIQUE INDEX "ordenes_servicio_cliente_activa_idx" ON "ordenes_servicio"("clienteId") WHERE "estado" IN ('BUSCANDO', 'EN_CAMINO', 'EN_SITIO', 'EN_TRABAJO');
